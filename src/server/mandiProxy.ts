/**
 * server/mandiProxy.ts
 *
 * Platform-neutral request handler for the mandi price proxy. It runs
 * server-side only: in the Vite dev server (vite.config.ts) and in the
 * production Cloudflare Worker (server/mandi-worker). It is never imported by
 * browser code, so the API key never reaches the client bundle (the build
 * also fails if the key text appears in any emitted chunk; see vite.config.ts).
 *
 * What it does:
 *  - Accepts only GET /prices?state&commodity[&district][&market][&limit][&offset].
 *  - Validates every parameter (lib/mandiQuery.ts) and rejects anything else.
 *  - Builds the single allowlisted upstream URL (fixed host + resource id),
 *    so callers cannot make it fetch an arbitrary URL.
 *  - Adds the key server-side, applies a timeout, maps upstream failures to
 *    stable error codes, and returns only the record fields the app uses.
 *  - Caches successful pages in memory per query for CACHE_TTL_MS and applies
 *    a per-client token-bucket rate limit (both best-effort per instance).
 *  - Never logs the key or the upstream URL.
 */
import {
  buildUpstreamUrl,
  reduceUpstreamBody,
  toProxySearch,
  validateMandiParams,
  type MandiProxyBody,
  type MandiProxyError,
} from "../lib/mandiQuery";

export const CACHE_TTL_MS = 10 * 60 * 1000;
export const UPSTREAM_TIMEOUT_MS = 15_000;
export const RATE_LIMIT_PER_MINUTE = 60;
/** Attempts per request (first call included), all within UPSTREAM_TIMEOUT_MS. */
export const UPSTREAM_ATTEMPTS = 4;
/** An empty 200 is re-asked once only if at least this much of the budget is left. */
const EMPTY_RETRY_MIN_MS = 3000;
/** Gateway / Cloudflare edge statuses that mean "could not reach data.gov.in this time". */
const RETRYABLE_UPSTREAM = new Set([502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527, 530]);

export interface ProxyResponse {
  status: number;
  body: MandiProxyBody | { error: MandiProxyError; detail?: string };
  headers: Record<string, string>;
}

export class TtlCache<V> {
  private map = new Map<string, { value: V; expires: number }>();
  constructor(private ttlMs: number, private maxEntries = 300) {}
  get(key: string, now: number): V | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.expires <= now) {
      this.map.delete(key);
      return undefined;
    }
    return hit.value;
  }
  set(key: string, value: V, now: number): void {
    if (this.map.size >= this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, { value, expires: now + this.ttlMs });
  }
}

/** Token bucket per client id; refills perMinute tokens every minute. */
export class RateLimiter {
  private buckets = new Map<string, { tokens: number; at: number }>();
  constructor(private perMinute = RATE_LIMIT_PER_MINUTE) {}
  take(client: string, now: number): boolean {
    const b = this.buckets.get(client) ?? { tokens: this.perMinute, at: now };
    const refill = ((now - b.at) / 60_000) * this.perMinute;
    b.tokens = Math.min(this.perMinute, b.tokens + refill);
    b.at = now;
    if (this.buckets.size > 5000) this.buckets.clear();
    this.buckets.set(client, b);
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }
}

export interface ProxyDeps {
  apiKey: string | undefined;
  fetch: (url: string, init: { signal: AbortSignal; headers: Record<string, string> }) => Promise<Response>;
  cache?: TtlCache<MandiProxyBody>;
  limiter?: RateLimiter;
  now?: () => number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "x-content-type-options": "nosniff" };

function fail(status: number, error: MandiProxyError, detail?: string, extra: Record<string, string> = {}): ProxyResponse {
  return { status, body: detail ? { error, detail } : { error }, headers: { ...JSON_HEADERS, "cache-control": "no-store", ...extra } };
}

export async function handleMandiProxy(search: URLSearchParams, clientId: string, deps: ProxyDeps): Promise<ProxyResponse> {
  const now = deps.now ?? Date.now;
  const v = validateMandiParams(search);
  if (!v.ok) return fail(400, "bad_request", v.error);
  if (!deps.apiKey) return fail(503, "not_configured");

  const cacheKey = toProxySearch(v.query);
  const cached = deps.cache?.get(cacheKey, now());
  if (cached) {
    return { status: 200, body: cached, headers: { ...JSON_HEADERS, "cache-control": "public, max-age=300", "x-viva-cache": "hit" } };
  }

  if (deps.limiter && !deps.limiter.take(clientId, now())) return fail(429, "rate_limited", undefined, { "retry-after": "60" });

  // One overall deadline for all attempts. From Cloudflare's network, data.gov.in often refuses the
  // connection (521/523 within ~1 s) and then accepts the next try, so fast connection-level
  // failures are retried with a short backoff. Slow failures use up the budget and are not repeated.
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const controller = new AbortController();
  const budget = deps.timeoutMs ?? UPSTREAM_TIMEOUT_MS;
  const started = now();
  const timer = setTimeout(() => controller.abort(), budget);
  let res: Response | undefined;
  let failure: ProxyResponse | undefined;
  try {
    for (let attempt = 0; attempt < UPSTREAM_ATTEMPTS; attempt++) {
      if (attempt > 0) {
        const wait = 300 * 2 ** (attempt - 1);
        if (now() - started + wait >= budget) break;
        await sleep(wait);
      }
      try {
        res = await deps.fetch(buildUpstreamUrl(v.query, deps.apiKey), { signal: controller.signal, headers: { accept: "application/json" } });
      } catch {
        // The error text can contain the request URL (and so the key): never forward it.
        if (controller.signal.aborted) return fail(504, "upstream_timeout");
        res = undefined;
        failure = fail(502, "upstream_error", "network");
        continue;
      }
      if (!RETRYABLE_UPSTREAM.has(res.status)) break;
      failure = fail(502, "upstream_error", `upstream status ${res.status}`);
      res = undefined;
    }
  } finally {
    clearTimeout(timer);
  }
  if (!res) return failure ?? fail(504, "upstream_timeout");

  if (res.status === 401 || res.status === 403) return fail(502, "upstream_auth");
  if (res.status === 429) return fail(503, "upstream_rate_limited", undefined, { "retry-after": "60" });
  if (!res.ok) return fail(502, "upstream_error", `upstream status ${res.status}`);

  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    return fail(502, "upstream_malformed");
  }
  let body = reduceUpstreamBody(raw);
  if (!body) return fail(502, "upstream_malformed");
  // data.gov.in sometimes answers 200 with zero records for a query that has
  // data a few seconds later. Ask once more when time is left, and never cache
  // an empty answer, so "no records" is not repeated for CACHE_TTL_MS.
  if (body.records.length === 0 && budget - (now() - started) > EMPTY_RETRY_MIN_MS) {
    try {
      await sleep(400);
      const again = await deps.fetch(buildUpstreamUrl(v.query, deps.apiKey), {
        signal: AbortSignal.timeout(Math.max(1000, budget - (now() - started))),
        headers: { accept: "application/json" },
      });
      if (again.ok) {
        const second = reduceUpstreamBody(await again.json());
        if (second && second.records.length > 0) body = second;
      }
    } catch {
      /* keep the first (empty) answer */
    }
  }
  if (body.records.length > 0) deps.cache?.set(cacheKey, body, now());
  const cacheControl = body.records.length > 0 ? "public, max-age=300" : "no-store";
  return { status: 200, body, headers: { ...JSON_HEADERS, "cache-control": cacheControl, "x-viva-cache": "miss" } };
}

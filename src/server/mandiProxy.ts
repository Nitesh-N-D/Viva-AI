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

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? UPSTREAM_TIMEOUT_MS);
  let res: Response;
  try {
    res = await deps.fetch(buildUpstreamUrl(v.query, deps.apiKey), { signal: controller.signal, headers: { accept: "application/json" } });
  } catch {
    // The error text can contain the request URL (and so the key): never forward it.
    return controller.signal.aborted ? fail(504, "upstream_timeout") : fail(502, "upstream_error", "network");
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 401 || res.status === 403) return fail(502, "upstream_auth");
  if (res.status === 429) return fail(503, "upstream_rate_limited", undefined, { "retry-after": "60" });
  if (!res.ok) return fail(502, "upstream_error", `upstream status ${res.status}`);

  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    return fail(502, "upstream_malformed");
  }
  const body = reduceUpstreamBody(raw);
  if (!body) return fail(502, "upstream_malformed");
  deps.cache?.set(cacheKey, body, now());
  return { status: 200, body, headers: { ...JSON_HEADERS, "cache-control": "public, max-age=300", "x-viva-cache": "miss" } };
}

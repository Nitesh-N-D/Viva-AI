/**
 * lib/mandiQuery.ts
 *
 * Pure, dependency-free definitions shared by the browser client
 * (lib/mandi.ts), the dev-server proxy (vite.config.ts) and the production
 * proxy (server/mandi-proxy). Nothing here touches the network, storage or
 * import.meta.env, so it is safe to run in Node, a Cloudflare Worker or a
 * browser.
 *
 * Verified against the live API on 2026-11-01 (resource metadata version
 * 2.2.0). The response's `field_exposed` list names the filterable fields:
 *
 *   state.keyword, district, market, commodity, variety, grade
 *
 * so the state filter is `filters[state.keyword]`. In the same check the
 * older `filters[state]` also matched, but only the exposed form is used.
 * Matching is exact and case-sensitive: "tamil nadu" or "villupuram"
 * return total 0. A filter on an unknown field also returns total 0
 * rather than an error, which is why the allowlist below exists.
 * `limit` up to 1000 per page was verified (6,247 Tamil Nadu records in
 * 7 pages). `offset` pages correctly.
 */

export const MANDI_RESOURCE_ID = "9ef84268-d588-465a-a308-a864a43d0070";
export const MANDI_UPSTREAM = "https://api.data.gov.in";

/** Records per page requested from the proxy (upstream accepts up to 1000). */
export const MANDI_PAGE_SIZE = 500;
export const MANDI_MAX_PAGE_SIZE = 1000;
/** Hard ceiling on records fetched for one query (10 pages of 500). */
export const MANDI_MAX_RECORDS = 5000;
export const MANDI_MAX_OFFSET = 20000;

/** API filter field for each query parameter the proxy accepts. */
export const MANDI_FILTER_FIELDS = {
  state: "state.keyword",
  district: "district",
  commodity: "commodity",
  market: "market",
} as const;

export type MandiFilterName = keyof typeof MANDI_FILTER_FIELDS;

export interface MandiQuery {
  state: string;
  commodity: string;
  district?: string;
  market?: string;
  limit: number;
  offset: number;
}

// Letters (any script), digits, space and the punctuation seen in real
// Agmarknet names: "Gingee(Uzhavar Sandhai )", "Bhindi(Ladies Finger)",
// "Elephant Yam(Suran)/Amorphophallus", "Banana - Green", "Pea Pod/Pea Cod/हरी मटर".
const VALUE_RE = /^[\p{L}\p{M}\p{N} ().,'&/+\-]{1,80}$/u;

export function isValidFilterValue(v: string): boolean {
  return VALUE_RE.test(v) && v.trim().length > 0;
}

export type QueryValidation = { ok: true; query: MandiQuery } | { ok: false; error: string };

/**
 * Validates untrusted query-string input (the proxy's request) into a
 * MandiQuery. state and commodity are required so a request can never
 * ask for the whole national table in one go.
 */
export function validateMandiParams(params: URLSearchParams): QueryValidation {
  const allowed = new Set(["state", "district", "commodity", "market", "limit", "offset"]);
  for (const key of params.keys()) {
    if (!allowed.has(key)) return { ok: false, error: `unknown parameter: ${key}` };
  }
  for (const key of allowed) {
    if (params.getAll(key).length > 1) return { ok: false, error: `repeated parameter: ${key}` };
  }
  const text = (name: MandiFilterName, required: boolean): string | undefined | Error => {
    const raw = params.get(name);
    if (raw === null || raw === "") return required ? new Error(`${name} is required`) : undefined;
    if (!isValidFilterValue(raw)) return new Error(`invalid ${name}`);
    return raw;
  };
  const int = (name: "limit" | "offset", def: number, min: number, max: number): number | Error => {
    const raw = params.get(name);
    if (raw === null || raw === "") return def;
    if (!/^\d{1,6}$/.test(raw)) return new Error(`invalid ${name}`);
    const n = Number(raw);
    return n < min || n > max ? new Error(`${name} out of range`) : n;
  };
  const state = text("state", true);
  const commodity = text("commodity", true);
  const district = text("district", false);
  const market = text("market", false);
  const limit = int("limit", MANDI_PAGE_SIZE, 1, MANDI_MAX_PAGE_SIZE);
  const offset = int("offset", 0, 0, MANDI_MAX_OFFSET);
  for (const v of [state, commodity, district, market, limit, offset]) {
    if (v instanceof Error) return { ok: false, error: v.message };
  }
  return {
    ok: true,
    query: {
      state: state as string,
      commodity: commodity as string,
      district: district as string | undefined,
      market: market as string | undefined,
      limit: limit as number,
      offset: offset as number,
    },
  };
}

/** Query string the browser sends to the proxy (no key, no upstream URL). */
export function toProxySearch(q: MandiQuery): string {
  const p = new URLSearchParams({ state: q.state, commodity: q.commodity });
  if (q.district) p.set("district", q.district);
  if (q.market) p.set("market", q.market);
  p.set("limit", String(q.limit));
  p.set("offset", String(q.offset));
  return p.toString();
}

/**
 * The only upstream URL the proxy ever builds: fixed host, fixed resource,
 * allowlisted filter names. Runs server-side only, because it embeds the key.
 */
export function buildUpstreamUrl(q: MandiQuery, apiKey: string): string {
  const p = new URLSearchParams({ "api-key": apiKey, format: "json", limit: String(q.limit), offset: String(q.offset) });
  p.set(`filters[${MANDI_FILTER_FIELDS.state}]`, q.state);
  p.set(`filters[${MANDI_FILTER_FIELDS.commodity}]`, q.commodity);
  if (q.district) p.set(`filters[${MANDI_FILTER_FIELDS.district}]`, q.district);
  if (q.market) p.set(`filters[${MANDI_FILTER_FIELDS.market}]`, q.market);
  return `${MANDI_UPSTREAM}/resource/${MANDI_RESOURCE_ID}?${p}`;
}

/** Stable cache key for one filter combination (pagination excluded). */
export function mandiQueryKey(q: Pick<MandiQuery, "state" | "commodity" | "district" | "market">): string {
  return [q.state, q.district ?? "", q.commodity, q.market ?? ""].join("|");
}

/** Raw record fields kept from the upstream response. */
export const MANDI_RECORD_FIELDS = [
  "state",
  "district",
  "market",
  "commodity",
  "variety",
  "grade",
  "arrival_date",
  "min_price",
  "max_price",
  "modal_price",
] as const;

/** Body the proxy returns: only these fields, never the upstream URL or key. */
export interface MandiProxyBody {
  total: number;
  offset: number;
  limit: number;
  /** data.gov.in `updated_date` for the resource, when present. */
  updated: string | null;
  records: Record<string, unknown>[];
}

export type MandiProxyError =
  | "bad_request"
  | "not_configured"
  | "rate_limited"
  | "upstream_auth"
  | "upstream_rate_limited"
  | "upstream_timeout"
  | "upstream_error"
  | "upstream_malformed";

/**
 * Reduces an upstream data.gov.in body to MandiProxyBody, or null when it
 * is not shaped like the API at all.
 */
export function reduceUpstreamBody(body: unknown): MandiProxyBody | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (!Array.isArray(b.records)) return null;
  const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : NaN);
  const total = num(b.total);
  const records = b.records
    .filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null)
    .map((r) => Object.fromEntries(MANDI_RECORD_FIELDS.map((f) => [f, r[f]])));
  return {
    total: Number.isFinite(total) ? total : records.length,
    offset: Number.isFinite(num(b.offset)) ? num(b.offset) : 0,
    limit: Number.isFinite(num(b.limit)) ? num(b.limit) : records.length,
    updated: typeof b.updated_date === "string" ? b.updated_date : null,
    records,
  };
}

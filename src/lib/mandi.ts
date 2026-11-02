/**
 * lib/mandi.ts
 *
 * Agmarknet daily mandi prices from data.gov.in (resource
 * 9ef84268-d588-465a-a308-a864a43d0070), fetched through a server-side proxy.
 *
 *  - The browser never holds the data.gov.in key. In development the Vite
 *    server answers /api-mandi/prices (vite.config.ts). In production the app
 *    calls VITE_MANDI_PROXY_URL (a Cloudflare Worker, server/mandi-worker).
 *    Without a proxy the result is "unavailable" with failure "no_proxy".
 *  - Results are paged (MANDI_PAGE_SIZE per request) until `total` is
 *    reached, capped at MANDI_MAX_RECORDS. A capped result says so
 *    (`truncated`), so nothing is dropped silently.
 *  - Records are de-duplicated on their natural key.
 *  - Each filter combination is cached in localStorage with its fetch time.
 *    A cached copy is always labelled "cached", never "live".
 *  - No sample, mock or estimated prices exist anywhere in this module.
 */
import { fetchWithTimeout, readStored, writeStored } from "./http";
import {
  MANDI_MAX_RECORDS,
  MANDI_PAGE_SIZE,
  mandiQueryKey,
  toProxySearch,
  type MandiProxyBody,
  type MandiProxyError,
} from "./mandiQuery";

export interface MandiRecord {
  state: string;
  district: string;
  market: string;
  commodity: string;
  variety: string;
  grade: string;
  /** ISO yyyy-mm-dd when parseable, otherwise the raw string. */
  arrivalDate: string;
  minPrice: number | null;
  maxPrice: number | null;
  modalPrice: number;
}

/**
 * Unit of min/max/modal price. The API response carries no unit field;
 * Agmarknet publishes these prices in rupees per quintal (100 kg), and the
 * values observed on 2026-11-01 (tomato ₹3,000–4,800) match that unit.
 */
export const PRICE_UNIT = "quintal" as const;

export type MandiFailure = "no_proxy" | "auth" | "rate_limit" | "timeout" | "network" | "http" | "malformed" | "bad_request";

export interface MandiResult {
  status: "live" | "cached" | "unavailable";
  records: MandiRecord[];
  fetchedAt: number | null;
  /** Total matching records reported by the API. */
  total: number;
  /** Pages requested for this result (0 for a cache hit). */
  pages: number;
  /** True when total exceeded MANDI_MAX_RECORDS and only part was fetched. */
  truncated: boolean;
  /** data.gov.in's `updated_date` for the resource, when known. */
  sourceUpdated: string | null;
  failure?: MandiFailure;
  message?: string;
}

export interface MandiFilter {
  state: string;
  commodity: string;
  district?: string;
}

const CACHE_PREFIX = "viva-ai:mandi:v3:";
/** A saved copy younger than this is shown without refetching (labelled cached). */
export const FRESH_MS = 30 * 60 * 1000;
const TIMEOUT_MS = 20000;
const TRANSIENT_RETRIES = 1;
const TRANSIENT_STATUSES = new Set([504]);

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
}

export function parsePrice(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** "01/11/2026" (dd/mm/yyyy, as the API sends it) -> "2026-11-01"; anything else unchanged. */
export function normaliseDate(raw: string): string {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  if (!m) return raw;
  return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

export function recordKey(r: MandiRecord): string {
  return [r.state, r.district, r.market, r.commodity, r.variety, r.grade, r.arrivalDate].join("|");
}

/**
 * Parses raw API records. Records without a usable modal price are
 * skipped; duplicates (same natural key) are kept once.
 */
export function parseMandiRecords(raw: unknown[]): MandiRecord[] {
  const seen = new Set<string>();
  const out: MandiRecord[] = [];
  for (const r of raw) {
    if (typeof r !== "object" || r === null) continue;
    const rec = r as Record<string, unknown>;
    const modal = parsePrice(rec.modal_price);
    if (modal === null) continue;
    const parsed: MandiRecord = {
      state: str(rec.state),
      district: str(rec.district),
      market: str(rec.market) || "—",
      commodity: str(rec.commodity),
      variety: str(rec.variety),
      grade: str(rec.grade),
      arrivalDate: normaliseDate(str(rec.arrival_date)),
      minPrice: parsePrice(rec.min_price),
      maxPrice: parsePrice(rec.max_price),
      modalPrice: modal,
    };
    const k = recordKey(parsed);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(parsed);
  }
  return out;
}

/** Validates a proxy page body; throws when it is not MandiProxyBody-shaped. */
export function parseProxyBody(body: unknown): MandiProxyBody {
  if (typeof body !== "object" || body === null) throw new Error("response is not an object");
  const b = body as Partial<MandiProxyBody>;
  if (!Array.isArray(b.records)) throw new Error("response has no records array");
  if (typeof b.total !== "number" || !Number.isFinite(b.total) || b.total < 0) throw new Error("response has no total");
  return { total: b.total, offset: Number(b.offset) || 0, limit: Number(b.limit) || b.records.length, updated: b.updated ?? null, records: b.records };
}

/** Proxy base URL, or null when no proxy is configured for this build. */
export function mandiProxyBase(): string | null {
  const configured = import.meta.env.VITE_MANDI_PROXY_URL;
  if (configured) return configured.replace(/\/$/, "");
  return import.meta.env.DEV ? "/api-mandi" : null;
}

export function buildProxyUrl(base: string, f: MandiFilter, offset: number, limit = MANDI_PAGE_SIZE): string {
  return `${base}/prices?${toProxySearch({ state: f.state, commodity: f.commodity, district: f.district || undefined, limit, offset })}`;
}

function failureFromProxy(status: number, code: MandiProxyError | undefined): MandiFailure {
  switch (code) {
    case "not_configured":
      return "no_proxy";
    case "upstream_auth":
      return "auth";
    case "rate_limited":
    case "upstream_rate_limited":
      return "rate_limit";
    case "upstream_timeout":
      return "timeout";
    case "upstream_malformed":
      return "malformed";
    case "bad_request":
      return "bad_request";
  }
  if (status === 429) return "rate_limit";
  if (status === 504) return "timeout";
  return "http";
}

class MandiError extends Error {
  constructor(public failure: MandiFailure, message: string) {
    super(message);
  }
}

interface CacheEntry {
  records: MandiRecord[];
  fetchedAt: number;
  total: number;
  truncated: boolean;
  sourceUpdated: string | null;
}

export type Fetcher = (url: string, timeoutMs: number) => Promise<Response>;

/** Fetches every page for one filter combination. Throws MandiError. */
async function fetchAllPages(base: string, f: MandiFilter, fetcher: Fetcher, onProgress?: (n: number, total: number) => void) {
  const raw: unknown[] = [];
  let total = 0;
  let pages = 0;
  let sourceUpdated: string | null = null;
  for (let offset = 0; offset < MANDI_MAX_RECORDS; offset += MANDI_PAGE_SIZE) {
    let res: Response | null = null;
    let body: unknown = null;
    // data.gov.in is intermittently slow (observed 15 s timeouts that succeed on
    // the next attempt), so each page gets one retry on a transient failure.
    for (let attempt = 0; attempt <= TRANSIENT_RETRIES; attempt++) {
      const last = attempt === TRANSIENT_RETRIES;
      try {
        res = await fetcher(buildProxyUrl(base, f, offset), TIMEOUT_MS);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!last) continue;
        throw new MandiError(/timed out|abort/i.test(msg) ? "timeout" : "network", msg);
      }
      if (!last && TRANSIENT_STATUSES.has(res.status)) continue;
      break;
    }
    if (!res) throw new MandiError("network", "no response");
    pages++;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    if (!res.ok) {
      const code = (body as { error?: MandiProxyError } | null)?.error;
      throw new MandiError(failureFromProxy(res.status, code), `price service returned ${res.status}${code ? ` (${code})` : ""}`);
    }
    let page: MandiProxyBody;
    try {
      page = parseProxyBody(body);
    } catch (err) {
      throw new MandiError("malformed", err instanceof Error ? err.message : String(err));
    }
    total = page.total;
    sourceUpdated = page.updated ?? sourceUpdated;
    raw.push(...page.records);
    onProgress?.(raw.length, total);
    // Stop on the last page, an empty page (never loop forever), or once total is reached.
    if (page.records.length === 0 || page.records.length < MANDI_PAGE_SIZE || raw.length >= total) break;
  }
  const records = parseMandiRecords(raw);
  return { records, total, pages, truncated: total > raw.length, sourceUpdated };
}

const inFlight = new Map<string, Promise<MandiResult>>();

export function mandiCacheKey(f: MandiFilter): string {
  return CACHE_PREFIX + mandiQueryKey({ state: f.state, commodity: f.commodity, district: f.district || undefined });
}

/**
 * Prices for one state + commodity (+ optional district). Market, date,
 * search and sort are applied locally afterwards, so changing them never
 * triggers a request. Concurrent calls for the same filters share one fetch.
 */
export function getMandiPrices(
  f: MandiFilter,
  opts: { force?: boolean; fetcher?: Fetcher; base?: string | null; onProgress?: (n: number, total: number) => void } = {}
): Promise<MandiResult> {
  const key = mandiCacheKey(f) + (opts.force ? ":force" : "");
  const pending = inFlight.get(key);
  if (pending) return pending;
  const p = loadPrices(f, opts).finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}

async function loadPrices(
  f: MandiFilter,
  opts: { force?: boolean; fetcher?: Fetcher; base?: string | null; onProgress?: (n: number, total: number) => void }
): Promise<MandiResult> {
  const key = mandiCacheKey(f);
  const cached = readStored<CacheEntry>(key);
  const fromCache = (extra: Partial<MandiResult> = {}): MandiResult => ({
    status: "cached",
    records: cached!.records,
    fetchedAt: cached!.fetchedAt,
    total: cached!.total,
    pages: 0,
    truncated: cached!.truncated,
    sourceUpdated: cached!.sourceUpdated,
    ...extra,
  });
  const unavailable = (failure: MandiFailure, message?: string): MandiResult =>
    cached
      ? fromCache({ failure, message })
      : { status: "unavailable", records: [], fetchedAt: null, total: 0, pages: 0, truncated: false, sourceUpdated: null, failure, message };

  if (!opts.force && cached && Date.now() - cached.fetchedAt < FRESH_MS) return fromCache();

  const base = opts.base === undefined ? mandiProxyBase() : opts.base;
  if (!base) return unavailable("no_proxy");

  try {
    const r = await fetchAllPages(base, f, opts.fetcher ?? fetchWithTimeout, opts.onProgress);
    const fetchedAt = Date.now();
    writeStored(key, { records: r.records, fetchedAt, total: r.total, truncated: r.truncated, sourceUpdated: r.sourceUpdated } satisfies CacheEntry);
    return { status: "live", fetchedAt, ...r };
  } catch (err) {
    if (err instanceof MandiError) return unavailable(err.failure, err.message);
    return unavailable("network", err instanceof Error ? err.message : String(err));
  }
}

// ---------------------------------------------------------------------------
// Local filtering, sorting and summary (pure; no requests)

export type MandiSortKey = "date" | "high" | "low" | "market";

export interface LocalFilter {
  /** Exact API market name, or "" for all markets. */
  market: string;
  /** ISO arrival date, or "" for all dates. */
  date: string;
  search: string;
}

export function filterMandiRecords(records: readonly MandiRecord[], f: LocalFilter): MandiRecord[] {
  const q = f.search.trim().toLowerCase();
  return records.filter(
    (r) =>
      (!f.market || r.market === f.market) &&
      (!f.date || r.arrivalDate === f.date) &&
      (!q || [r.market, r.district, r.variety, r.grade].some((s) => s.toLowerCase().includes(q)))
  );
}

export function sortMandiRecords(records: readonly MandiRecord[], key: MandiSortKey): MandiRecord[] {
  const byMarket = (a: MandiRecord, b: MandiRecord) => a.market.localeCompare(b.market, "en");
  return [...records].sort((a, b) => {
    switch (key) {
      case "high":
        return b.modalPrice - a.modalPrice || byMarket(a, b);
      case "low":
        return a.modalPrice - b.modalPrice || byMarket(a, b);
      case "market":
        return byMarket(a, b) || b.arrivalDate.localeCompare(a.arrivalDate);
      default:
        return b.arrivalDate.localeCompare(a.arrivalDate) || b.modalPrice - a.modalPrice || byMarket(a, b);
    }
  });
}

/** Distinct market names in the records, sorted. */
export function marketOptions(records: readonly MandiRecord[]): string[] {
  return [...new Set(records.map((r) => r.market))].sort((a, b) => a.localeCompare(b, "en"));
}

/** Distinct arrival dates in the records, newest first. */
export function dateOptions(records: readonly MandiRecord[]): string[] {
  return [...new Set(records.map((r) => r.arrivalDate))].sort((a, b) => b.localeCompare(a));
}

/** Arrival reports older than this are flagged as old in the UI. */
export const STALE_ARRIVAL_DAYS = 3;

/** Whole days between an ISO arrival date and `now`; null when the date is not ISO. */
export function arrivalAgeDays(arrivalDate: string, now: Date = new Date()): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(arrivalDate);
  if (!m) return null;
  const arrival = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.round((today - arrival) / 86_400_000));
}

export interface MandiSummary {
  highest: MandiRecord;
  lowest: MandiRecord;
  /** Median modal price across the records given, ₹ per quintal. */
  median: number;
  markets: number;
  latestDate: string;
}

/** Summary of exactly the records given (the currently filtered list); null when empty. */
export function summariseMandi(records: readonly MandiRecord[]): MandiSummary | null {
  if (records.length === 0) return null;
  let highest = records[0];
  let lowest = records[0];
  for (const r of records) {
    if (r.modalPrice > highest.modalPrice) highest = r;
    if (r.modalPrice < lowest.modalPrice) lowest = r;
  }
  const sorted = records.map((r) => r.modalPrice).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  const latestDate = records.reduce((d, r) => (r.arrivalDate > d ? r.arrivalDate : d), records[0].arrivalDate);
  return { highest, lowest, median, markets: new Set(records.map((r) => r.market)).size, latestDate };
}

/** Rows shown per results page in the explorer. */
export const RESULTS_PAGE_SIZE = 20;

export interface PageSlice<T> {
  items: T[];
  page: number;
  pages: number;
}

/** One page of `rows` (1-based); out-of-range pages are clamped. */
export function paginate<T>(rows: readonly T[], page: number, size = RESULTS_PAGE_SIZE): PageSlice<T> {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const p = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  return { items: rows.slice((p - 1) * size, p * size), page: p, pages };
}

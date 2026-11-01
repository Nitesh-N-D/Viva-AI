/**
 * lib/mandi.ts
 *
 * Agmarknet daily mandi prices from data.gov.in (resource
 * 9ef84268-d588-465a-a308-a864a43d0070).
 *
 *  - Requires VITE_AGMARKNET_API_KEY. No key is hardcoded and no sample
 *    prices are ever shown: without a key or a reachable API the result
 *    is "unavailable", or a clearly-labelled saved copy.
 *  - Dev requests go through the Vite proxy (/api-mandi). In production
 *    set VITE_MANDI_PROXY_URL to a same-origin proxy if data.gov.in's CORS
 *    policy blocks the deployed origin (see DEPLOYMENT_GUIDE.md).
 */
import { fetchWithTimeout, readStored, writeStored } from "./http";

export interface Commodity {
  id: string;
  /** Exact commodity string used by Agmarknet. */
  apiName: string;
  en: string;
  ta: string;
}

export const COMMODITIES: readonly Commodity[] = [
  { id: "paddy", apiName: "Paddy(Dhan)(Common)", en: "Paddy", ta: "நெல்" },
  { id: "groundnut", apiName: "Groundnut", en: "Groundnut", ta: "நிலக்கடலை" },
  { id: "maize", apiName: "Maize", en: "Maize", ta: "மக்காச்சோளம்" },
  { id: "cotton", apiName: "Cotton", en: "Cotton", ta: "பருத்தி" },
  { id: "blackgram", apiName: "Black Gram (Urd Beans)(Whole)", en: "Black gram", ta: "உளுந்து" },
  { id: "tomato", apiName: "Tomato", en: "Tomato", ta: "தக்காளி" },
  { id: "onion", apiName: "Onion", en: "Onion", ta: "வெங்காயம்" },
  { id: "banana", apiName: "Banana", en: "Banana", ta: "வாழைப்பழம்" },
  { id: "turmeric", apiName: "Turmeric", en: "Turmeric", ta: "மஞ்சள்" },
  { id: "bajra", apiName: "Bajra(Pearl Millet/Cumbu)", en: "Pearl millet (cumbu)", ta: "கம்பு" },
];

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

export type MandiFailure = "no_key" | "network" | "http" | "malformed";

export interface MandiResult {
  status: "live" | "cached" | "unavailable";
  records: MandiRecord[];
  fetchedAt: number | null;
  failure?: MandiFailure;
  message?: string;
}

const RESOURCE_ID = "9ef84268-d588-465a-a308-a864a43d0070";
const CACHE_PREFIX = "viva-ai:mandi:v2:";
const FRESH_MS = 2 * 60 * 60 * 1000;
const TIMEOUT_MS = 10000;

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
}

function price(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** "31/10/2026" -> "2026-10-31"; anything else is returned unchanged. */
export function normaliseDate(raw: string): string {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  if (!m) return raw;
  return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

/**
 * Pure parser for a data.gov.in response body. Throws on a body that is
 * not shaped like the API at all; skips individual records without a
 * usable modal price. Exported for tests.
 */
export function parseMandiResponse(body: unknown): MandiRecord[] {
  if (typeof body !== "object" || body === null || !Array.isArray((body as { records?: unknown }).records)) {
    throw new Error("response has no records array");
  }
  const records = (body as { records: unknown[] }).records;
  const out: MandiRecord[] = [];
  for (const r of records) {
    if (typeof r !== "object" || r === null) continue;
    const rec = r as Record<string, unknown>;
    const modal = price(rec.modal_price ?? rec.Modal_Price);
    if (modal === null) continue;
    out.push({
      state: str(rec.state ?? rec.State),
      district: str(rec.district ?? rec.District),
      market: str(rec.market ?? rec.Market) || "—",
      commodity: str(rec.commodity ?? rec.Commodity),
      variety: str(rec.variety ?? rec.Variety),
      grade: str(rec.grade ?? rec.Grade),
      arrivalDate: normaliseDate(str(rec.arrival_date ?? rec.Arrival_Date)),
      minPrice: price(rec.min_price ?? rec.Min_Price),
      maxPrice: price(rec.max_price ?? rec.Max_Price),
      modalPrice: modal,
    });
  }
  return out.sort((a, b) => b.arrivalDate.localeCompare(a.arrivalDate) || b.modalPrice - a.modalPrice);
}

export function buildMandiUrl(apiName: string, district: string | null, apiKey: string): string {
  const params = new URLSearchParams({
    "api-key": apiKey,
    format: "json",
    limit: "100",
    "filters[state]": "Tamil Nadu",
    "filters[commodity]": apiName,
  });
  if (district) params.set("filters[district]", district);
  const proxy = import.meta.env.VITE_MANDI_PROXY_URL;
  const base = proxy
    ? proxy.replace(/\/$/, "")
    : import.meta.env.DEV
      ? "/api-mandi"
      : "https://api.data.gov.in";
  return `${base}/resource/${RESOURCE_ID}?${params}`;
}

interface CacheEntry {
  records: MandiRecord[];
  fetchedAt: number;
}

export async function getMandiPrices(
  commodity: Commodity,
  district: string | null,
  opts: { force?: boolean; fetcher?: typeof fetchWithTimeout } = {}
): Promise<MandiResult> {
  const key = `${CACHE_PREFIX}${commodity.id}:${district ?? "all"}`;
  const cached = readStored<CacheEntry>(key);
  if (!opts.force && cached && Date.now() - cached.fetchedAt < FRESH_MS) {
    // Fresh enough that refetching would return the same daily data; it
    // is still a saved copy, so it is labelled as one.
    return { status: "cached", records: cached.records, fetchedAt: cached.fetchedAt };
  }

  const apiKey = import.meta.env.VITE_AGMARKNET_API_KEY;
  if (!apiKey) {
    return cached
      ? { status: "cached", records: cached.records, fetchedAt: cached.fetchedAt, failure: "no_key" }
      : { status: "unavailable", records: [], fetchedAt: null, failure: "no_key" };
  }

  const fetcher = opts.fetcher ?? fetchWithTimeout;
  let failure: MandiFailure;
  let message: string;
  try {
    const res = await fetcher(buildMandiUrl(commodity.apiName, district, apiKey), TIMEOUT_MS);
    if (!res.ok) {
      failure = "http";
      message = `data.gov.in returned ${res.status}`;
    } else {
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      try {
        const records = parseMandiResponse(body);
        const fetchedAt = Date.now();
        writeStored(key, { records, fetchedAt } satisfies CacheEntry);
        return { status: "live", records, fetchedAt };
      } catch (err) {
        failure = "malformed";
        message = err instanceof Error ? err.message : String(err);
      }
    }
  } catch (err) {
    failure = "network";
    message = err instanceof Error ? err.message : String(err);
  }

  return cached
    ? { status: "cached", records: cached.records, fetchedAt: cached.fetchedAt, failure, message }
    : { status: "unavailable", records: [], fetchedAt: null, failure, message };
}

/** Arrival reports older than this are flagged as old in the UI. */
export const STALE_ARRIVAL_DAYS = 7;

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
  /** Median modal price across the records shown, Rs/quintal. */
  median: number;
  markets: number;
  latestDate: string;
}

/** Pure summary for the comparison panel; null when there are no records. */
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

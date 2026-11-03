/**
 * server/weatherProxy.ts
 *
 * Platform-neutral handler for GET /weather?lat=&lon= . Runs server-side only
 * (Cloudflare Worker and the Vite dev/preview server), so the OpenWeatherMap
 * key (OPENWEATHER_API_KEY, a Worker secret) never reaches the browser.
 *
 *  - Accepts only numeric lat/lon inside India's bounding box, rounded to two
 *    decimals (~1 km): the cache key and the upstream query use the rounded
 *    value, so nearby users share one cached answer.
 *  - Calls only the two fixed OpenWeatherMap endpoints (current + 5-day
 *    forecast) in one round, with one overall timeout.
 *  - Returns only the fields the app reads; never the key, the upstream URL or
 *    upstream error text.
 *  - Caches complete answers per rounded location for CACHE_MS, deduplicates
 *    concurrent identical requests, and rate-limits per client.
 *  - An answer without a temperature is reported as malformed, never cached.
 *
 * Free tier: OpenWeatherMap's free plan allows 60 calls/min and 1,000,000
 * calls/month; each uncached request uses 2 calls. With a 10-minute cache per
 * ~1 km cell the app stays far below both.
 */
import { RateLimiter, TtlCache } from "./mandiProxy";

export const WEATHER_CACHE_MS = 10 * 60 * 1000;
export const WEATHER_TIMEOUT_MS = 8000;
export const WEATHER_RATE_PER_MINUTE = 30;
const API = "https://api.openweathermap.org/data/2.5";

/** Error codes shared with src/lib/weather.ts. */
export type WeatherProxyError =
  | "bad_request"
  | "not_configured"
  | "rate_limited"
  | "invalid_key"
  | "not_found"
  | "upstream_rate_limited"
  | "server"
  | "timeout"
  | "bad_response"
  | "network";

export interface WeatherProxyBody {
  current: {
    name: string | null;
    main: { temp: number; feels_like: number | null; humidity: number | null };
    wind: { speed: number | null };
    weather: { id: number | null; description: string | null }[];
  };
  forecast: { list: { dt_txt: string; main: { temp_min: number; temp_max: number }; rain?: { "3h": number } }[] } | null;
  /** Server time of the upstream fetch (ms since epoch). */
  fetchedAt: number;
}

export interface WeatherProxyResponse {
  status: number;
  body: WeatherProxyBody | { error: WeatherProxyError };
  headers: Record<string, string>;
}

export interface WeatherProxyDeps {
  apiKey: string | undefined;
  fetch: (url: string, init: { signal: AbortSignal }) => Promise<Response>;
  cache?: TtlCache<WeatherProxyBody>;
  limiter?: RateLimiter;
  inflight?: Map<string, Promise<WeatherProxyResponse>>;
  now?: () => number;
  timeoutMs?: number;
}

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "x-content-type-options": "nosniff" };

function fail(status: number, error: WeatherProxyError, extra: Record<string, string> = {}): WeatherProxyResponse {
  return { status, body: { error }, headers: { ...JSON_HEADERS, "cache-control": "no-store", ...extra } };
}

/** Validates and rounds lat/lon. India incl. islands: lat 6–37.5, lon 68–98. Pure; exported for tests. */
export function parseCoords(search: URLSearchParams): { lat: number; lon: number } | null {
  const keys = [...search.keys()];
  if (keys.some((k) => k !== "lat" && k !== "lon")) return null;
  const rawLat = search.get("lat");
  const rawLon = search.get("lon");
  if (!rawLat || !rawLon || !/^-?\d{1,3}(\.\d{1,8})?$/.test(rawLat) || !/^-?\d{1,3}(\.\d{1,8})?$/.test(rawLon)) return null;
  const lat = Math.round(Number(rawLat) * 100) / 100;
  const lon = Math.round(Number(rawLon) * 100) / 100;
  if (!(lat >= 6 && lat <= 37.5 && lon >= 68 && lon <= 98)) return null;
  return { lat, lon };
}

const fin = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown, max = 80): string | null => (typeof v === "string" && v ? v.slice(0, max) : null);

/** Keeps only the fields the app uses; null when there is no usable temperature. Pure; exported for tests. */
export function reduceWeather(current: unknown, forecast: unknown, fetchedAt: number): WeatherProxyBody | null {
  if (!current || typeof current !== "object") return null;
  const c = current as { name?: unknown; main?: Record<string, unknown>; wind?: Record<string, unknown>; weather?: unknown };
  const temp = fin(c.main?.temp);
  if (temp === null) return null;
  const w0 = Array.isArray(c.weather) && c.weather[0] && typeof c.weather[0] === "object" ? (c.weather[0] as Record<string, unknown>) : {};
  let list: NonNullable<WeatherProxyBody["forecast"]>["list"] | null = null;
  const fl = forecast && typeof forecast === "object" ? (forecast as { list?: unknown }).list : undefined;
  if (Array.isArray(fl)) {
    list = [];
    for (const s of fl.slice(0, 48)) {
      if (!s || typeof s !== "object") continue;
      const slot = s as { dt_txt?: unknown; main?: Record<string, unknown>; rain?: Record<string, unknown> };
      const lo = fin(slot.main?.temp_min);
      const hi = fin(slot.main?.temp_max);
      if (typeof slot.dt_txt !== "string" || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(slot.dt_txt) || lo === null || hi === null) continue;
      const rain = fin(slot.rain?.["3h"]);
      list.push({ dt_txt: slot.dt_txt, main: { temp_min: lo, temp_max: hi }, ...(rain !== null ? { rain: { "3h": rain } } : {}) });
    }
  }
  return {
    current: {
      name: str(c.name),
      main: { temp, feels_like: fin(c.main?.feels_like), humidity: fin(c.main?.humidity) },
      wind: { speed: fin(c.wind?.speed) },
      weather: [{ id: fin(w0.id), description: str(w0.description) }],
    },
    forecast: list ? { list } : null,
    fetchedAt,
  };
}

function upstreamError(status: number): WeatherProxyResponse {
  if (status === 401 || status === 403) return fail(502, "invalid_key");
  if (status === 404) return fail(404, "not_found");
  if (status === 429) return fail(503, "upstream_rate_limited", { "retry-after": "60" });
  if (status >= 500) return fail(502, "server");
  return fail(502, "bad_response");
}

async function fetchUpstream(lat: number, lon: number, deps: WeatherProxyDeps, key: string, now: () => number): Promise<WeatherProxyResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? WEATHER_TIMEOUT_MS);
  const q = `lat=${lat}&lon=${lon}&units=metric&appid=${encodeURIComponent(deps.apiKey ?? "")}`;
  try {
    let cur: Response;
    let fc: Response | null;
    try {
      [cur, fc] = await Promise.all([
        deps.fetch(`${API}/weather?${q}`, { signal: controller.signal }),
        deps.fetch(`${API}/forecast?${q}`, { signal: controller.signal }).catch(() => null),
      ]);
    } catch {
      // Never forward the error text: it can contain the request URL (and so the key).
      return fail(controller.signal.aborted ? 504 : 502, controller.signal.aborted ? "timeout" : "network");
    }
    if (!cur.ok) return upstreamError(cur.status);
    const currentJson = await cur.json().catch(() => null);
    const forecastJson = fc && fc.ok ? await fc.json().catch(() => null) : null;
    const body = reduceWeather(currentJson, forecastJson, now());
    if (!body) return fail(502, "bad_response");
    // Cache only complete answers, so a missing forecast is retried on the next request.
    if (body.forecast) deps.cache?.set(key, body, now());
    return { status: 200, body, headers: { ...JSON_HEADERS, "cache-control": "public, max-age=300", "x-viva-cache": "miss" } };
  } catch {
    return fail(controller.signal.aborted ? 504 : 502, controller.signal.aborted ? "timeout" : "bad_response");
  } finally {
    clearTimeout(timer);
  }
}

export async function handleWeatherProxy(search: URLSearchParams, clientId: string, deps: WeatherProxyDeps): Promise<WeatherProxyResponse> {
  const now = deps.now ?? Date.now;
  const coords = parseCoords(search);
  if (!coords) return fail(400, "bad_request");
  if (!deps.apiKey) return fail(503, "not_configured");

  const key = `${coords.lat},${coords.lon}`;
  const hit = deps.cache?.get(key, now());
  if (hit) return { status: 200, body: hit, headers: { ...JSON_HEADERS, "cache-control": "public, max-age=300", "x-viva-cache": "hit" } };

  if (deps.limiter && !deps.limiter.take(clientId, now())) return fail(429, "rate_limited", { "retry-after": "60" });

  // Concurrent identical requests share one upstream call.
  const pending = deps.inflight?.get(key);
  if (pending) return pending;
  const p = fetchUpstream(coords.lat, coords.lon, deps, key, now);
  deps.inflight?.set(key, p);
  try {
    return await p;
  } finally {
    deps.inflight?.delete(key);
  }
}

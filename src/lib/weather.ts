/**
 * lib/weather.ts
 *
 * OpenWeatherMap, called directly from the browser (free tier, no
 * backend). The key is visible in the bundle; restrict it by HTTP
 * referrer in the OpenWeatherMap dashboard.
 *
 *  - Current conditions from /data/2.5/weather.
 *  - Rain outlook = sum of the 3-hourly `rain.3h` values from the 5-day
 *    /data/2.5/forecast. Nothing is extrapolated from a single reading.
 *  - Order: fresh cache → live → stale cache (labelled) → "unavailable".
 *    There is no invented fallback weather.
 */
import { fetchWithTimeout, readStored, writeStored } from "./http";

export type Season = "kharif" | "rabi" | "summer";

export type WeatherQuery = { lat: number; lng: number } | { district: string };

export interface WeatherSnapshot {
  placeName: string | null;
  tempC: number | null;
  /** "Feels like" temperature, °C. */
  feelsLikeC: number | null;
  humidity: number | null;
  /** Sum of forecast rain over the next ~5 days, mm. null when unknown. */
  rainNext5dMm: number | null;
  /** Wind speed, km/h. */
  windKph: number | null;
  /** Short condition text from the provider (English), e.g. "light rain". */
  condition: string | null;
  /** Translatable condition group (see conditionKey), null when unknown. */
  conditionKey: ConditionKey | null;
  /** Up to 5 days of forecast, grouped by the provider's local date. */
  daily: DailyForecast[];
  season: Season;
  source: "live" | "cached" | "unavailable";
  fetchedAt: number | null;
  error?: WeatherError;
}

export interface DailyForecast {
  /** yyyy-mm-dd */
  date: string;
  minC: number;
  maxC: number;
  rainMm: number;
}

export type ConditionKey =
  | "thunderstorm" | "drizzle" | "lightRain" | "rain" | "heavyRain" | "snow" | "haze" | "mist" | "fog"
  | "clear" | "fewClouds" | "clouds" | "overcast";

/** OpenWeatherMap condition id → translatable group (OWM has no Tamil). Pure; exported for tests. */
export function conditionKey(id: unknown): ConditionKey | null {
  if (typeof id !== "number" || !Number.isFinite(id)) return null;
  if (id >= 200 && id < 300) return "thunderstorm";
  if (id >= 300 && id < 400) return "drizzle";
  if (id === 500 || id === 520) return "lightRain";
  if (id === 501 || id === 521 || id === 511) return "rain";
  if (id >= 502 && id < 600) return "heavyRain";
  if (id >= 600 && id < 700) return "snow";
  if (id === 701) return "mist";
  if (id === 741) return "fog";
  if (id >= 700 && id < 800) return "haze";
  if (id === 800) return "clear";
  if (id === 801 || id === 802) return "fewClouds";
  if (id === 803) return "clouds";
  if (id === 804) return "overcast";
  return null;
}

export type WeatherError = "no_key" | "invalid_key" | "not_found" | "rate_limited" | "server" | "timeout" | "bad_response" | "network" | "http";

/** Maps a non-OK OpenWeatherMap status to an app error. Pure; exported for tests. */
export function weatherErrorFor(status: number): WeatherError {
  if (status === 401 || status === 403) return "invalid_key";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server";
  return "http";
}

const CACHE_PREFIX = "viva-ai:weather:v3:";
const FRESH_MS = 30 * 60 * 1000;
const TIMEOUT_MS = 8000;
const API = "https://api.openweathermap.org/data/2.5";

/** Tamil Nadu cropping seasons by calendar month. */
export function seasonFor(date: Date): Season {
  const month = date.getMonth() + 1;
  if (month >= 6 && month <= 9) return "kharif";
  if (month >= 10 || month === 1) return "rabi";
  return "summer";
}

function cacheKey(q: WeatherQuery): string {
  return "lat" in q ? `${q.lat.toFixed(2)},${q.lng.toFixed(2)}` : `d:${q.district.toLowerCase()}`;
}

function locationParams(q: WeatherQuery): string {
  return "lat" in q ? `lat=${q.lat}&lon=${q.lng}` : `q=${encodeURIComponent(`${q.district},IN`)}`;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

interface OwmCurrent {
  name?: unknown;
  main?: { temp?: unknown; feels_like?: unknown; humidity?: unknown };
  wind?: { speed?: unknown };
  weather?: { id?: unknown; description?: unknown }[];
}

interface OwmForecastSlot {
  dt_txt?: unknown;
  main?: { temp_min?: unknown; temp_max?: unknown };
  rain?: { "3h"?: unknown };
}

interface OwmForecast {
  list?: OwmForecastSlot[];
}

/** Groups 3-hourly forecast slots into days. Pure; exported for tests. */
export function groupDaily(list: readonly OwmForecastSlot[]): DailyForecast[] {
  const days = new Map<string, DailyForecast>();
  for (const slot of list) {
    if (typeof slot.dt_txt !== "string") continue;
    const date = slot.dt_txt.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const lo = num(slot.main?.temp_min);
    const hi = num(slot.main?.temp_max);
    if (lo === null || hi === null) continue;
    const rain = num(slot.rain?.["3h"]) ?? 0;
    const d = days.get(date);
    if (d) {
      d.minC = Math.min(d.minC, lo);
      d.maxC = Math.max(d.maxC, hi);
      d.rainMm += rain;
    } else {
      days.set(date, { date, minC: lo, maxC: hi, rainMm: rain });
    }
  }
  return Array.from(days.values())
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 5)
    .map((d) => ({ ...d, minC: Math.round(d.minC), maxC: Math.round(d.maxC), rainMm: Math.round(d.rainMm * 10) / 10 }));
}

/** Pure parser; exported for tests. */
export function parseWeather(current: OwmCurrent, forecast: OwmForecast | null, now: Date): WeatherSnapshot {
  let rain: number | null = null;
  if (forecast && Array.isArray(forecast.list)) {
    rain = forecast.list.reduce((sum, slot) => sum + (num(slot.rain?.["3h"]) ?? 0), 0);
    rain = Math.round(rain * 10) / 10;
  }
  const wind = num(current.wind?.speed);
  const description = current.weather?.[0]?.description;
  return {
    placeName: typeof current.name === "string" && current.name ? current.name : null,
    tempC: num(current.main?.temp),
    feelsLikeC: num(current.main?.feels_like),
    humidity: num(current.main?.humidity),
    rainNext5dMm: rain,
    // OWM metric units report m/s.
    windKph: wind === null ? null : Math.round(wind * 3.6),
    condition: typeof description === "string" && description ? description : null,
    conditionKey: conditionKey(current.weather?.[0]?.id),
    daily: forecast && Array.isArray(forecast.list) ? groupDaily(forecast.list) : [],
    season: seasonFor(now),
    source: "live",
    fetchedAt: now.getTime(),
  };
}

function unavailable(error: WeatherError): WeatherSnapshot {
  return {
    placeName: null,
    tempC: null,
    feelsLikeC: null,
    humidity: null,
    rainNext5dMm: null,
    windKph: null,
    condition: null,
    conditionKey: null,
    daily: [],
    season: seasonFor(new Date()),
    source: "unavailable",
    fetchedAt: null,
    error,
  };
}

export async function getWeather(q: WeatherQuery, opts: { force?: boolean } = {}): Promise<WeatherSnapshot> {
  const key = CACHE_PREFIX + cacheKey(q);
  const cached = readStored<WeatherSnapshot>(key);
  if (!opts.force && cached?.fetchedAt && Date.now() - cached.fetchedAt < FRESH_MS) {
    return { ...cached, source: "cached" };
  }

  const apiKey = import.meta.env.VITE_OPENWEATHER_API_KEY;
  if (!apiKey) {
    return cached ? { ...cached, source: "cached", error: "no_key" } : unavailable("no_key");
  }

  try {
    const loc = locationParams(q);
    const [curRes, fcRes] = await Promise.all([
      fetchWithTimeout(`${API}/weather?${loc}&units=metric&appid=${apiKey}`, TIMEOUT_MS),
      fetchWithTimeout(`${API}/forecast?${loc}&units=metric&appid=${apiKey}`, TIMEOUT_MS),
    ]);
    if (!curRes.ok) {
      const error = weatherErrorFor(curRes.status);
      return cached ? { ...cached, source: "cached", error } : unavailable(error);
    }
    const current = (await curRes.json().catch(() => null)) as OwmCurrent | null;
    const forecast = fcRes.ok ? ((await fcRes.json().catch(() => null)) as OwmForecast | null) : null;
    const snapshot = current && typeof current === "object" ? parseWeather(current, forecast, new Date()) : null;
    // A 200 without a temperature is not usable weather: never cache or show it as live.
    if (!snapshot || snapshot.tempC === null) {
      return cached ? { ...cached, source: "cached", error: "bad_response" } : unavailable("bad_response");
    }
    writeStored(key, snapshot);
    return snapshot;
  } catch (err) {
    console.warn("[weather] fetch failed", err);
    const error: WeatherError = err instanceof Error && /timed out/.test(err.message) ? "timeout" : "network";
    return cached ? { ...cached, source: "cached", error } : unavailable(error);
  }
}

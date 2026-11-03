import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { conditionKey, getWeather, groupDaily, parseWeather, proxyErrorFor, seasonFor, weatherErrorFor } from "../lib/weather";
import { weatherQueryFor } from "../app/useWeather";
import { DISTRICT_HQ, TN_DISTRICTS } from "../domain/districts";
import en from "../i18n/en.json";
import ta from "../i18n/ta.json";

describe("weather", () => {
  it("maps months to Tamil Nadu seasons", () => {
    expect(seasonFor(new Date(2026, 6, 1))).toBe("kharif");
    expect(seasonFor(new Date(2026, 10, 1))).toBe("rabi");
    expect(seasonFor(new Date(2026, 0, 15))).toBe("rabi");
    expect(seasonFor(new Date(2026, 3, 1))).toBe("summer");
  });

  it("groups 3-hourly slots into days and skips bad slots", () => {
    const days = groupDaily([
      { dt_txt: "2026-11-01 03:00:00", main: { temp_min: 22.4, temp_max: 25 }, rain: { "3h": 1.2 } },
      { dt_txt: "2026-11-01 12:00:00", main: { temp_min: 24, temp_max: 31.6 }, rain: { "3h": 2.3 } },
      { dt_txt: "2026-11-02 12:00:00", main: { temp_min: 23, temp_max: 30 } },
      { dt_txt: "bad", main: { temp_min: 1, temp_max: 2 } },
      { dt_txt: "2026-11-03 12:00:00", main: {} },
    ]);
    expect(days).toEqual([
      { date: "2026-11-01", minC: 22, maxC: 32, rainMm: 3.5 },
      { date: "2026-11-02", minC: 23, maxC: 30, rainMm: 0 },
    ]);
  });

  it("parses current weather defensively", () => {
    const now = new Date(2026, 10, 1);
    const w = parseWeather(
      { name: "Madurai", main: { temp: 29, humidity: 70 }, wind: { speed: 5 }, weather: [{ description: "light rain" }] },
      { list: [{ rain: { "3h": 4 } }] },
      now
    );
    expect(w).toMatchObject({ placeName: "Madurai", tempC: 29, humidity: 70, windKph: 18, rainNext5dMm: 4, source: "live", season: "rabi" });
    expect(parseWeather({}, null, now)).toMatchObject({ placeName: null, tempC: null, rainNext5dMm: null, daily: [] });
  });
});

// ---- Regression: "Weather is not available for this location" for Viluppuram ----

const OK_CURRENT = { name: "Viluppuram", main: { temp: 27.4, feels_like: 31.2, humidity: 88 }, wind: { speed: 3 }, weather: [{ id: 500, description: "light rain" }] };
const OK_FORECAST = { list: [{ dt_txt: "2026-11-03 12:00:00", main: { temp_min: 24, temp_max: 30 }, rain: { "3h": 2.5 } }] };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("weather location query", () => {
  it("uses headquarters coordinates for every district (name lookups 404 for Viluppuram and others)", () => {
    for (const d of TN_DISTRICTS) {
      const c = DISTRICT_HQ[d.en];
      expect(c, d.en).toBeDefined();
      // Inside Tamil Nadu's bounding box.
      expect(c.lat).toBeGreaterThan(8);
      expect(c.lat).toBeLessThan(13.6);
      expect(c.lng).toBeGreaterThan(76.2);
      expect(c.lng).toBeLessThan(80.4);
    }
    expect(weatherQueryFor({ district: "Viluppuram", coords: null, source: "manual" })).toEqual({ lat: 11.94, lng: 79.49 });
  });

  it("prefers the device's own coordinates and never swaps in another district", () => {
    expect(weatherQueryFor({ district: "Viluppuram", coords: { lat: 12.25, lng: 79.42 }, source: "gps" })).toEqual({ lat: 12.25, lng: 79.42 });
    expect(weatherQueryFor({ district: "Chennai", coords: null, source: "manual" })).toEqual({ lat: 13.08, lng: 80.27 });
    expect(weatherQueryFor({ district: null, coords: null, source: "manual" })).toBeNull();
    expect(weatherQueryFor(null)).toBeNull();
  });
});

describe("getWeather (through the weather proxy)", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubEnv("VITE_MANDI_PROXY_URL", "https://proxy.test");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  const stubFetch = (impl: (url: string) => Promise<Response>) => {
    const f = vi.fn((url: string) => impl(url));
    vi.stubGlobal("fetch", f);
    return f;
  };
  const OK = { current: OK_CURRENT, forecast: OK_FORECAST, fetchedAt: 1 };
  const q = { lat: 11.94, lng: 79.49 };

  it("returns live weather with feels-like and forecast, via one proxy call by lat/lon", async () => {
    const f = stubFetch(() => Promise.resolve(json(200, OK)));
    const w = await getWeather(q);
    expect(w).toMatchObject({ source: "live", tempC: 27.4, feelsLikeC: 31.2, humidity: 88, windKph: 11, conditionKey: "lightRain", rainNext5dMm: 2.5 });
    expect(w.daily).toHaveLength(1);
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0][0]).toBe("https://proxy.test/weather?lat=11.94&lon=79.49");
  });

  it("never calls OpenWeatherMap directly or sends a key", async () => {
    const f = stubFetch(() => Promise.resolve(json(200, OK)));
    await getWeather({ lat: 11.94123, lng: 79.48789 });
    for (const [u] of f.mock.calls) {
      expect(u).not.toMatch(/openweathermap|appid/);
      expect(u).toMatch(/lat=11\.94&lon=79\.49$/); // rounded to ~1 km
    }
  });

  it("serves a fresh cache without calling the proxy again, labelled cached", async () => {
    const f = stubFetch(() => Promise.resolve(json(200, OK)));
    await getWeather(q);
    const again = await getWeather(q);
    expect(again.source).toBe("cached");
    expect(f).toHaveBeenCalledTimes(1);
  });

  it.each([
    [502, "invalid_key", "invalid_key"],
    [404, "not_found", "not_found"],
    [429, "rate_limited", "rate_limited"],
    [503, "upstream_rate_limited", "rate_limited"],
    [502, "server", "server"],
    [504, "timeout", "timeout"],
    [502, "bad_response", "bad_response"],
    [400, "bad_request", "not_found"],
    [403, "bad_request", "http"],
    [503, "not_configured", "no_key"],
    [500, undefined, "server"],
    [418, undefined, "http"],
  ] as const)("maps proxy %i %s to %s and shows no invented weather", async (status, code, error) => {
    stubFetch(() => Promise.resolve(json(status, code ? { error: code } : { message: "secret upstream text" })));
    const w = await getWeather(q);
    expect(w).toMatchObject({ source: "unavailable", error, tempC: null, feelsLikeC: null });
    expect(proxyErrorFor(status, code)).toBe(error);
  });

  it("maps raw upstream statuses for completeness", () => {
    expect([401, 403, 404, 429, 503, 418].map(weatherErrorFor)).toEqual(["invalid_key", "invalid_key", "not_found", "rate_limited", "server", "http"]);
  });

  it("rejects a malformed 200 and does not cache it", async () => {
    stubFetch(() => Promise.resolve(json(200, { current: { main: {} } })));
    expect(await getWeather(q)).toMatchObject({ source: "unavailable", error: "bad_response" });
    stubFetch(() => Promise.resolve(new Response("<html>", { status: 200 })));
    expect(await getWeather(q, { force: true })).toMatchObject({ source: "unavailable", error: "bad_response" });
  });

  it("reports network failure and timeout separately", async () => {
    stubFetch(() => Promise.reject(new TypeError("Failed to fetch")));
    expect(await getWeather(q)).toMatchObject({ source: "unavailable", error: "network" });
    vi.useFakeTimers();
    // fetchWithTimeout aborts the request; our stub ignores the signal, so emulate fetch's abort behaviour.
    vi.stubGlobal("fetch", (_u: string, init?: RequestInit) =>
      new Promise<Response>((_res, rej) => init?.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError"))))
    );
    const p = getWeather(q, { force: true });
    await vi.advanceTimersByTimeAsync(9000);
    expect(await p).toMatchObject({ source: "unavailable", error: "timeout" });
    vi.useRealTimers();
  });

  it("falls back to stale cache when offline, labelled cached with the reason", async () => {
    stubFetch(() => Promise.resolve(json(200, OK)));
    await getWeather(q);
    stubFetch(() => Promise.reject(new TypeError("Failed to fetch")));
    const w = await getWeather(q, { force: true });
    expect(w).toMatchObject({ source: "cached", error: "network", tempC: 27.4 });
  });

  it("reports a missing proxy without calling anything", async () => {
    vi.stubEnv("VITE_MANDI_PROXY_URL", "");
    vi.stubEnv("DEV", false);
    const f = stubFetch(() => Promise.resolve(json(200, OK)));
    expect(await getWeather(q)).toMatchObject({ source: "unavailable", error: "no_key" });
    expect(f).not.toHaveBeenCalled();
  });

  it("does not look weather up by name", async () => {
    const f = stubFetch(() => Promise.resolve(json(200, OK)));
    expect(await getWeather({ district: "Viluppuram" })).toMatchObject({ source: "unavailable", error: "not_found" });
    expect(f).not.toHaveBeenCalled();
  });
});

describe("weather text in Tamil and English", () => {
  it("maps OWM condition ids to groups", () => {
    expect([conditionKey(211), conditionKey(500), conditionKey(501), conditionKey(503), conditionKey(800), conditionKey(804), conditionKey("x")]).toEqual([
      "thunderstorm", "lightRain", "rain", "heavyRain", "clear", "overcast", null,
    ]);
  });

  it("has every error and condition label in both languages, with no raw API text", () => {
    const errors = ["no_key", "invalid_key", "not_found", "rate_limited", "server", "timeout", "bad_response", "network", "http"];
    const conds = ["thunderstorm", "drizzle", "lightRain", "rain", "heavyRain", "snow", "haze", "mist", "fog", "clear", "fewClouds", "clouds", "overcast"];
    for (const dict of [en, ta] as Record<string, any>[]) {
      for (const e of errors) expect(dict.weather.error[e], e).toMatch(/\S/);
      for (const c of conds) expect(dict.weather.cond[c], c).toMatch(/\S/);
      expect(dict.weather.feelsLike).toContain("{temp}");
      expect(dict.weather.staleNotice).toContain("{reason}");
    }
    for (const c of conds) expect(ta.weather.cond[c as keyof typeof ta.weather.cond]).toMatch(/[஀-௿]/);
  });
});

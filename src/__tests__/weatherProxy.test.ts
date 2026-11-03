import { describe, expect, it, vi } from "vitest";
import { RateLimiter, TtlCache } from "../server/mandiProxy";
import {
  WEATHER_CACHE_MS,
  handleWeatherProxy,
  parseCoords,
  reduceWeather,
  type WeatherProxyBody,
  type WeatherProxyDeps,
  type WeatherProxyResponse,
} from "../server/weatherProxy";

const KEY = "owm-secret-key-1234567890abcdef";
const CURRENT = { name: "Viluppuram", main: { temp: 27.4, feels_like: 31.2, humidity: 88, pressure: 1009 }, wind: { speed: 3 }, weather: [{ id: 500, description: "light rain", icon: "10d" }], coord: { lat: 1, lon: 2 } };
const FORECAST = { list: [{ dt_txt: "2026-11-03 12:00:00", main: { temp_min: 24, temp_max: 30, pressure: 1 }, rain: { "3h": 2.5 }, extra: "x" }], city: { population: 1 } };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const params = (s: string) => new URLSearchParams(s);

function deps(over: Partial<WeatherProxyDeps> = {}): WeatherProxyDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    apiKey: KEY,
    fetch: vi.fn((url: string) => {
      calls.push(url);
      return Promise.resolve(json(200, url.includes("/forecast") ? FORECAST : CURRENT));
    }),
    cache: new TtlCache<WeatherProxyBody>(WEATHER_CACHE_MS),
    limiter: new RateLimiter(30),
    inflight: new Map<string, Promise<WeatherProxyResponse>>(),
    now: () => 1_000,
    ...over,
    calls,
  };
}

describe("weather proxy input validation", () => {
  it.each([
    "",
    "lat=11.94",
    "lat=abc&lon=79.49",
    "lat=11.94&lon=79.49&q=Chennai",
    "lat=11.94&lon=79.49&appid=x",
    "lat=1e2&lon=79.49",
    "lat=51.5&lon=-0.12", // outside India
    "lat=11.94&lon=179",
    "lat=NaN&lon=79",
    "lat=11.94&lon=79.49%26appid%3Dx",
  ])("rejects %j", (s) => {
    expect(parseCoords(params(s))).toBeNull();
  });

  it("rounds to 2 decimals", () => {
    expect(parseCoords(params("lat=11.94123&lon=79.48789"))).toEqual({ lat: 11.94, lon: 79.49 });
    expect(parseCoords(params("lon=80.27&lat=13.08"))).toEqual({ lat: 13.08, lon: 80.27 });
  });

  it("returns 400 without calling upstream", async () => {
    const d = deps();
    const r = await handleWeatherProxy(params("lat=x&lon=y"), "c", d);
    expect(r.status).toBe(400);
    expect(r.body).toEqual({ error: "bad_request" });
    expect(d.calls).toHaveLength(0);
  });

  it("returns 503 not_configured when the key is missing", async () => {
    const d = deps({ apiKey: undefined });
    const r = await handleWeatherProxy(params("lat=11.94&lon=79.49"), "c", d);
    expect([r.status, r.body]).toEqual([503, { error: "not_configured" }]);
    expect(d.calls).toHaveLength(0);
  });
});

describe("weather proxy upstream", () => {
  it("calls only the two fixed endpoints with rounded coords, and trims the answer", async () => {
    const d = deps();
    const r = await handleWeatherProxy(params("lat=11.94123&lon=79.48789"), "c", d);
    expect(r.status).toBe(200);
    expect(d.calls).toHaveLength(2);
    for (const u of d.calls) expect(u).toMatch(/^https:\/\/api\.openweathermap\.org\/data\/2\.5\/(weather|forecast)\?lat=11\.94&lon=79\.49&units=metric&appid=/);
    const body = r.body as WeatherProxyBody;
    expect(body.current).toEqual({
      name: "Viluppuram",
      main: { temp: 27.4, feels_like: 31.2, humidity: 88 },
      wind: { speed: 3 },
      weather: [{ id: 500, description: "light rain" }],
    });
    expect(body.forecast).toEqual({ list: [{ dt_txt: "2026-11-03 12:00:00", main: { temp_min: 24, temp_max: 30 }, rain: { "3h": 2.5 } }] });
    expect(body.fetchedAt).toBe(1_000);
    expect(JSON.stringify(r)).not.toContain(KEY);
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("serves repeat requests from the cache", async () => {
    const d = deps();
    await handleWeatherProxy(params("lat=11.94&lon=79.49"), "c", d);
    const r = await handleWeatherProxy(params("lat=11.941&lon=79.489"), "c", d);
    expect(r.status).toBe(200);
    expect(r.headers["x-viva-cache"]).toBe("hit");
    expect(d.calls).toHaveLength(2);
  });

  it("expires the cache after 10 minutes", async () => {
    let t = 0;
    const d = deps({ now: () => t });
    await handleWeatherProxy(params("lat=11.94&lon=79.49"), "c", d);
    t = WEATHER_CACHE_MS + 1;
    await handleWeatherProxy(params("lat=11.94&lon=79.49"), "c", d);
    expect(d.calls).toHaveLength(4);
  });

  it("deduplicates concurrent identical requests", async () => {
    const d = deps();
    const [a, b] = await Promise.all([
      handleWeatherProxy(params("lat=11.94&lon=79.49"), "c1", d),
      handleWeatherProxy(params("lat=11.94&lon=79.49"), "c2", d),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(d.calls).toHaveLength(2);
  });

  it("rate-limits a client but still serves cached answers", async () => {
    const d = deps({ limiter: new RateLimiter(1) });
    expect((await handleWeatherProxy(params("lat=11.94&lon=79.49"), "c", d)).status).toBe(200);
    const limited = await handleWeatherProxy(params("lat=13.08&lon=80.27"), "c", d);
    expect([limited.status, limited.body]).toEqual([429, { error: "rate_limited" }]);
    expect((await handleWeatherProxy(params("lat=11.94&lon=79.49"), "c", d)).status).toBe(200);
  });

  it.each([
    [401, 502, "invalid_key"],
    [403, 502, "invalid_key"],
    [404, 404, "not_found"],
    [429, 503, "upstream_rate_limited"],
    [500, 502, "server"],
    [503, 502, "server"],
    [418, 502, "bad_response"],
  ] as const)("maps upstream %i to %i %s without echoing upstream text", async (up, status, error) => {
    const d = deps({ fetch: () => Promise.resolve(json(up, { cod: up, message: `bad key ${KEY}` })) });
    const r = await handleWeatherProxy(params("lat=11.94&lon=79.49"), "c", d);
    expect([r.status, r.body]).toEqual([status, { error }]);
    expect(r.headers["cache-control"]).toBe("no-store");
    expect(JSON.stringify(r)).not.toContain(KEY);
    // Errors are not cached.
    expect(d.cache?.get("11.94,79.49", 1_000)).toBeUndefined();
  });

  it("reports network errors without the error text (it can contain the URL and key)", async () => {
    const d = deps({ fetch: () => Promise.reject(new Error(`fetch failed for ...appid=${KEY}`)) });
    const r = await handleWeatherProxy(params("lat=11.94&lon=79.49"), "c", d);
    expect([r.status, r.body]).toEqual([502, { error: "network" }]);
    expect(JSON.stringify(r)).not.toContain(KEY);
  });

  it("times out", async () => {
    const d = deps({
      timeoutMs: 20,
      fetch: (_u, init) => new Promise((_res, rej) => init.signal.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")))),
    });
    const r = await handleWeatherProxy(params("lat=11.94&lon=79.49"), "c", d);
    expect([r.status, r.body]).toEqual([504, { error: "timeout" }]);
  });

  it("rejects a 200 without a temperature and does not cache it", async () => {
    const d = deps({ fetch: () => Promise.resolve(json(200, { main: {} })) });
    const r = await handleWeatherProxy(params("lat=11.94&lon=79.49"), "c", d);
    expect([r.status, r.body]).toEqual([502, { error: "bad_response" }]);
    expect(d.cache?.get("11.94,79.49", 1_000)).toBeUndefined();
  });

  it("returns current weather when only the forecast fails, but does not cache it", async () => {
    const d = deps({ fetch: (u) => (u.includes("/forecast") ? Promise.reject(new Error("x")) : Promise.resolve(json(200, CURRENT))) });
    const r = await handleWeatherProxy(params("lat=11.94&lon=79.49"), "c", d);
    expect(r.status).toBe(200);
    expect((r.body as WeatherProxyBody).forecast).toBeNull();
    expect(d.cache?.get("11.94,79.49", 1_000)).toBeUndefined();
  });

  it("reduceWeather drops malformed forecast slots and bounds strings", () => {
    const b = reduceWeather(
      { name: "x".repeat(500), main: { temp: 1 }, weather: "nope" },
      { list: [{ dt_txt: "bad", main: { temp_min: 1, temp_max: 2 } }, null, { dt_txt: "2026-11-03 12:00:00", main: { temp_min: "1", temp_max: 2 } }] },
      5
    );
    expect(b?.current.name).toHaveLength(80);
    expect(b?.current.weather).toEqual([{ id: null, description: null }]);
    expect(b?.forecast).toEqual({ list: [] });
    expect(reduceWeather(null, null, 0)).toBeNull();
  });
});

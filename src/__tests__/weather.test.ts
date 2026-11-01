import { describe, expect, it } from "vitest";
import { groupDaily, parseWeather, seasonFor } from "../lib/weather";

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

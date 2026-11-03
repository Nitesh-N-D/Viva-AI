import { expect, test, type Page } from "@playwright/test";
import { MOCK_WORKER } from "../playwright.config";

/**
 * Regression: Home showed "Weather is not available for this location" for a
 * saved district of Viluppuram, because OpenWeatherMap returns 404 for
 * q=Viluppuram,IN. Weather must be requested by the district's coordinates,
 * through the app's weather proxy (the OpenWeatherMap key is server-side only).
 * The proxy is mocked here; nothing leaves localhost.
 */
const CURRENT = { name: "Viluppuram", main: { temp: 27.4, feels_like: 31.2, humidity: 88 }, wind: { speed: 3 }, weather: [{ id: 500, description: "light rain" }] };
const FORECAST = {
  list: [
    { dt_txt: "2026-11-04 12:00:00", main: { temp_min: 24, temp_max: 30 }, rain: { "3h": 2.5 } },
    { dt_txt: "2026-11-05 12:00:00", main: { temp_min: 23, temp_max: 29 } },
  ],
};
const BODY = { current: CURRENT, forecast: FORECAST, fetchedAt: 0 };

async function setup(page: Page, lang: "en" | "ta", district: string) {
  const calls: string[] = [];
  const direct: string[] = [];
  await page.addInitScript(
    ([l, d]) => {
      localStorage.setItem("viva-ai:lang", l);
      localStorage.setItem("viva-ai:app", JSON.stringify({ state: { location: { district: d, coords: null, source: "manual" } }, version: 1 }));
    },
    [lang, district] as const
  );
  await page.route(/^https?:\/\/(?!localhost)/, (route) => {
    if (route.request().url().includes("openweathermap.org")) direct.push(route.request().url());
    return route.abort();
  });
  await page.route(`${MOCK_WORKER}/weather?**`, (route) => {
    calls.push(route.request().url());
    return route.fulfill({ json: BODY });
  });
  return { calls, direct };
}

for (const [lang, temp, feels, cond, place] of [
  ["en", "Temperature", "Feels like 31°C", "Light rain", "Viluppuram"],
  ["ta", "வெப்பநிலை", "உணரும் வெப்பம் 31°C", "லேசான மழை", "விழுப்புரம்"],
] as const) {
  test(`Viluppuram weather loads by coordinates via the proxy (${lang})`, async ({ page }) => {
    const { calls, direct } = await setup(page, lang, "Viluppuram");
    await page.goto("/#/");
    await expect(page.getByText("27°C")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(temp).first()).toBeVisible();
    await expect(page.getByText(feels)).toBeVisible();
    await expect(page.getByText(cond)).toBeVisible();
    await expect(page.getByText("88%")).toBeVisible();
    await expect(page.getByText(place).first()).toBeVisible();
    await expect(page.getByText(/not available for this location|இந்த இடத்திற்கு வானிலை கிடைக்கவில்லை/)).toHaveCount(0);
    expect(calls.length).toBeGreaterThan(0);
    for (const u of calls) {
      expect(u).toMatch(/\/weather\?lat=11\.94&lon=79\.49$/);
      expect(u).not.toMatch(/appid/);
    }
    expect(direct).toHaveLength(0);
    const text = await page.locator("body").innerText();
    expect(text).not.toMatch(/\{[a-zA-Z]+\}|undefined|light rain/);
    // Tamil shows the district in Tamil, never the English station name.
    if (lang === "ta") expect(text).not.toContain("Viluppuram");
  });
}

test("weather failure shows a translated message and a working retry", async ({ page }) => {
  await setup(page, "en", "Chennai");
  let fail = true;
  await page.route(`${MOCK_WORKER}/weather?**`, (route) =>
    fail ? route.fulfill({ status: 503, json: { error: "upstream_rate_limited", detail: "raw provider text" } }) : route.fulfill({ json: BODY })
  );
  await page.goto("/#/");
  const busy = page.getByText(/request limit reached/);
  await expect(busy).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("raw provider text")).toHaveCount(0);
  fail = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText("27°C")).toBeVisible();
});

test("weather not configured on the server shows an info notice without retry", async ({ page }) => {
  await setup(page, "en", "Chennai");
  await page.route(`${MOCK_WORKER}/weather?**`, (route) => route.fulfill({ status: 503, json: { error: "not_configured" } }));
  await page.goto("/#/");
  await expect(page.getByText(/not set up on the server/)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);
});

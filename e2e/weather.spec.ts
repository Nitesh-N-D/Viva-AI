import { expect, test, type Page } from "@playwright/test";

/**
 * Regression: Home showed "Weather is not available for this location" for a
 * saved district of Viluppuram, because OpenWeatherMap returns 404 for
 * q=Viluppuram,IN. Weather must be requested by the district's coordinates.
 * The OpenWeatherMap API is mocked here; nothing leaves localhost.
 */
const CURRENT = { name: "Viluppuram", main: { temp: 27.4, feels_like: 31.2, humidity: 88 }, wind: { speed: 3 }, weather: [{ id: 500, description: "light rain" }] };
const FORECAST = {
  list: [
    { dt_txt: "2026-11-04 12:00:00", main: { temp_min: 24, temp_max: 30 }, rain: { "3h": 2.5 } },
    { dt_txt: "2026-11-05 12:00:00", main: { temp_min: 23, temp_max: 29 } },
  ],
};

async function setup(page: Page, lang: "en" | "ta", district: string) {
  const owm: string[] = [];
  await page.addInitScript(
    ([l, d]) => {
      localStorage.setItem("viva-ai:lang", l);
      localStorage.setItem("viva-ai:app", JSON.stringify({ state: { location: { district: d, coords: null, source: "manual" } }, version: 1 }));
    },
    [lang, district] as const
  );
  await page.route(/^https?:\/\/(?!localhost)/, (route) => route.abort());
  await page.route(/api\.openweathermap\.org\/data\/2\.5\/(weather|forecast)/, (route) => {
    const url = route.request().url();
    owm.push(url);
    // Mirrors the real API: the official district spelling is unknown by name.
    if (/[?&]q=Viluppuram/.test(url)) return route.fulfill({ status: 404, json: { cod: "404", message: "city not found" } });
    return route.fulfill({ json: url.includes("/forecast") ? FORECAST : CURRENT });
  });
  return owm;
}

for (const [lang, temp, feels, cond] of [
  ["en", "Temperature", "Feels like 31°C", "Light rain"],
  ["ta", "வெப்பநிலை", "உணரும் வெப்பம் 31°C", "லேசான மழை"],
] as const) {
  test(`Viluppuram weather loads by coordinates (${lang})`, async ({ page }) => {
    const owm = await setup(page, lang, "Viluppuram");
    await page.goto("/#/");
    const noKey = page.getByText(/VITE_OPENWEATHER_API_KEY/);
    await expect.poll(async () => owm.length > 0 || (await noKey.count()) > 0, { timeout: 10_000 }).toBe(true);
    test.skip((await noKey.count()) > 0, "build has no OpenWeatherMap key");
    await expect(page.getByText("27°C")).toBeVisible();
    await expect(page.getByText(temp).first()).toBeVisible();
    await expect(page.getByText(feels)).toBeVisible();
    await expect(page.getByText(cond)).toBeVisible();
    await expect(page.getByText("88%")).toBeVisible();
    await expect(page.getByText(/not available for this location|இந்த இடத்திற்கு வானிலை கிடைக்கவில்லை/)).toHaveCount(0);
    expect(owm.length).toBeGreaterThan(0);
    for (const u of owm) expect(u).toMatch(/lat=11\.94&lon=79\.49/);
    expect(await page.locator("body").innerText()).not.toMatch(/\{[a-zA-Z]+\}|undefined|light rain/);
  });
}

test("weather failure shows a translated message and a working retry", async ({ page }) => {
  await setup(page, "en", "Chennai");
  let fail = true;
  await page.route(/api\.openweathermap\.org\/data\/2\.5\/(weather|forecast)/, (route) =>
    fail ? route.fulfill({ status: 429, json: { cod: 429, message: "raw provider text" } }) : route.fulfill({ json: route.request().url().includes("/forecast") ? FORECAST : CURRENT })
  );
  await page.goto("/#/");
  const busy = page.getByText(/request limit reached/);
  const noKey = page.getByText(/VITE_OPENWEATHER_API_KEY/);
  await expect(busy.or(noKey)).toBeVisible({ timeout: 10_000 });
  test.skip((await noKey.count()) > 0, "build has no OpenWeatherMap key");
  await expect(busy).toBeVisible();
  await expect(page.getByText("raw provider text")).toHaveCount(0);
  fail = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText("27°C")).toBeVisible();
});

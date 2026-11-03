import { expect, test, type Page } from "@playwright/test";

/**
 * Regression tests for the production crashes "Failed to fetch dynamically
 * imported module …/ScanScreen-*.js" (Leaf Check) and "…/CropRecommend-*.js",
 * plus the scanner navigation, Crop advice and location header workflows.
 * Hermetic: only the local preview server is reachable.
 */
async function setup(page: Page, lang: "en" | "ta" = "en") {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript((l) => {
    try {
      if (!localStorage.getItem("viva-ai:lang")) localStorage.setItem("viva-ai:lang", l);
    } catch {
      /* ignore */
    }
  }, lang);
  await page.route(/^https?:\/\/(?!localhost)/, (route) => route.abort());
  return errors;
}

const mainNav = (page: Page) => page.locator('nav[aria-label="Main navigation"]:visible').first();
const navItem = (page: Page, name: RegExp) =>
  mainNav(page).getByRole("link", { name }).or(mainNav(page).getByRole("button", { name })).first();

test("a chunk deleted by a new deploy recovers by itself (reload once, then the scanner opens)", async ({ page }) => {
  await setup(page);
  let loads = 0;
  page.on("load", () => loads++);
  // Before the reload the old chunk is gone (as after a deploy); after it the new release has it.
  await page.route(/\/assets\/ScanScreen-[^/]+\.js$/, (route) => (loads <= 1 ? route.fulfill({ status: 404, body: "" }) : route.continue()));
  await page.goto("/#/");
  await navItem(page, /Disease Scan/).click();
  await expect(page).toHaveURL(/#\/disease$/);
  await expect.poll(() => loads, { timeout: 15_000 }).toBe(2);
  await expect(page.getByRole("alert").filter({ hasText: "Something went wrong" })).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText("Failed to fetch dynamically imported module");
  await expect(navItem(page, /Disease Scan/)).toHaveAttribute("aria-current", "page");
});

test("a chunk that stays missing shows a reload screen without a reload loop, and the app stays usable", async ({ page }) => {
  await setup(page);
  let loads = 0;
  page.on("load", () => loads++);
  await page.route(/\/assets\/CropRecommend-[^/]+\.js$/, (route) => route.fulfill({ status: 404, body: "" }));
  await page.goto("/#/crops");
  const alert = page.getByRole("alert").filter({ hasText: "older version" });
  await expect(alert).toBeVisible({ timeout: 15_000 });
  await expect(alert.getByRole("button", { name: "Reload" })).toBeVisible();
  const settled = loads;
  await page.waitForTimeout(4000);
  expect(loads, "no automatic reload loop").toBe(settled);
  expect(settled).toBeLessThanOrEqual(2);
  // Other screens still work from the same tab.
  await navItem(page, /Soil Scan/).click();
  await expect(page).toHaveURL(/#\/soil$/);
  await expect(page.getByRole("alert").filter({ hasText: "older version" })).toHaveCount(0);
});

test("scanners: direct URLs, refresh, back/forward and independent active states", async ({ page }) => {
  const errors = await setup(page);
  await page.goto("/#/disease");
  await expect(navItem(page, /Disease Scan/)).toHaveAttribute("aria-current", "page");
  await page.reload();
  await expect(navItem(page, /Disease Scan/)).toHaveAttribute("aria-current", "page");
  await expect(navItem(page, /Soil Scan/)).not.toHaveAttribute("aria-current", "page");
  for (let i = 0; i < 3; i++) {
    await navItem(page, /Soil Scan/).click();
    await expect(page).toHaveURL(/#\/soil$/);
    await navItem(page, /Disease Scan/).click();
    await expect(page).toHaveURL(/#\/disease$/);
  }
  await page.goBack();
  await expect(page).toHaveURL(/#\/soil$/);
  await expect(navItem(page, /Soil Scan/)).toHaveAttribute("aria-current", "page");
  await page.goForward();
  await expect(page).toHaveURL(/#\/disease$/);
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("Crop advice: invalid pH is rejected, valid inputs give ranked crops, survives refresh", async ({ page }) => {
  const errors = await setup(page);
  await page.goto("/#/crops");
  await expect(page.getByRole("heading", { name: "Crop advice" }).first()).toBeVisible();
  const ph = page.getByLabel(/pH/).first();
  await ph.fill("15");
  await expect(page.getByText("Enter a pH between 3 and 10")).toBeVisible();
  await ph.fill("6.5");
  await expect(page.getByText("Enter a pH between 3 and 10")).toHaveCount(0);
  await page.getByLabel("Soil", { exact: true }).selectOption({ index: 1 });
  const results = page.getByRole("region", { name: "Recommended crops" }).or(page.locator('section[aria-label="Recommended crops"]')).first();
  await expect(results).toBeVisible();
  await expect(results.locator("article").first()).toBeVisible();
  await expect(results).toContainText(/Suitability \d+\/100/);
  // Ranked best first.
  const scores = (await results.locator("article .sr-only").allInnerTexts()).map((s) => Number(/(\d+)\/100/.exec(s)?.[1]));
  expect(scores.length).toBeGreaterThan(0);
  expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Crop advice" }).first()).toBeVisible();
  await navItem(page, /Home/).click();
  await page.goto("/#/crops");
  await expect(page.getByRole("heading", { name: "Crop advice" }).first()).toBeVisible();
  expect(errors).toEqual([]);
});

for (const [lang, unset] of [
  ["en", "Location not set"],
  ["ta", "இடம் குறிப்பிடப்படவில்லை"],
] as const) {
  test(`location header shows "${unset}" without a saved location and never a raw {token} (${lang})`, async ({ page }) => {
    await setup(page, lang);
    await page.goto("/#/");
    await expect(page.getByText(unset).first()).toBeVisible();
    const text = await page.locator("body").innerText();
    expect(text).not.toMatch(/\{[a-zA-Z]+\}|undefined|null/);
  });
}

import { expect, test, type Page } from "@playwright/test";

/** English UI, a saved district, a fake speech engine and no external network. */
async function setup(page: Page, opts: { lang?: "en" | "ta" } = {}) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript((lang) => {
    try {
      // Only on first load, so a language the user picks survives a reload.
      if (!localStorage.getItem("viva-ai:lang")) localStorage.setItem("viva-ai:lang", lang);
    } catch {
      /* ignore */
    }
    // Deterministic speech engine: voices exist, speak() fires start then waits.
    class FakeUtterance {
      text: string;
      lang = "";
      rate = 1;
      pitch = 1;
      volume = 1;
      voice: unknown = null;
      onstart: ((e: unknown) => void) | null = null;
      onend: ((e: unknown) => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      onboundary: ((e: unknown) => void) | null = null;
      constructor(text: string) {
        this.text = text;
      }
      addEventListener(type: string, fn: (e: unknown) => void) {
        (this as unknown as Record<string, unknown>)["on" + type] = fn;
      }
      removeEventListener() {}
    }
    const voices = [
      { lang: "en-IN", name: "Test English", voiceURI: "test-en", localService: true, default: true },
      { lang: "ta-IN", name: "Test Tamil", voiceURI: "test-ta", localService: true, default: false },
    ];
    const synth = {
      speaking: false,
      paused: false,
      pending: false,
      onvoiceschanged: null,
      getVoices: () => voices,
      speak(u: FakeUtterance) {
        synth.speaking = true;
        setTimeout(() => u.onstart?.({}), 10);
      },
      pause() {
        synth.paused = true;
      },
      resume() {
        synth.paused = false;
      },
      cancel() {
        synth.speaking = false;
        synth.paused = false;
      },
      addEventListener() {},
      removeEventListener() {},
    };
    Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
    Object.defineProperty(window, "SpeechSynthesisUtterance", { value: FakeUtterance, configurable: true });
  }, opts.lang ?? "en");
  // Hermetic: only the preview server is reachable.
  await page.route(/^https?:\/\/(?!localhost)/, (route) => route.abort());
  return errors;
}

const ROUTES = ["", "soil", "disease", "market", "assistant", "planner", "watchlist", "finance", "irrigation", "farm", "map", "settings", "crops", "guidance"];

test("every route renders without uncaught errors or raw {placeholders}", async ({ page }) => {
  const errors = await setup(page);
  for (const r of ROUTES) {
    await page.goto(`/#/${r}`);
    await expect(page.locator("main, [role=main], #root").first()).toBeVisible();
    await page.waitForTimeout(300);
    const text = await page.locator("body").innerText();
    expect(text, `route #/${r}`).not.toMatch(/\{[a-zA-Z]+\}/);
  }
  expect(errors).toEqual([]);
});

test("Soil Scan and Disease Scan are separate navigation items", async ({ page, isMobile }) => {
  await setup(page);
  await page.goto("/#/");
  // The sidebar on desktop, the bottom bar on mobile: whichever main navigation is showing.
  const nav = page.locator('nav[aria-label="Main navigation"]:visible').first();
  const soil = nav.getByRole("link", { name: /Soil Scan/ }).or(nav.getByRole("button", { name: /Soil Scan/ })).first();
  const disease = nav.getByRole("link", { name: /Disease Scan/ }).or(nav.getByRole("button", { name: /Disease Scan/ })).first();
  await expect(soil).toBeVisible();
  await expect(disease).toBeVisible();
  await soil.click();
  await expect(page).toHaveURL(/#\/soil$/);
  await disease.click();
  await expect(page).toHaveURL(/#\/disease$/);
  if (isMobile) {
    const box = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    expect(box.sw).toBeLessThanOrEqual(box.cw);
  }
});

test("language toggle switches to Tamil and is remembered", async ({ page }) => {
  await setup(page);
  await page.goto("/#/");
  await page.getByRole("button", { name: "Switch language" }).first().click();
  await expect(page.locator("html")).toHaveAttribute("lang", "ta");
  await page.reload();
  expect(await page.evaluate(() => localStorage.getItem("viva-ai:lang"))).toBe("ta");
});

test("read-aloud starts, pauses, resumes and stops", async ({ page }) => {
  await setup(page);
  await page.goto("/#/");
  await page.getByRole("button", { name: "Read this page aloud" }).first().click();
  const bar = page.getByRole("region", { name: "Read-aloud controls" }).or(page.getByLabel("Read-aloud controls")).first();
  await expect(bar).toBeVisible();
  await bar.getByRole("button", { name: "Pause" }).click();
  await bar.getByRole("button", { name: "Resume" }).click();
  await bar.getByRole("button", { name: "Stop" }).click();
  await expect(bar).toBeHidden();
});

const AI_URL = "https://mock-worker.invalid/ai/generate";

test("assistant shows an honest error when the AI service fails", async ({ page }) => {
  const errors = await setup(page);
  await page.route(AI_URL, (route) =>
    route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "upstream_unavailable" }) })
  );
  await page.goto("/#/assistant");
  const box = page.locator("#assistant-input");
  await box.fill("Why are my tomato leaves turning yellow?");
  await box.press("Enter");
  // The failure is shown as an error bubble; no answer is invented.
  await expect(page.locator(".bg-danger-50").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Suggestion:")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("assistant shows the answer from the Worker and sends the question and history", async ({ page }) => {
  await setup(page);
  const bodies: Record<string, unknown>[] = [];
  await page.route(AI_URL, async (route) => {
    bodies.push(route.request().postDataJSON());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ text: `Answer number ${bodies.length}`, model: "mock-model", finishReason: "STOP" }),
    });
  });
  await page.goto("/#/assistant");
  const box = page.locator("#assistant-input");
  await box.fill("First question");
  await box.press("Enter");
  await expect(page.getByText("Answer number 1")).toBeVisible();
  await box.fill("Follow-up question");
  await box.press("Enter");
  await expect(page.getByText("Answer number 2")).toBeVisible();
  expect(bodies[0]).toMatchObject({ task: "assistant", lang: "en", question: "First question" });
  expect(JSON.stringify(bodies[1])).toContain("Answer number 1"); // history carried
  expect(JSON.stringify(bodies)).not.toMatch(/api[-_]?key/i);
});

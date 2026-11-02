import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end smoke tests against a production build (`vite preview`).
 * Uses the locally installed Microsoft Edge (channel "msedge") so no browser
 * download is needed. All non-localhost network requests are blocked or mocked
 * inside the tests, so they never call the real Worker, Gemini or data.gov.in.
 *
 *   npm run e2e   (builds to dist-e2e itself)
 */
const PORT = 4174;
export const MOCK_WORKER = "https://mock-worker.invalid";

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: process.env.PW_CHANNEL || "msedge",
    serviceWorkers: "block",
    trace: "off",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Edge"], channel: process.env.PW_CHANNEL || "msedge" } },
    { name: "mobile", use: { viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true } },
  ],
  // A separate build whose Worker URL points at a fake host the tests mock with page.route().
  webServer: {
    command: `npx vite build --outDir dist-e2e && npx vite preview --outDir dist-e2e --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 240_000,
    env: { VITE_MANDI_PROXY_URL: MOCK_WORKER, VITE_AI_PROXY_URL: "" },
  },
});

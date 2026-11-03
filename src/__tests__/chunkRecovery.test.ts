/**
 * Regression tests for the production "Failed to fetch dynamically imported
 * module" crash (Leaf Check / ScanScreen and CropRecommend chunks missing
 * after a deploy).
 */
import React, { Suspense } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { RELOAD_GUARD_MS, recoverFromChunkError } from "../lib/appUpdate";
import { importWithRetry, isChunkLoadError, lazyWithRetry } from "../lib/errors";
import { ErrorBoundary } from "../shared/ui/ErrorBoundary";
// @ts-expect-error plain .mjs script without types
import { assetPaths } from "../../scripts/carry-forward-assets.mjs";
import firebaseJson from "../../firebase.json";
import { interpretGemini } from "../server/aiProxy";

const chunkError = () => new TypeError("Failed to fetch dynamically imported module: https://viva-ai-2cc88.web.app/assets/ScanScreen-BFy2HZyB.js");

function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

describe("chunk error detection", () => {
  it("recognises the browser messages for a missing or HTML-served chunk", () => {
    expect(isChunkLoadError(chunkError())).toBe(true);
    expect(isChunkLoadError(new TypeError("Importing a module script failed."))).toBe(true);
    expect(isChunkLoadError(new Error("Unable to preload CSS for /assets/x.css"))).toBe(true);
    expect(isChunkLoadError(new Error("Expected a JavaScript module script but the server responded with a MIME type of \"text/html\". Strict MIME type checking is enforced for module scripts per HTML spec. is not a valid JavaScript MIME type"))).toBe(true);
    expect(isChunkLoadError(new Error("x is undefined"))).toBe(false);
  });
});

describe("recoverFromChunkError", () => {
  it("reloads once, then refuses again within the guard window (no reload loop)", async () => {
    const storage = memoryStorage();
    const reload = vi.fn();
    let t = 1_000_000;
    const opts = { storage, reload, now: () => t, online: () => true };
    expect(await recoverFromChunkError(opts)).toBe(true);
    expect(await recoverFromChunkError(opts)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
    t += RELOAD_GUARD_MS + 1;
    expect(await recoverFromChunkError(opts)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("never reloads offline or without storage, but a button press (force) always can", async () => {
    const reload = vi.fn();
    expect(await recoverFromChunkError({ storage: memoryStorage(), reload, online: () => false })).toBe(false);
    expect(await recoverFromChunkError({ storage: null, reload, online: () => true })).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    const storage = memoryStorage();
    await recoverFromChunkError({ storage, reload, online: () => true });
    expect(await recoverFromChunkError({ storage, reload, online: () => true, force: true })).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });
});

describe("importWithRetry", () => {
  it("retries a failed chunk once and returns it when the second try works", async () => {
    const load = vi.fn().mockRejectedValueOnce(chunkError()).mockResolvedValueOnce("ok");
    const recover = vi.fn(() => true);
    await expect(importWithRetry(load, { delayMs: 0, recover })).resolves.toBe("ok");
    expect(recover).not.toHaveBeenCalled();
  });

  it("asks for recovery after two failures and surfaces the error when no reload happens", async () => {
    const load = vi.fn(() => Promise.reject(chunkError()));
    const recover = vi.fn(() => false);
    await expect(importWithRetry(load, { delayMs: 0, recover })).rejects.toThrow(/dynamically imported module/);
    expect(load).toHaveBeenCalledTimes(2);
    expect(recover).toHaveBeenCalledTimes(1);
  });

  it("does not retry or reload for ordinary errors", async () => {
    const load = vi.fn(() => Promise.reject(new Error("boom")));
    const recover = vi.fn(() => true);
    await expect(importWithRetry(load, { delayMs: 0, recover })).rejects.toThrow("boom");
    expect(load).toHaveBeenCalledTimes(1);
    expect(recover).not.toHaveBeenCalled();
  });
});

describe("lazyWithRetry", () => {
  it("is not stuck on a failed import: the next render loads the screen", async () => {
    // A permanent failure must end on the error screen (not retry forever); after the
    // boundary is reset (route change) the screen imports again and renders.
    let fail = true;
    const load = vi.fn(() => (fail ? Promise.reject(new Error("transient")) : Promise.resolve(Screen)));
    const Screen = () => React.createElement("p", null, "Leaf check ready");
    const Lazy = lazyWithRetry(load);
    const tree = (route: string) =>
      React.createElement(ErrorBoundary, { resetKey: route, children: React.createElement(Suspense, { fallback: "loading" }, React.createElement(Lazy)) });
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const el = document.createElement("div");
    const root = createRoot(el);
    const settle = async () => {
      for (let i = 0; i < 5; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
    };
    await act(async () => root.render(tree("#/disease")));
    await settle();
    expect(el.querySelector("[role=alert]")).not.toBeNull();
    const callsAfterFailure = load.mock.calls.length;
    await settle();
    expect(load.mock.calls.length).toBe(callsAfterFailure); // no retry loop
    fail = false;
    await act(async () => root.render(tree("#/soil")));
    await settle();
    expect(el.textContent).toBe("Leaf check ready");
    root.unmount();
    spy.mockRestore();
  });
});

describe("deploy safety", () => {
  it("reads every hashed asset of the live release from index.html and the sw.js precache list", () => {
    const html = `<script type="module" src="/assets/index-DZsbkha7.js"></script><link href="/assets/index-x__2cqcz.css">`;
    const sw = `[{url:"assets/ScanScreen-BFy2HZyB.js",revision:null},{url:"assets/CropRecommend-1isWoCWp.js",revision:null},{url:"index.html",revision:"1"}]`;
    expect(assetPaths(html + sw).sort()).toEqual([
      "/assets/CropRecommend-1isWoCWp.js",
      "/assets/ScanScreen-BFy2HZyB.js",
      "/assets/index-DZsbkha7.js",
      "/assets/index-x__2cqcz.css",
    ]);
  });

  it("hosting never serves the app shell for a missing asset and never lets the shell go stale", () => {
    const h = firebaseJson.hosting as { rewrites: { source: string }[]; headers: { source: string; headers: { key: string; value: string }[] }[] };
    expect(h.rewrites.map((r) => r.source)).not.toContain("**");
    const cc = (src: string) => h.headers.find((x) => x.source === src)?.headers.find((x) => x.key === "Cache-Control")?.value;
    expect(cc("/assets/**")).toMatch(/immutable/);
    expect(cc("/sw.js")).toBe("no-cache");
    expect(cc("**/*.html")).toBe("no-cache");
    expect(cc("/")).toBe("no-cache");
  });
});

describe("AI proxy 400 detail", () => {
  it("passes on Gemini's error status name only", () => {
    const a = interpretGemini(400, { error: { status: "FAILED_PRECONDITION" } } as never, "m");
    expect(a).toMatchObject({ ok: false, code: "bad_request", detail: "rejected by the AI service (FAILED_PRECONDITION)" });
    const b = interpretGemini(400, { error: { status: "some free text with key=abc" } } as never, "m");
    expect(b).toMatchObject({ detail: "rejected by the AI service" });
  });
});

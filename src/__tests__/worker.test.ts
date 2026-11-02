// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../../server/mandi-worker/index";

const ORIGIN = "https://viva-ai-2cc88.web.app";
const env = { GEMINI_API_KEY: "SECRET-GEMINI-KEY", AGMARKNET_API_KEY: "SECRET-MANDI-KEY", ALLOWED_ORIGINS: `${ORIGIN},http://localhost:5173` };
const body = JSON.stringify({ task: "assistant", lang: "en", question: "hello" });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("production Worker routing", () => {
  it("serves the AI route at /ai/generate for the app origin, keeping the key server-side", async () => {
    const upstream = vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "hi farmer" }] }, finishReason: "STOP" }] }), { status: 200 }));
    vi.stubGlobal("fetch", upstream);
    const r = await worker.fetch(new Request("https://w.example/ai/generate", { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body }), env);
    expect(r.status).toBe(200);
    expect(r.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    const text = await r.text();
    expect(JSON.parse(text).text).toBe("hi farmer");
    expect(text).not.toContain("SECRET");
    const [url] = upstream.mock.calls[0] as unknown as [string];
    expect(url).not.toContain("SECRET");
  });

  it("refuses the AI route for other origins and non-POST methods", async () => {
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);
    const foreign = await worker.fetch(new Request("https://w.example/ai/generate", { method: "POST", headers: { origin: "https://evil.example" }, body }), env);
    expect(foreign.status).toBe(403);
    const get = await worker.fetch(new Request("https://w.example/ai/generate", { headers: { origin: ORIGIN } }), env);
    expect(get.status).toBe(405);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("answers CORS preflight only for allowed origins and 404s unknown paths", async () => {
    const ok = await worker.fetch(new Request("https://w.example/ai/generate", { method: "OPTIONS", headers: { origin: ORIGIN } }), env);
    expect(ok.status).toBe(204);
    expect(ok.headers.get("access-control-allow-methods")).toContain("POST");
    const bad = await worker.fetch(new Request("https://w.example/ai/generate", { method: "OPTIONS", headers: { origin: "https://evil.example" } }), env);
    expect(bad.headers.get("access-control-allow-origin")).toBeNull();
    const missing = await worker.fetch(new Request("https://w.example/generate", { method: "POST", headers: { origin: ORIGIN }, body }), env);
    expect(missing.status).toBe(404);
  });
});

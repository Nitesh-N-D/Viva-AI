/**
 * Cloudflare Worker entry for the production server-side proxies.
 *
 *   GET  /prices        mandi prices (data.gov.in), src/server/mandiProxy.ts
 *   POST /ai/generate   Gemini farming assistant,   src/server/aiProxy.ts
 *
 * Firebase Hosting on the Spark plan cannot run server code, so the proxies
 * are deployed as one free-tier Cloudflare Worker and the app is built with
 * VITE_MANDI_PROXY_URL pointing at it. The AI client calls `${url}/ai/generate`
 * on the same base URL (or on VITE_AI_PROXY_URL, if set). Keys are Worker secrets
 * (`wrangler secret put AGMARKNET_API_KEY`, `wrangler secret put GEMINI_API_KEY`),
 * never VITE_* variables. See docs/DEPLOYMENT_GUIDE.md.
 */
import { RateLimiter, TtlCache, CACHE_TTL_MS, handleMandiProxy } from "../../src/server/mandiProxy";
import { AI_LIMITS, AI_RATE_PER_MINUTE, geminiModels, handleAiProxy } from "../../src/server/aiProxy";
import type { MandiProxyBody } from "../../src/lib/mandiQuery";

interface Env {
  AGMARKNET_API_KEY?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  /** Comma-separated list of origins allowed to call the proxy. */
  ALLOWED_ORIGINS?: string;
}

// Per-isolate state: best-effort cache and rate limit.
const cache = new TtlCache<MandiProxyBody>(CACHE_TTL_MS);
const limiter = new RateLimiter();
const aiLimiter = new RateLimiter(AI_RATE_PER_MINUTE);

function corsHeaders(origin: string | null, env: Env): Record<string, string> {
  const allowed = (env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!origin || !allowed.includes(origin)) return { vary: "Origin" };
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    vary: "Origin",
  };
}

function json(status: number, body: unknown, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const cors = corsHeaders(request.headers.get("origin"), env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...cors, "access-control-max-age": "86400" } });
    const client = request.headers.get("cf-connecting-ip") ?? "unknown";

    if (url.pathname === "/ai/generate") {
      if (request.method !== "POST") return json(405, { error: "bad_request", detail: "POST only" }, cors);
      // The AI endpoint costs money per call: only the app's own origins may use it.
      if (!cors["access-control-allow-origin"]) return json(403, { error: "bad_request", detail: "origin not allowed" }, cors);
      const raw = await request.text();
      if (raw.length > AI_LIMITS.bodyBytes) return json(413, { error: "bad_request", detail: "request too large" }, cors);
      const r = await handleAiProxy(raw, client, {
        apiKey: env.GEMINI_API_KEY,
        models: geminiModels(env as unknown as Record<string, string | undefined>),
        fetch: (u, init) => fetch(u, init),
        limiter: aiLimiter,
      });
      return new Response(JSON.stringify(r.body), { status: r.status, headers: { ...r.headers, ...cors } });
    }

    if (request.method !== "GET" || url.pathname !== "/prices") return json(404, { error: "bad_request" }, cors);
    const r = await handleMandiProxy(url.searchParams, client, {
      apiKey: env.AGMARKNET_API_KEY,
      fetch: (u, init) => fetch(u, init),
      cache,
      limiter,
    });
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { ...r.headers, ...cors } });
  },
};

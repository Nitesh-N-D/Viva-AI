/**
 * Cloudflare Worker entry for the production mandi price proxy.
 *
 * Firebase Hosting on the Spark plan cannot run server code, so the proxy is
 * deployed as a free-tier Cloudflare Worker and the app is built with
 * VITE_MANDI_PROXY_URL pointing at it. The data.gov.in key is a Worker
 * secret (`wrangler secret put AGMARKNET_API_KEY`), never a VITE_* variable.
 * See docs/DEPLOYMENT_GUIDE.md.
 */
import { RateLimiter, TtlCache, CACHE_TTL_MS, handleMandiProxy } from "../../src/server/mandiProxy";
import type { MandiProxyBody } from "../../src/lib/mandiQuery";

interface Env {
  AGMARKNET_API_KEY?: string;
  /** Comma-separated list of origins allowed to call the proxy. */
  ALLOWED_ORIGINS?: string;
}

// Per-isolate state: best-effort cache and rate limit.
const cache = new TtlCache<MandiProxyBody>(CACHE_TTL_MS);
const limiter = new RateLimiter();

function corsHeaders(origin: string | null, env: Env): Record<string, string> {
  const allowed = (env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!origin || !allowed.includes(origin)) return { vary: "Origin" };
  return { "access-control-allow-origin": origin, "access-control-allow-methods": "GET, OPTIONS", vary: "Origin" };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const cors = corsHeaders(request.headers.get("origin"), env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...cors, "access-control-max-age": "86400" } });
    if (request.method !== "GET" || url.pathname !== "/prices") {
      return new Response(JSON.stringify({ error: "bad_request" }), { status: 404, headers: { "content-type": "application/json", ...cors } });
    }
    const client = request.headers.get("cf-connecting-ip") ?? "unknown";
    const r = await handleMandiProxy(url.searchParams, client, {
      apiKey: env.AGMARKNET_API_KEY,
      fetch: (u, init) => fetch(u, init),
      cache,
      limiter,
    });
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { ...r.headers, ...cors } });
  },
};

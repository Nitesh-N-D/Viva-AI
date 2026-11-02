/**
 * lib/ai/aiClient.ts — browser client for the server-side Gemini proxy.
 *
 * The browser never holds the Gemini key. It calls:
 *   - `${VITE_AI_PROXY_URL}/ai/generate` when set (a separately deployed copy
 *     of the Worker),
 *   - else `${VITE_MANDI_PROXY_URL}/ai/generate` (the same Cloudflare Worker),
 *   - else /api-ai/generate on the Vite dev / preview server.
 * In a production build with no proxy configured, AI features show
 * "not configured" instead of failing silently.
 */
import { AppError, kindFromStatus } from "../errors";
import type { AiLang, AiTask, AiTurn } from "../../server/aiProxy";

export type { AiTask, AiTurn } from "../../server/aiProxy";

export interface AiAnswer {
  text: string;
  model: string;
  at: number;
}

const CLIENT_TIMEOUT_MS = 75_000; // server: 30 s per attempt, at most 3 attempts with backoff

export function aiEndpoint(): string | null {
  const env = import.meta.env;
  // Both URLs are Worker base URLs; the Worker serves the AI route at /ai/generate.
  if (env.VITE_AI_PROXY_URL) return `${env.VITE_AI_PROXY_URL.replace(/\/$/, "")}/ai/generate`;
  if (env.VITE_MANDI_PROXY_URL) return `${env.VITE_MANDI_PROXY_URL.replace(/\/$/, "")}/ai/generate`;
  return env.DEV ? "/api-ai/generate" : null;
}

export function isAiConfigured(): boolean {
  return aiEndpoint() !== null;
}

export interface AskOptions {
  task: AiTask;
  lang: AiLang;
  question?: string;
  context?: string;
  history?: AiTurn[];
  signal?: AbortSignal;
}

export async function askAi(opts: AskOptions, fetchImpl: typeof fetch = fetch): Promise<AiAnswer> {
  const url = aiEndpoint();
  if (!url) throw new AppError("not_configured");
  if (typeof navigator !== "undefined" && !navigator.onLine) throw new AppError("offline");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  opts.signal?.addEventListener("abort", onAbort);
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        task: opts.task,
        lang: opts.lang,
        question: opts.question,
        context: opts.context,
        history: opts.history?.slice(-10).map((h) => ({ role: h.role, text: h.text.slice(0, 2000) })),
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (controller.signal.aborted) throw new AppError(opts.signal?.aborted ? "unknown" : "timeout", opts.signal?.aborted ? "cancelled" : undefined);
    throw new AppError("network", err instanceof Error ? err.message : undefined);
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new AppError(res.ok ? "invalid_response" : kindFromStatus(res.status), undefined, res.status);
  }
  const o = (body ?? {}) as Record<string, unknown>;
  if (!res.ok) throw new AppError(kindFromStatus(res.status, typeof o.error === "string" ? o.error : undefined), String(o.detail ?? o.error ?? ""), res.status);
  if (typeof o.text !== "string" || !o.text.trim()) throw new AppError("invalid_response");
  return { text: o.text, model: typeof o.model === "string" ? o.model : "unknown", at: Date.now() };
}

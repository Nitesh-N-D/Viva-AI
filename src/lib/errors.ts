/**
 * lib/errors.ts — one classification for every failure the app can show.
 *
 * Network, HTTP and proxy errors are mapped to a small set of kinds, each
 * with a Tamil/English message and a recovery action (errors.* in i18n).
 * Nothing here logs request bodies, URLs with keys, or tokens.
 */
import { t, type Lang } from "../i18n";

export type ErrorKind =
  | "offline"
  | "network"
  | "timeout"
  | "bad_request"
  | "session"
  | "forbidden"
  | "not_found"
  | "rate_limited"
  | "quota"
  | "server"
  | "unavailable"
  | "not_configured"
  | "invalid_response"
  | "blocked"
  | "storage"
  | "unknown";

export type RecoveryAction = "retry" | "wait" | "check_connection" | "sign_in" | "edit_input" | "contact" | "none";

export class AppError extends Error {
  constructor(
    public kind: ErrorKind,
    message?: string,
    public status?: number
  ) {
    super(message ?? kind);
    this.name = "AppError";
  }
}

/** HTTP status (plus an optional proxy error code) → kind. */
export function kindFromStatus(status: number, code?: string): ErrorKind {
  if (code === "not_configured") return "not_configured";
  if (code === "upstream_quota") return "quota";
  if (code === "blocked") return "blocked";
  if (code === "upstream_timeout") return "timeout";
  if (code === "malformed" || code === "upstream_malformed") return "invalid_response";
  if (code === "upstream_auth") return "unavailable";
  if (status === 422) return "blocked";
  if (status === 400 || status === 413) return "bad_request";
  if (status === 401) return "session";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 408 || status === 504) return "timeout";
  if (status === 429) return "rate_limited";
  if (status === 503) return "unavailable";
  if (status >= 500) return "server";
  return "unknown";
}

/** Any thrown value → AppError. */
export function classifyError(err: unknown, online: boolean = typeof navigator === "undefined" ? true : navigator.onLine): AppError {
  if (err instanceof AppError) return err;
  if (!online) return new AppError("offline");
  if (err instanceof DOMException && (err.name === "AbortError" || err.name === "TimeoutError")) return new AppError("timeout");
  if (err instanceof DOMException && (err.name === "QuotaExceededError" || err.name === "InvalidStateError")) return new AppError("storage");
  if (err instanceof SyntaxError) return new AppError("invalid_response");
  const msg = err instanceof Error ? err.message : String(err);
  if (/timed out|timeout/i.test(msg)) return new AppError("timeout");
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(msg)) return new AppError("network");
  if (/permission-denied|insufficient permissions/i.test(msg)) return new AppError("forbidden");
  if (/unauthenticated|auth\/|id-token-expired/i.test(msg)) return new AppError("session");
  return new AppError("unknown", msg);
}

export function recoveryFor(kind: ErrorKind): RecoveryAction {
  switch (kind) {
    case "offline":
    case "network":
      return "check_connection";
    case "timeout":
    case "server":
    case "invalid_response":
    case "unknown":
    case "storage":
      return "retry";
    case "rate_limited":
    case "quota":
    case "unavailable":
      return "wait";
    case "session":
      return "sign_in";
    case "bad_request":
    case "blocked":
      return "edit_input";
    case "forbidden":
    case "not_found":
    case "not_configured":
      return "contact";
  }
}

/** Retry only makes sense for transient kinds. */
export function isRetryable(kind: ErrorKind): boolean {
  return ["offline", "network", "timeout", "server", "unavailable", "rate_limited", "invalid_response", "unknown", "storage"].includes(kind);
}

export function errorMessage(err: unknown, lang?: Lang): { title: string; action: string; kind: ErrorKind; retryable: boolean } {
  const e = classifyError(err);
  return {
    kind: e.kind,
    title: t(`errors.${e.kind}`, undefined, lang),
    action: t(`errors.action_${recoveryFor(e.kind)}`, undefined, lang),
    retryable: isRetryable(e.kind),
  };
}

/** Console logging that strips anything that looks like a key or token. */
export function safeLog(scope: string, err: unknown): void {
  const raw = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  const redacted = raw.replace(/(key|token|secret|api-key)=([^&\s]+)/gi, "$1=[redacted]").replace(/AIza[0-9A-Za-z_-]{20,}/g, "[redacted]");
  console.error(`[${scope}]`, redacted);
}

/** Installs global handlers once: unhandled promise rejections and uncaught errors are logged safely. */
let installed = false;
export function installGlobalErrorHandlers(onError?: (e: AppError) => void): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("unhandledrejection", (ev) => {
    safeLog("unhandled", ev.reason);
    onError?.(classifyError(ev.reason));
  });
  window.addEventListener("error", (ev) => {
    // Resource load errors (img/script) have no .error; ignore those.
    if (ev.error) safeLog("uncaught", ev.error);
  });
}

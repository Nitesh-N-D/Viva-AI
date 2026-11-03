import React from "react";
import { t } from "../../i18n";
import { recoverFromChunkError } from "../../lib/appUpdate";
import { isChunkLoadError, resetFailedLazyScreens, safeLog } from "../../lib/errors";
import { Button } from "./Button";

interface Props {
  children: React.ReactNode;
  /** Changing this key (e.g. the route) clears a previous error. */
  resetKey?: string;
  onHome?: () => void;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    safeLog("screen crashed", error);
    if (import.meta.env?.DEV) console.error(info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.retry();
  }

  /** Clears the error and lets failed lazy screens import again on the next render. */
  retry = () => {
    resetFailedLazyScreens();
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    // A missing code chunk usually means this tab runs an older release:
    // offer a reload that first activates the waiting service worker.
    // Offline, a reload cannot help, so say so and offer a plain retry
    // (lazyWithRetry starts a fresh import on the next render).
    const chunk = isChunkLoadError(error);
    const offline = chunk && typeof navigator !== "undefined" && navigator.onLine === false;
    const body = offline ? t("errors.chunkOffline") : chunk ? t("errors.chunkLoad") : t("common.errorBody");
    return (
      <div role="alert" className="flex flex-col items-center gap-3 text-center py-12 px-4">
        <p className="text-4xl" aria-hidden="true">
          ⚠
        </p>
        <h2 className="font-display font-bold text-lg">{t("common.errorTitle")}</h2>
        <p className="text-sm text-soil-600 max-w-sm">{body}</p>
        {error.message && (
          <details className="text-xs text-soil-500 max-w-sm" data-no-read>
            <summary className="cursor-pointer">{t("errors.details")}</summary>
            <span className="font-mono break-all">{error.message}</span>
          </details>
        )}
        <div className="flex gap-2">
          {chunk && !offline ? (
            <Button onClick={() => void recoverFromChunkError({ force: true })}>{t("errors.reload")}</Button>
          ) : (
            <Button variant="secondary" onClick={this.retry}>
              {t("common.retry")}
            </Button>
          )}
          {this.props.onHome && <Button variant={chunk ? "secondary" : "primary"} onClick={this.props.onHome}>{t("common.goHome")}</Button>}
        </div>
      </div>
    );
  }
}

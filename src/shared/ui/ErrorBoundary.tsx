import React from "react";
import { t } from "../../i18n";
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
    console.error("[ui] screen crashed", error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="flex flex-col items-center gap-3 text-center py-12 px-4">
        <p className="text-4xl" aria-hidden="true">
          ⚠
        </p>
        <h2 className="font-display font-bold text-lg">{t("common.errorTitle")}</h2>
        <p className="text-sm text-soil-600 max-w-sm">{t("common.errorBody")}</p>
        <p className="text-xs text-soil-500 font-mono break-all max-w-sm">{this.state.error.message}</p>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => this.setState({ error: null })}>
            {t("common.retry")}
          </Button>
          {this.props.onHome && <Button onClick={this.props.onHome}>{t("common.goHome")}</Button>}
        </div>
      </div>
    );
  }
}

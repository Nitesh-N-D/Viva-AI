import React from "react";
import { useT } from "../../i18n";

type Tone = "info" | "warning" | "error" | "success" | "neutral";

const toneClasses: Record<Tone, string> = {
  info: "bg-info-50 text-info-600 border-info-600/20",
  warning: "bg-ember-50 text-ember-600 border-ember-400/40",
  error: "bg-danger-50 text-danger-600 border-danger-600/20",
  success: "bg-leaf-50 text-leaf-800 border-leaf-400/40",
  neutral: "bg-soil-50 text-soil-700 border-soil-200",
};

const toneIcons: Record<Tone, string> = {
  info: "ℹ",
  warning: "⚠",
  error: "✕",
  success: "✓",
  neutral: "•",
};

export function Notice({
  tone = "info",
  title,
  children,
  action,
}: {
  tone?: Tone;
  title?: React.ReactNode;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`flex gap-3 rounded-card border p-3 text-sm ${toneClasses[tone]}`}
    >
      <span aria-hidden="true" className="font-bold leading-5">
        {toneIcons[tone]}
      </span>
      <div className="flex-1 min-w-0">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={title ? "mt-0.5" : ""}>{children}</div>}
        {action && <div className="mt-2">{action}</div>}
      </div>
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  const { t } = useT();
  return (
    <div role="status" className="flex items-center gap-3 text-soil-600 py-4">
      <span className="w-6 h-6 border-[3px] border-leaf-400 border-t-transparent rounded-full animate-spin" aria-hidden="true" />
      <span className="text-sm">{label ?? t("common.loading")}</span>
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-md bg-soil-100 ${className}`} />;
}

export function EmptyState({ icon, title, body, action }: { icon?: string; title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center text-center gap-2 py-8 px-4">
      {icon && (
        <span className="text-4xl" aria-hidden="true">
          {icon}
        </span>
      )}
      <p className="font-display font-semibold text-soil-900">{title}</p>
      {body && <p className="text-sm text-soil-600 max-w-sm">{body}</p>}
      {action}
    </div>
  );
}

type BadgeTone = "live" | "cached" | "unavailable" | "demo" | "neutral" | "warning";

const badgeClasses: Record<BadgeTone, string> = {
  live: "bg-leaf-50 text-leaf-800 border-leaf-400/50",
  cached: "bg-ember-50 text-ember-600 border-ember-400/50",
  unavailable: "bg-soil-100 text-soil-700 border-soil-200",
  demo: "bg-info-50 text-info-600 border-info-600/30",
  neutral: "bg-soil-50 text-soil-700 border-soil-200",
  warning: "bg-ember-50 text-ember-600 border-ember-400/50",
};

export function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${badgeClasses[tone]}`}>
      {children}
    </span>
  );
}

/** Data-freshness badge used by weather, mandi and map. */
export function SourceBadge({ source }: { source: "live" | "cached" | "unavailable" }) {
  const { t } = useT();
  const label =
    source === "live" ? t("common.sourceLive") : source === "cached" ? t("common.sourceCached") : t("common.sourceUnavailable");
  return (
    <Badge tone={source}>
      <span aria-hidden="true">{source === "live" ? "●" : source === "cached" ? "◐" : "○"}</span>
      {label}
    </Badge>
  );
}

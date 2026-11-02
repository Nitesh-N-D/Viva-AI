import React from "react";
import { useT } from "../../i18n";

interface ScreenProps {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  actions?: React.ReactNode;
  children: React.ReactNode;
  wide?: boolean;
}

/**
 * Page header + content column used by every screen inside the AppShell.
 * Reading the screen aloud is handled globally by the header's read-aloud
 * button (shared/voice/ReadAloud), which reads everything visible here.
 */
export function Screen({ title, subtitle, onBack, actions, children, wide }: ScreenProps) {
  const { t } = useT();
  return (
    <div className={`mx-auto w-full ${wide ? "max-w-6xl" : "max-w-3xl"} px-4 pb-6`}>
      <div className="flex items-start gap-2 pt-4 pb-3">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="min-w-[44px] min-h-[44px] -ml-2 rounded-tile text-xl text-soil-700 hover:bg-soil-100"
            aria-label={t("common.back")}
          >
            ←
          </button>
        )}
        <div className="flex-1 min-w-0">
          <h1 className="font-display font-bold text-2xl text-soil-900 leading-tight">{title}</h1>
          {subtitle && <p className="text-sm text-soil-600 mt-0.5">{subtitle}</p>}
        </div>
        {actions}
      </div>
      <div className="flex flex-col gap-4">{children}</div>
    </div>
  );
}

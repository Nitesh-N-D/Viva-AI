import React from "react";
import { voiceEngine } from "../voice/VoiceEngine";
import { useT } from "../../i18n";

interface ScreenProps {
  title: string;
  subtitle?: string;
  /** Narration for the "read aloud" button; omit to hide the button. */
  speakText?: string;
  onBack?: () => void;
  actions?: React.ReactNode;
  children: React.ReactNode;
  wide?: boolean;
}

/** Page header + content column used by every screen inside the AppShell. */
export function Screen({ title, subtitle, speakText, onBack, actions, children, wide }: ScreenProps) {
  const { t, lang } = useT();
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
        {speakText && voiceEngine.canSpeak() && (
          <button
            type="button"
            onClick={() => void voiceEngine.speak(speakText, lang)}
            className="min-w-[44px] min-h-[44px] rounded-tile text-xl hover:bg-soil-100"
            aria-label={t("common.speakScreen")}
            title={t("common.speakScreen")}
          >
            <span aria-hidden="true">🔊</span>
          </button>
        )}
      </div>
      <div className="flex flex-col gap-4">{children}</div>
    </div>
  );
}

/**
 * Global "read this page aloud" control.
 *
 * One button in the app header starts reading the visible page (see
 * pageText.ts); a small control bar then offers pause/resume, next section,
 * restart and stop. Every other speaker in the app (chat answers, AI
 * explanations) goes through the same voiceEngine session, so readings never
 * overlap and the bar always shows what is being read.
 */
import React, { useCallback, useEffect, useSyncExternalStore } from "react";
import { useLangStore, useT, type Lang } from "../../i18n";
import { voiceEngine, type SpeechState } from "./VoiceEngine";
import { extractSections } from "./pageText";

export function useSpeechState(): SpeechState {
  return useSyncExternalStore(
    (cb) => voiceEngine.subscribe(cb),
    () => voiceEngine.getState(),
    () => voiceEngine.getState()
  );
}

/** Reads the current page (the <main> landmark) aloud in `lang`. */
export function readPage(lang: Lang, root: Element | null = typeof document === "undefined" ? null : document.getElementById("main")) {
  const sections = extractSections(root);
  return voiceEngine.read(
    sections.map((s) => s.text),
    lang,
    { source: "page" }
  );
}

export function ReadAloudButton() {
  const { t, lang } = useT();
  const state = useSpeechState();
  if (!voiceEngine.canSpeak()) return null;
  const active = state.status === "loading" || state.status === "speaking" || state.status === "paused";
  return (
    <button
      type="button"
      onClick={() => (active ? voiceEngine.stop() : void readPage(lang))}
      aria-pressed={active}
      aria-label={active ? t("voice.stop") : t("voice.readPage")}
      title={active ? t("voice.stop") : t("voice.readPage")}
      className={`min-w-[44px] min-h-[44px] px-2 rounded-tile text-lg inline-flex items-center justify-center gap-1 ${
        active ? "bg-leaf-100 text-leaf-800" : "hover:bg-soil-100 text-soil-800"
      }`}
      data-testid="read-aloud"
    >
      <span aria-hidden="true">{active ? "⏹" : "🔊"}</span>
      <span className="hidden lg:inline text-sm font-semibold">{active ? t("voice.stop") : t("voice.readPageShort")}</span>
    </button>
  );
}

function BarButton({ onClick, label, icon }: { onClick: () => void; label: string; icon: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="min-w-[44px] min-h-[44px] rounded-tile inline-flex items-center justify-center gap-1 px-2 text-sm font-semibold bg-white/10 hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
    >
      <span aria-hidden="true">{icon}</span>
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

export function ReadAloudBar() {
  const { t, lang } = useT();
  const setLang = useLangStore((s) => s.setLang);
  const state = useSpeechState();

  const onKey = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape" && voiceEngine.getState().status !== "idle") voiceEngine.stop();
  }, []);
  useEffect(() => {
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onKey]);

  if (state.status === "idle") return null;

  const part = { n: state.sectionIndex + 1, total: state.sectionCount };
  let statusText: string;
  if (state.status === "loading") statusText = t("voice.loading");
  else if (state.status === "speaking") statusText = state.sectionCount > 1 ? t("voice.speakingPart", part) : t("voice.speaking");
  else if (state.status === "paused") statusText = state.sectionCount > 1 ? t("voice.pausedPart", part) : t("voice.paused");
  else statusText = t(`voice.error.${state.error ?? "synthesis_failed"}`);

  const isError = state.status === "error";
  const noTamil = isError && state.error === "no_voice" && state.lang === "ta";

  return (
    <div
      role="region"
      aria-label={t("voice.barLabel")}
      data-no-read
      className="no-print fixed inset-x-0 bottom-[72px] md:bottom-4 z-[900] flex justify-center px-3 pointer-events-none"
    >
      <div className={`pointer-events-auto w-full max-w-xl rounded-card shadow-raised px-3 py-2 text-white ${isError ? "bg-danger-600" : "bg-soil-900"}`}>
        <div className="flex items-center gap-2 flex-wrap">
          {!isError && (
            <span
              aria-hidden="true"
              className={`w-2.5 h-2.5 rounded-full bg-leaf-400 ${state.status === "speaking" ? "motion-safe:animate-pulse" : "opacity-60"}`}
            />
          )}
          <p role="status" aria-live="polite" className="flex-1 min-w-[10rem] text-sm">
            {statusText}
          </p>
          {state.status === "speaking" && <BarButton onClick={() => voiceEngine.pause()} label={t("voice.pause")} icon="⏸" />}
          {state.status === "paused" && <BarButton onClick={() => voiceEngine.resume()} label={t("voice.resume")} icon="▶" />}
          {(state.status === "speaking" || state.status === "paused") && state.sectionIndex + 1 < state.sectionCount && (
            <BarButton onClick={() => voiceEngine.next()} label={t("voice.next")} icon="⏭" />
          )}
          {(state.status === "speaking" || state.status === "paused") && (
            <BarButton onClick={() => voiceEngine.restart()} label={t("voice.restart")} icon="↺" />
          )}
          {isError ? (
            <BarButton onClick={() => voiceEngine.dismissError()} label={t("voice.dismiss")} icon="✕" />
          ) : (
            <BarButton onClick={() => voiceEngine.stop()} label={t("voice.stop")} icon="⏹" />
          )}
        </div>
        {noTamil && (
          <div className="mt-2 text-xs flex flex-col gap-1">
            <p>{t("voice.installTamil.android")}</p>
            <p>{t("voice.installTamil.windows")}</p>
            <p>{t("voice.installTamil.other")}</p>
            {lang === "ta" && (
              <button
                type="button"
                onClick={() => {
                  voiceEngine.dismissError();
                  setLang("en");
                }}
                className="self-start mt-1 min-h-[44px] px-3 rounded-tile bg-white text-danger-600 font-semibold"
              >
                {t("voice.switchToEnglish")}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

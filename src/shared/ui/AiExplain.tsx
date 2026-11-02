import React, { useRef, useState } from "react";
import { useT } from "../../i18n";
import { askAi, isAiConfigured, type AiAnswer, type AiTask } from "../../lib/ai/aiClient";
import { voiceEngine } from "../voice/VoiceEngine";
import { Button } from "./Button";
import { Badge } from "./Feedback";
import { ErrorNotice } from "./ErrorNotice";

/** Renders AI text as paragraphs / bullets without injecting HTML. */
export function AiText({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);
  return (
    <div className="flex flex-col gap-2 text-sm leading-relaxed text-soil-900">
      {blocks.map((b, i) => {
        const lines = b.split("\n").map((l) => l.replace(/\*\*(.+?)\*\*/g, "$1"));
        const bullets = lines.every((l) => /^\s*([-*•]|\d+[.)])\s+/.test(l));
        return bullets ? (
          <ul key={i} className="list-disc pl-5 flex flex-col gap-1">
            {lines.map((l, j) => (
              <li key={j}>{l.replace(/^\s*([-*•]|\d+[.)])\s+/, "")}</li>
            ))}
          </ul>
        ) : (
          <p key={i} className="whitespace-pre-line">
            {lines.join("\n")}
          </p>
        );
      })}
    </div>
  );
}

/**
 * "Explain with AI" for a result the app already computed. The context
 * passed in is real app data; the answer is clearly labelled as an AI
 * suggestion that may be wrong.
 */
export function AiExplain({ task, context, label }: { task: Exclude<AiTask, "assistant">; context: string; label?: string }) {
  const { t, lang } = useT();
  const [answer, setAnswer] = useState<AiAnswer | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);

  if (!isAiConfigured()) return null;

  const run = async () => {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setBusy(true);
    setError(null);
    try {
      setAnswer(await askAi({ task, lang, context, signal: ctrl.signal }));
    } catch (err) {
      if (!ctrl.signal.aborted) setError(err);
    } finally {
      if (abort.current === ctrl) setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {!answer && (
        <Button variant="secondary" size="sm" onClick={() => void run()} disabled={busy} icon="✨">
          {busy ? t("ai.thinking") : label ?? t("ai.explain")}
        </Button>
      )}
      {error !== null && <ErrorNotice error={error} onRetry={() => void run()} />}
      {answer && (
        <div className="rounded-card border border-info-600/20 bg-info-50 p-3 flex flex-col gap-2" aria-live="polite">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="demo">✨ {t("ai.badge")}</Badge>
            <span className="text-[11px] text-soil-500">{answer.model}</span>
          </div>
          <AiText text={answer.text} />
          <p className="text-[11px] text-soil-600">{t("ai.disclaimer")}</p>
          <div className="flex flex-wrap gap-2">
            {voiceEngine.canSpeak() && (
              <Button size="sm" variant="ghost" onClick={() => void voiceEngine.speak(answer.text, lang)} icon="🔊">
                {t("ai.readAloud")}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => void run()} disabled={busy}>
              {busy ? t("ai.thinking") : t("ai.again")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

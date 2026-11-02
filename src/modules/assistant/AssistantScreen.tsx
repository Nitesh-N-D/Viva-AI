import React, { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "../../i18n";
import { askAi, isAiConfigured } from "../../lib/ai/aiClient";
import { buildFarmContext } from "../../lib/ai/context";
import { addChat, clearChat, listChat, listTasks, useDbQuery } from "../../lib/farmRepo";
import { newId, todayIso, type ChatMessage, type FarmTask } from "../../lib/localDb";
import { AI_LIMITS } from "../../server/aiProxy";
import { errorMessage } from "../../lib/errors";
import { formatDateTime } from "../../lib/format";
import { useAppStore } from "../../app/store";
import { useWeather } from "../../app/useWeather";
import { useOnline } from "../../app/useSync";
import { voiceEngine } from "../../shared/voice/VoiceEngine";
import { Screen } from "../../shared/ui/Screen";
import { Card } from "../../shared/ui/Card";
import { Button } from "../../shared/ui/Button";
import { Badge, EmptyState, Notice } from "../../shared/ui/Feedback";
import { AiText } from "../../shared/ui/AiExplain";
import { toast } from "../../shared/ui/Toast";

const SUGGESTIONS = ["q1", "q2", "q3", "q4"] as const;

export function AssistantScreen() {
  const { t, lang } = useT();
  const online = useOnline();
  const chat = useDbQuery(listChat, ["chat"], [] as ChatMessage[]);
  const tasks = useDbQuery(listTasks, ["tasks"], [] as FarmTask[]);
  const { location, activeCrop, lastSoil, recentScans } = useAppStore();
  const { weather } = useWeather(location);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [useContext, setUseContext] = useState(true);
  const abort = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const configured = isAiConfigured();

  const ctx = useMemo(() => {
    const today = todayIso();
    const upcoming = tasks.data.filter((x) => !x.done && x.dueDate >= today).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    return buildFarmContext({ district: location?.district, activeCrop, lastSoil, recentScans, weather, upcomingTasks: upcoming });
  }, [location?.district, activeCrop, lastSoil, recentScans, weather, tasks.data]);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [chat.data.length, busy]);
  useEffect(() => () => abort.current?.abort(), []);

  const send = async (question: string) => {
    const q = question.trim().slice(0, AI_LIMITS.question);
    if (!q || busy) return;
    setText("");
    const contextNote = useContext && ctx.parts.length ? ctx.parts.map((p) => t(`assistant.ctx.${p}`)).join(", ") : undefined;
    const userMsg: ChatMessage = { id: newId("msg"), role: "user", text: q, at: Date.now(), contextNote };
    const history = chat.data.filter((m) => !m.error).slice(-AI_LIMITS.historyTurns).map((m) => ({ role: m.role, text: m.text }));
    try {
      await addChat(userMsg);
    } catch {
      toast.error(t("errors.storage"));
    }
    const ctrl = new AbortController();
    abort.current = ctrl;
    setBusy(true);
    try {
      const ans = await askAi({ task: "assistant", lang, question: q, context: useContext ? ctx.text : undefined, history, signal: ctrl.signal });
      await addChat({ id: newId("msg"), role: "model", text: ans.text, at: ans.at, model: ans.model });
    } catch (err) {
      if (!ctrl.signal.aborted) {
        const m = errorMessage(err, lang);
        await addChat({ id: newId("msg"), role: "model", text: `${m.title}. ${m.action}`, at: Date.now(), error: true }).catch(() => undefined);
      }
    } finally {
      if (abort.current === ctrl) setBusy(false);
    }
  };

  const listen = async () => {
    setListening(true);
    try {
      const r = await voiceEngine.listen(lang);
      if (r.ok) setText((prev) => (prev ? `${prev} ${r.transcript}` : r.transcript));
      else if (r.reason !== "aborted" && r.reason !== "no_speech") toast.error(t(`assistant.voiceErr.${r.reason}`));
    } finally {
      setListening(false);
    }
  };

  const clear = async () => {
    if (!window.confirm(t("assistant.confirmClear"))) return;
    abort.current?.abort();
    await clearChat().catch(() => toast.error(t("errors.storage")));
  };

  if (!configured) {
    return (
      <Screen title={t("assistant.title")} subtitle={t("assistant.subtitle")}>
        <Notice tone="warning" title={t("errors.not_configured")}>
          {t("assistant.notConfigured")}
        </Notice>
      </Screen>
    );
  }

  return (
    <Screen
      title={t("assistant.title")}
      subtitle={t("assistant.subtitle")}
      actions={
        chat.data.length > 0 ? (
          <Button size="sm" variant="ghost" onClick={() => void clear()} icon="🗑">
            {t("assistant.clear")}
          </Button>
        ) : undefined
      }
    >
      <Notice tone="info">{t("assistant.howItWorks")}</Notice>
      {!online && <Notice tone="warning">{t("errors.offline")}</Notice>}

      <Card title={t("assistant.appData")} action={<Badge tone="live">{t("assistant.fromApp")}</Badge>}>
        <label className="flex items-center gap-2 min-h-[44px] text-sm">
          <input type="checkbox" checked={useContext} onChange={(e) => setUseContext(e.target.checked)} className="w-5 h-5 accent-leaf-600" />
          {t("assistant.shareContext")}
        </label>
        {useContext && (
          <details className="text-xs text-soil-700">
            <summary className="cursor-pointer min-h-[44px] flex items-center">
              {ctx.parts.length ? t("assistant.contextSummary", { parts: ctx.parts.map((p) => t(`assistant.ctx.${p}`)).join(", ") }) : t("assistant.contextEmpty")}
            </summary>
            <pre className="whitespace-pre-wrap font-sans bg-soil-50 rounded-tile p-2 mt-1">{ctx.text}</pre>
          </details>
        )}
      </Card>

      <section aria-label={t("assistant.conversation")} aria-live="polite" className="flex flex-col gap-3">
        {chat.data.length === 0 && !busy ? (
          <EmptyState
            icon="💬"
            title={t("assistant.emptyTitle")}
            body={t("assistant.emptyBody")}
            action={
              <div className="flex flex-col gap-2">
                {SUGGESTIONS.map((s) => (
                  <Button key={s} size="sm" variant="secondary" onClick={() => void send(t(`assistant.suggest.${s}`))} disabled={!online}>
                    {t(`assistant.suggest.${s}`)}
                  </Button>
                ))}
              </div>
            }
          />
        ) : (
          chat.data.map((m) =>
            m.role === "user" ? (
              <div key={m.id} className="self-end max-w-[85%] rounded-card bg-leaf-600 text-white p-3">
                <p className="whitespace-pre-line text-sm">{m.text}</p>
                <p className="text-[11px] opacity-80 mt-1">
                  {formatDateTime(m.at, lang)}
                  {m.contextNote ? ` · ${t("assistant.sentWith", { parts: m.contextNote })}` : ""}
                </p>
              </div>
            ) : (
              <div key={m.id} className={`self-start max-w-[92%] rounded-card border p-3 ${m.error ? "border-danger-600/20 bg-danger-50" : "border-info-600/20 bg-info-50"}`}>
                {!m.error && (
                  <div className="flex items-center gap-2 mb-1">
                    <Badge tone="demo">✨ {t("ai.badge")}</Badge>
                    {m.model && <span className="text-[11px] text-soil-500">{m.model}</span>}
                  </div>
                )}
                {m.error ? <p className="text-sm text-danger-600">{m.text}</p> : <AiText text={m.text} />}
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[11px] text-soil-500">{formatDateTime(m.at, lang)}</span>
                  {!m.error && voiceEngine.canSpeak() && (
                    <Button size="sm" variant="ghost" onClick={() => void voiceEngine.speak(m.text, lang)} aria-label={t("ai.readAloud")}>
                      🔊
                    </Button>
                  )}
                </div>
              </div>
            )
          )
        )}
        {busy && (
          <div className="self-start rounded-card border border-info-600/20 bg-info-50 p-3 text-sm flex items-center gap-2">
            <span className="animate-pulse">✨</span> {t("ai.thinking")}
            <Button size="sm" variant="ghost" onClick={() => abort.current?.abort()}>
              {t("common.cancel")}
            </Button>
          </div>
        )}
        <div ref={endRef} />
      </section>

      <form
        className="sticky bottom-20 md:bottom-2 bg-white/95 backdrop-blur rounded-card border border-soil-100 p-2 flex flex-col gap-2 shadow-card"
        onSubmit={(e) => {
          e.preventDefault();
          void send(text);
        }}
      >
        <label htmlFor="assistant-input" className="sr-only">
          {t("assistant.inputLabel")}
        </label>
        <textarea
          id="assistant-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(text);
            }
          }}
          maxLength={AI_LIMITS.question}
          rows={2}
          placeholder={t("assistant.placeholder")}
          className="w-full rounded-tile border border-soil-200 bg-white p-2 text-base focus:border-leaf-600 focus:outline-none"
        />
        <div className="flex items-center gap-2">
          {voiceEngine.canListen() && (
            <Button type="button" size="sm" variant="secondary" onClick={() => void listen()} disabled={listening || busy} icon="🎤" aria-label={t("assistant.speak")}>
              {listening ? t("assistant.listening") : t("assistant.speak")}
            </Button>
          )}
          <span className="text-[11px] text-soil-500 ml-auto">
            {text.length}/{AI_LIMITS.question}
          </span>
          <Button type="submit" size="sm" disabled={!text.trim() || busy || !online}>
            {t("assistant.send")}
          </Button>
        </div>
      </form>
      <p className="text-xs text-soil-500">{t("assistant.disclaimer")}</p>
    </Screen>
  );
}

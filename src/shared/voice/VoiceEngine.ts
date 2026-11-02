/**
 * shared/voice/VoiceEngine.ts
 *
 * One interface (`listen` / `speak`) for the whole app so another speech
 * provider can be swapped in without touching screens.
 *
 * speechSynthesis usually works offline once a voice is installed.
 * SpeechRecognition on Chrome needs the network; when it is missing or
 * fails, `listen` resolves with an explicit reason and the UI falls back
 * to typed input.
 */
import type { Lang } from "../../i18n";

export type ListenResult =
  | { ok: true; transcript: string }
  | { ok: false; reason: "unsupported" | "denied" | "no_speech" | "network" | "aborted" | "error" };

export type SpeakFailure = "unsupported" | "no_voice" | "empty" | "synthesis_failed" | "interrupted";
export type SpeakResult = { ok: true } | { ok: false; reason: SpeakFailure };
export type VoiceAvailability = "available" | "missing" | "unsupported";
export type SpeechSource = "page" | "text";

/** Observable read-aloud state shared by every speaker in the app. */
export interface SpeechState {
  status: "idle" | "loading" | "speaking" | "paused" | "error";
  /** Index of the section being read (0-based) and how many there are. */
  sectionIndex: number;
  sectionCount: number;
  lang: Lang;
  source: SpeechSource;
  error?: Exclude<SpeakFailure, "interrupted">;
}

const IDLE: SpeechState = { status: "idle", sectionIndex: 0, sectionCount: 0, lang: "ta", source: "page" };

export interface VoiceEngine {
  canSpeak(): boolean;
  canListen(): boolean;
  /** Reads one block of text; cancels any other reading first. */
  speak(text: string, lang?: Lang): Promise<SpeakResult>;
  /** Reads several sections in order (the page reader). */
  read(sections: readonly string[], lang?: Lang, opts?: { startAt?: number; source?: SpeechSource }): Promise<SpeakResult>;
  pause(): void;
  resume(): void;
  next(): void;
  restart(): void;
  stop(): void;
  dismissError(): void;
  getState(): SpeechState;
  subscribe(fn: (s: SpeechState) => void): () => void;
  loadVoices(timeoutMs?: number): Promise<SpeechSynthesisVoice[]>;
  voiceAvailability(lang: Lang): Promise<VoiceAvailability>;
  listen(lang?: Lang): Promise<ListenResult>;
  stopListening(): void;
  /** Alias of stop(), kept for existing callers. */
  cancelSpeaking(): void;
  isListening(): boolean;
}

// Minimal typings for the Web Speech recognition API (not in lib.dom).
interface RecognitionAlternative {
  transcript: string;
}
interface RecognitionEvent {
  results: ArrayLike<ArrayLike<RecognitionAlternative>>;
}
interface RecognitionErrorEvent {
  error: string;
}
interface Recognition {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function mapRecognitionError(code: string): Exclude<ListenResult, { ok: true }>["reason"] {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "denied";
    case "no-speech":
      return "no_speech";
    case "network":
      return "network";
    case "aborted":
      return "aborted";
    default:
      return "error";
  }
}

/** Picks the best voice for a language: exact ta-IN/en-IN first, then any voice of that language. */
export function pickVoice(voices: readonly SpeechSynthesisVoice[], lang: Lang): SpeechSynthesisVoice | null {
  const prefix = lang === "ta" ? "ta" : "en";
  const norm = (v: SpeechSynthesisVoice) => v.lang.replace("_", "-").toLowerCase();
  return (
    voices.find((v) => norm(v) === `${prefix}-in` && v.localService) ??
    voices.find((v) => norm(v) === `${prefix}-in`) ??
    voices.find((v) => norm(v) === prefix || norm(v).startsWith(`${prefix}-`)) ??
    null
  );
}

/**
 * Splits text into utterance-sized chunks at sentence, then clause, then
 * word boundaries. Chrome silently stops utterances longer than ~15 s, so
 * long sections are never sent as one utterance. Tamil sentence ends (".",
 * "?", "!", "।") and line breaks are respected.
 */
export function chunkText(text: string, max = 220): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const sentences = clean.match(/[^.!?।\n]+[.!?।]*\s*/g) ?? [clean];
  const out: string[] = [];
  let cur = "";
  const pushPiece = (piece: string) => {
    if (piece.length <= max) {
      if ((cur + piece).length > max && cur) {
        out.push(cur.trim());
        cur = "";
      }
      cur += piece;
      return;
    }
    // A single very long sentence: split on commas/semicolons, then words.
    for (const part of piece.split(/(?<=[,;:])\s+/)) {
      if (part.length <= max) {
        pushPiece(part + " ");
        continue;
      }
      for (const word of part.split(" ")) {
        if ((cur + word).length + 1 > max && cur) {
          out.push(cur.trim());
          cur = "";
        }
        cur += word + " ";
      }
    }
  };
  for (const s of sentences) pushPiece(s);
  if (cur.trim()) out.push(cur.trim());
  return out.filter(Boolean);
}

class WebSpeechVoiceEngine implements VoiceEngine {
  private recognition: Recognition | null = null;
  private listeners = new Set<(s: SpeechState) => void>();
  private state: SpeechState = IDLE;
  private session = 0;
  private sections: string[] = [];
  private chunks: string[] = [];
  private chunkIndex = 0;
  private sessionLang: Lang = "ta";
  private voice: SpeechSynthesisVoice | null = null;
  private keepAlive: number | null = null;
  private voicesPromise: Promise<SpeechSynthesisVoice[]> | null = null;

  canSpeak(): boolean {
    return typeof window !== "undefined" && "speechSynthesis" in window && typeof window.SpeechSynthesisUtterance === "function";
  }

  canListen(): boolean {
    return recognitionCtor() !== null;
  }

  // ---- voices -------------------------------------------------------------

  /**
   * Voices load asynchronously in Chrome and Edge: getVoices() is often
   * empty on first call and fills in after `voiceschanged`. Waits up to
   * `timeoutMs` for them, and never rejects.
   */
  loadVoices(timeoutMs = 2000): Promise<SpeechSynthesisVoice[]> {
    if (!this.canSpeak()) return Promise.resolve([]);
    const now = window.speechSynthesis.getVoices();
    if (now.length) return Promise.resolve(now);
    this.voicesPromise ??= new Promise<SpeechSynthesisVoice[]>((resolve) => {
      const synth = window.speechSynthesis;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        synth.removeEventListener?.("voiceschanged", onChange);
        window.clearTimeout(timer);
        this.voicesPromise = null;
        resolve(synth.getVoices());
      };
      const onChange = () => {
        if (synth.getVoices().length) finish();
      };
      synth.addEventListener?.("voiceschanged", onChange);
      const timer = window.setTimeout(finish, timeoutMs);
    });
    return this.voicesPromise;
  }

  async voiceAvailability(lang: Lang): Promise<VoiceAvailability> {
    if (!this.canSpeak()) return "unsupported";
    const voices = await this.loadVoices();
    return pickVoice(voices, lang) ? "available" : "missing";
  }

  // ---- state --------------------------------------------------------------

  getState(): SpeechState {
    return this.state;
  }

  subscribe(fn: (s: SpeechState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private setState(patch: Partial<SpeechState>): void {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn(this.state);
  }

  // ---- reading ------------------------------------------------------------

  /** Speaks one block of text (a chat answer, an explanation). Same session rules as read(). */
  speak(text: string, lang: Lang = "ta"): Promise<SpeakResult> {
    return this.read([text], lang, { source: "text" });
  }

  /**
   * Reads `sections` in order. Starting a new read always cancels the
   * previous one first, so two sessions never overlap. Resolves when the
   * session finishes, is stopped, or fails; the result says which. It never
   * reports success when nothing was spoken.
   */
  async read(sections: readonly string[], lang: Lang = "ta", opts: { startAt?: number; source?: SpeechSource } = {}): Promise<SpeakResult> {
    this.stop();
    const mySession = ++this.session;
    const list = sections.map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
    const source = opts.source ?? "page";
    if (!this.canSpeak()) {
      this.setState({ ...IDLE, status: "error", error: "unsupported", lang, source });
      return { ok: false, reason: "unsupported" };
    }
    if (!list.length) {
      this.setState({ ...IDLE, status: "error", error: "empty", lang, source });
      return { ok: false, reason: "empty" };
    }
    this.sections = list;
    this.sessionLang = lang;
    this.setState({ ...IDLE, status: "loading", lang, source, sectionCount: list.length, sectionIndex: Math.min(opts.startAt ?? 0, list.length - 1) });

    const voices = await this.loadVoices();
    if (mySession !== this.session) return { ok: false, reason: "interrupted" };
    const voice = pickVoice(voices, lang);
    // Never read Tamil text with an English (or other) voice: it is
    // unintelligible. English may fall back to the browser default voice,
    // which is English on every browser we support.
    if (!voice && lang === "ta") {
      this.setState({ status: "error", error: "no_voice" });
      return { ok: false, reason: "no_voice" };
    }
    this.voice = voice;

    return new Promise<SpeakResult>((resolve) => {
      this.resolveSession = (r) => {
        this.resolveSession = null;
        resolve(r);
      };
      this.startSection(mySession, this.state.sectionIndex);
    });
  }

  private resolveSession: ((r: SpeakResult) => void) | null = null;

  private finishSession(result: SpeakResult, patch: Partial<SpeechState>): void {
    this.clearKeepAlive();
    this.setState(patch);
    this.resolveSession?.(result);
  }

  private startSection(mySession: number, index: number): void {
    if (mySession !== this.session) return;
    if (index >= this.sections.length) {
      this.finishSession({ ok: true }, { ...IDLE, lang: this.sessionLang, source: this.state.source });
      return;
    }
    this.chunks = chunkText(this.sections[index]);
    this.chunkIndex = 0;
    this.setState({ status: "speaking", sectionIndex: index, error: undefined });
    this.speakChunk(mySession);
  }

  private speakChunk(mySession: number): void {
    if (mySession !== this.session) return;
    const text = this.chunks[this.chunkIndex];
    if (text === undefined) {
      this.startSection(mySession, this.state.sectionIndex + 1);
      return;
    }
    const synth = window.speechSynthesis;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = this.sessionLang === "ta" ? "ta-IN" : "en-IN";
    if (this.voice) u.voice = this.voice;
    u.rate = 0.95;
    u.onstart = () => {
      if (mySession === this.session && this.state.status !== "paused") this.setState({ status: "speaking" });
    };
    u.onend = () => {
      if (mySession !== this.session) return;
      this.chunkIndex++;
      this.speakChunk(mySession);
    };
    u.onerror = (ev: SpeechSynthesisErrorEvent) => {
      if (mySession !== this.session) return;
      // "interrupted"/"canceled" come from our own cancel(); not a failure.
      if (ev.error === "interrupted" || ev.error === "canceled") return;
      const reason: SpeakFailure = ev.error === "language-unavailable" || ev.error === "voice-unavailable" ? "no_voice" : "synthesis_failed";
      this.session++; // invalidate the rest of this session
      synth.cancel();
      this.finishSession({ ok: false, reason }, { status: "error", error: reason });
    };
    synth.speak(u);
    this.armKeepAlive(mySession);
  }

  /**
   * Chrome on desktop stops speaking after ~15 s without an event, and some
   * engines never fire `onend` after a cancel. A light watchdog nudges a
   * stuck synth with pause/resume, which is harmless elsewhere.
   */
  private armKeepAlive(mySession: number): void {
    this.clearKeepAlive();
    this.keepAlive = window.setInterval(() => {
      if (mySession !== this.session) return this.clearKeepAlive();
      const synth = window.speechSynthesis;
      if (this.state.status === "speaking" && synth.speaking && !synth.paused) {
        synth.pause();
        synth.resume();
      }
    }, 10_000);
  }

  private clearKeepAlive(): void {
    if (this.keepAlive !== null) window.clearInterval(this.keepAlive);
    this.keepAlive = null;
  }

  /** cancel() while paused leaves Chrome paused for the next utterance; resume first. */
  private hardCancel(): void {
    if (!this.canSpeak()) return;
    const synth = window.speechSynthesis;
    if (synth.paused) synth.resume();
    synth.cancel();
  }

  pause(): void {
    if (!this.canSpeak() || this.state.status !== "speaking") return;
    window.speechSynthesis.pause();
    this.setState({ status: "paused" });
  }

  resume(): void {
    if (!this.canSpeak() || this.state.status !== "paused") return;
    const synth = window.speechSynthesis;
    synth.resume();
    // Some engines (Android Chrome) drop the utterance on pause; restart the current chunk.
    if (!synth.speaking) {
      const mySession = this.session;
      this.setState({ status: "speaking" });
      this.speakChunk(mySession);
      return;
    }
    this.setState({ status: "speaking" });
  }

  /** Skips to the next section; stops after the last one. */
  next(): void {
    if (!this.canSpeak() || (this.state.status !== "speaking" && this.state.status !== "paused")) return;
    const target = this.state.sectionIndex + 1;
    const mySession = ++this.session;
    this.hardCancel();
    if (target >= this.sections.length) {
      this.finishSession({ ok: true }, { ...IDLE, lang: this.sessionLang, source: this.state.source });
      return;
    }
    this.startSection(mySession, target);
  }

  /** Reads the same sections again from the first one. */
  restart(): void {
    if (!this.canSpeak() || !this.sections.length) return;
    const mySession = ++this.session;
    this.hardCancel();
    this.startSection(mySession, 0);
  }

  /** Stops any session and returns to idle. Safe to call at any time. */
  stop(): void {
    const wasActive = this.state.status !== "idle";
    this.session++;
    this.clearKeepAlive();
    this.hardCancel();
    if (wasActive) this.finishSession({ ok: false, reason: "interrupted" }, { ...IDLE, lang: this.state.lang });
  }

  /** Clears an error message without starting anything. */
  dismissError(): void {
    if (this.state.status === "error") this.setState({ ...IDLE, lang: this.state.lang });
  }

  cancelSpeaking(): void {
    this.stop();
  }

  isListening(): boolean {
    return this.recognition !== null;
  }

  stopListening(): void {
    this.recognition?.stop();
  }

  listen(lang: Lang = "ta"): Promise<ListenResult> {
    const Ctor = recognitionCtor();
    if (!Ctor) return Promise.resolve({ ok: false, reason: "unsupported" });
    this.recognition?.abort();
    return new Promise((resolve) => {
      const recognition = new Ctor();
      this.recognition = recognition;
      let settled = false;
      const finish = (r: ListenResult) => {
        if (settled) return;
        settled = true;
        resolve(r);
      };
      recognition.lang = lang === "ta" ? "ta-IN" : "en-IN";
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;
      recognition.onresult = (event) => {
        const transcript = event.results[0]?.[0]?.transcript?.trim() ?? "";
        finish(transcript ? { ok: true, transcript } : { ok: false, reason: "no_speech" });
      };
      recognition.onerror = (event) => finish({ ok: false, reason: mapRecognitionError(event.error) });
      recognition.onend = () => {
        if (this.recognition === recognition) this.recognition = null;
        finish({ ok: false, reason: "no_speech" });
      };
      try {
        recognition.start();
      } catch (err) {
        console.warn("[voice] recognition failed to start", err);
        this.recognition = null;
        finish({ ok: false, reason: "error" });
      }
    });
  }
}

export const voiceEngine: VoiceEngine = new WebSpeechVoiceEngine();

/** For tests: a fresh engine that reads the current `window.speechSynthesis`. */
export function createVoiceEngine(): VoiceEngine {
  return new WebSpeechVoiceEngine();
}

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

export interface VoiceEngine {
  canSpeak(): boolean;
  canListen(): boolean;
  speak(text: string, lang?: Lang): Promise<void>;
  listen(lang?: Lang): Promise<ListenResult>;
  stopListening(): void;
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

class WebSpeechVoiceEngine implements VoiceEngine {
  private recognition: Recognition | null = null;

  canSpeak(): boolean {
    return typeof window !== "undefined" && "speechSynthesis" in window;
  }

  canListen(): boolean {
    return recognitionCtor() !== null;
  }

  private voiceFor(lang: Lang): SpeechSynthesisVoice | null {
    const voices = window.speechSynthesis?.getVoices() ?? [];
    const prefix = lang === "ta" ? "ta" : "en";
    return voices.find((v) => v.lang === `${prefix}-IN`) ?? voices.find((v) => v.lang.startsWith(prefix)) ?? null;
  }

  speak(text: string, lang: Lang = "ta"): Promise<void> {
    this.cancelSpeaking();
    if (!this.canSpeak() || !text.trim()) return Promise.resolve();
    return new Promise((resolve) => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = lang === "ta" ? "ta-IN" : "en-IN";
      const voice = this.voiceFor(lang);
      if (voice) utterance.voice = voice;
      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();
      window.speechSynthesis.speak(utterance);
    });
  }

  cancelSpeaking(): void {
    if (this.canSpeak()) window.speechSynthesis.cancel();
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

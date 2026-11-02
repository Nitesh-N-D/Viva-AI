import { create } from "zustand";
import ta from "./ta.json";
import en from "./en.json";

export type Lang = "ta" | "en";

// en.json is checked against ta.json's shape at compile time, so a key
// added to one dictionary but not the other fails the build.
type Dict = typeof ta;
const dictionaries: Record<Lang, Dict> = { ta, en: en satisfies Dict };

const STORAGE_KEY = "viva-ai:lang";

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "en" || saved === "ta") return saved;
  } catch {
    // Storage blocked (private mode) — fall through to the default.
  }
  return "ta";
}

interface LangStore {
  lang: Lang;
  setLang: (lang: Lang) => void;
}

// Tamil is the default; English is an explicit, remembered opt-in.
export const useLangStore = create<LangStore>((set) => ({
  lang: initialLang(),
  setLang: (lang) => {
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // Not persisted this session; the in-memory choice still applies.
    }
    if (typeof document !== "undefined") document.documentElement.lang = lang;
    set({ lang });
  },
}));

function getPath(obj: unknown, path: string): string | undefined {
  let node: unknown = obj;
  for (const key of path.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return typeof node === "string" ? node : undefined;
}

/**
 * t("home.soilScan") -> "மண் பரிசோதனை" (or the English equivalent).
 * `{placeholder}` tokens are replaced everywhere they occur.
 *
 * A token whose value is missing (not passed, `undefined` or `null`) is never
 * shown raw: it is removed, the surrounding whitespace is tidied and, in
 * development, a warning names the key. Call sites should still pass every
 * variable; the i18n tests check every call site statically.
 */
export function t(key: string, vars?: Record<string, string | number | null | undefined>, lang: Lang = useLangStore.getState().lang): string {
  let str = getPath(dictionaries[lang], key) ?? getPath(dictionaries.en, key) ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      if (v === undefined || v === null) continue;
      str = str.split(`{${k}}`).join(String(v));
    }
  }
  if (PLACEHOLDER.test(str)) {
    if (import.meta.env?.DEV) console.warn(`[i18n] "${key}" is missing value(s) for ${str.match(PLACEHOLDER_ALL)?.join(", ")}`);
    str = str.replace(PLACEHOLDER_ALL, "").replace(/\s{2,}/g, " ").replace(/\s+([,.:;!?)])/g, "$1").replace(/\(\s*\)/g, "").trim();
  }
  return str;
}

const PLACEHOLDER = /\{[A-Za-z_][A-Za-z0-9_]*\}/;
const PLACEHOLDER_ALL = /\{[A-Za-z_][A-Za-z0-9_]*\}/g;

/** Placeholder names used by a dictionary string (e.g. ["place"] for "Near {place}"). */
export function placeholdersOf(str: string): string[] {
  return [...new Set((str.match(PLACEHOLDER_ALL) ?? []).map((m) => m.slice(1, -1)))];
}

/** Subscribes the calling component to language changes. */
export function useT() {
  const lang = useLangStore((s) => s.lang);
  return {
    lang,
    t: (key: string, vars?: Record<string, string | number | null | undefined>) => t(key, vars, lang),
  };
}

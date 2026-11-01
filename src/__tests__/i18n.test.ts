import { describe, expect, it } from "vitest";
import en from "../i18n/en.json";
import ta from "../i18n/ta.json";
import { t } from "../i18n";

function flatten(obj: unknown, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out[key] = v;
    else Object.assign(out, flatten(v, key));
  }
  return out;
}

const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(",");

describe("i18n dictionaries", () => {
  const fe = flatten(en);
  const ft = flatten(ta);

  it("have identical keys", () => {
    expect(Object.keys(fe).sort()).toEqual(Object.keys(ft).sort());
  });

  it("use the same placeholders in both languages", () => {
    for (const k of Object.keys(fe)) expect(placeholders(ft[k]), k).toBe(placeholders(fe[k]));
  });

  it("Tamil farm strings are written in Tamil script", () => {
    const untranslated = Object.entries(ft).filter(([k, v]) => k.startsWith("farm.") && !/[஀-௿]/.test(v));
    expect(untranslated).toEqual([]);
  });

  it("t() replaces placeholders and falls back to the key", () => {
    expect(t("sync.pendingShort", { count: 3 }, "en")).toBe("3 waiting");
    expect(t("no.such.key", undefined, "ta")).toBe("no.such.key");
  });
});

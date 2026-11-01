import { t, type Lang } from "../i18n";

/** "just now" / "5 min ago" / "3 h ago" / "2 days ago". */
export function relativeTime(ts: number, lang: Lang, now: number = Date.now()): string {
  const diff = Math.max(0, now - ts);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return t("common.justNow", undefined, lang);
  if (min < 60) return t("common.minutesAgo", { n: min }, lang);
  const h = Math.floor(min / 60);
  if (h < 24) return t("common.hoursAgo", { n: h }, lang);
  return t("common.daysAgo", { n: Math.floor(h / 24) }, lang);
}

const inrFormatters = new Map<string, Intl.NumberFormat>();

/** ₹1,23,456 — Indian digit grouping, no decimals. */
export function formatInr(value: number, lang: Lang): string {
  const locale = lang === "ta" ? "ta-IN" : "en-IN";
  let f = inrFormatters.get(locale);
  if (!f) {
    f = new Intl.NumberFormat(locale, { style: "currency", currency: "INR", maximumFractionDigits: 0 });
    inrFormatters.set(locale, f);
  }
  return f.format(value);
}

/** yyyy-mm-dd -> localised "31 Oct 2026"; any other string is returned as-is. */
export function formatIsoDate(iso: string, lang: Lang): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toLocaleDateString(lang === "ta" ? "ta-IN" : "en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function formatDateTime(ts: number, lang: Lang): string {
  return new Date(ts).toLocaleString(lang === "ta" ? "ta-IN" : "en-IN", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function percent(score: number): string {
  return `${Math.round(score * 1000) / 10}%`;
}

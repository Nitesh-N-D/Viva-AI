/**
 * lib/ai/context.ts — builds the <app_data> block sent to the assistant.
 *
 * Only facts the app actually has are included, each labelled with where it
 * came from (model estimate, live/cached weather, mandi record, farmer
 * entry). Nothing is filled in when data is missing; the line is left out.
 * No personal identifiers or exact GPS coordinates are sent.
 */
import { cropById, stageFor } from "../../modules/farm/cropEngine";
import { taxonName, type ModelTask } from "../../domain/taxonomy";
import type { WeatherSnapshot } from "../weather";
import type { MandiRecord } from "../mandi";
import type { FarmTask } from "../localDb";
import { t } from "../../i18n";

export interface AppContextInput {
  district?: string | null;
  activeCrop?: { cropId: string; plantedAt: number } | null;
  lastSoil?: string | null;
  recentScans?: { task: ModelTask; labelId: string; score: number; modelVersion: string; at: number }[];
  weather?: WeatherSnapshot | null;
  upcomingTasks?: FarmTask[];
  now?: number;
}

const pct = (s: number) => `${Math.round(s * 100)}%`;
const day = (ts: number) => new Date(ts).toISOString().slice(0, 10);

export function buildFarmContext(c: AppContextInput): { text: string; parts: string[] } {
  const now = c.now ?? Date.now();
  const lines: string[] = [];
  const parts: string[] = [];
  lines.push(`Today: ${day(now)}`);
  if (c.district) {
    lines.push(`District (Tamil Nadu): ${c.district}`);
    parts.push("location");
  }
  if (c.activeCrop) {
    const crop = cropById(c.activeCrop.cropId);
    if (crop) {
      const days = Math.max(0, Math.floor((now - c.activeCrop.plantedAt) / 86_400_000));
      const st = stageFor(crop, days);
      lines.push(`Farmer's crop: ${crop.en}, sown ${day(c.activeCrop.plantedAt)} (${days} days ago), stage ${st.stage.en} (TNAU duration ${crop.durationDays} days)`);
      parts.push("crop");
    }
  }
  if (c.lastSoil) {
    lines.push(`Soil type (chosen by farmer or from photo model): ${taxonName("soil", c.lastSoil, "en")}`);
    parts.push("soil");
  }
  const scans = (c.recentScans ?? []).slice(0, 3);
  if (scans.length) {
    for (const s of scans) {
      lines.push(`Photo model estimate (${s.task}, ${day(s.at)}): ${taxonName(s.task, s.labelId, "en")}, confidence ${pct(s.score)} — estimate, not confirmed`);
    }
    parts.push("scans");
  }
  const w = c.weather;
  if (w && w.source !== "unavailable") {
    const src = w.source === "live" ? "live" : `saved copy from ${w.fetchedAt ? day(w.fetchedAt) : "earlier"}`;
    const bits = [
      w.tempC !== null ? `temp ${Math.round(w.tempC)}°C` : null,
      w.humidity !== null ? `humidity ${w.humidity}%` : null,
      w.rainNext5dMm !== null ? `forecast rain next 5 days ${Math.round(w.rainNext5dMm)} mm` : null,
      w.condition ? `condition ${w.condition}` : null,
    ].filter(Boolean);
    if (bits.length) {
      lines.push(`Weather (OpenWeatherMap, ${src}): ${bits.join(", ")}`);
      parts.push("weather");
    }
  }
  const tasks = (c.upcomingTasks ?? []).filter((x) => !x.done).slice(0, 5);
  if (tasks.length) {
    lines.push(`Upcoming farm tasks: ${tasks.map((x) => `${x.dueDate} ${x.titleKey ? t(x.titleKey, undefined, "en") : x.title}`).join("; ")}`);
    parts.push("tasks");
  }
  return { text: lines.join("\n"), parts };
}

export function scanContext(task: ModelTask, labelId: string, score: number, modelVersion: string, top?: { id: string; score: number }[]): string {
  const lines = [
    `App: VIVA AI photo model (${modelVersion}), task ${task}`,
    `Top estimate: ${taxonName(task, labelId, "en")} (${labelId}), confidence ${pct(score)}`,
  ];
  if (top?.length) lines.push(`Other possibilities: ${top.slice(1, 3).map((x) => `${taxonName(task, x.id, "en")} ${pct(x.score)}`).join(", ")}`);
  if (task === "soil") lines.push("Note: the model sees colour/texture only; it does not measure pH, nutrients or texture class.");
  else lines.push("Note: trained on tomato leaves only (PlantVillage-style photos); the result is an estimate.");
  return lines.join("\n");
}

export function marketContext(commodity: string, place: string, records: readonly MandiRecord[]): string {
  const rows = records.slice(0, 15).map((r) => `${r.market} (${r.district}) ${r.arrivalDate}: min ${r.minPrice ?? "?"}, modal ${r.modalPrice}, max ${r.maxPrice ?? "?"}`);
  return [`Mandi prices from data.gov.in (Agmarknet), ₹ per quintal`, `Commodity: ${commodity}; area: ${place}`, ...rows].join("\n");
}

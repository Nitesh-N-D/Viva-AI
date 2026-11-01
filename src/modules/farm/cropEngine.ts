/**
 * Deterministic, explainable crop ranking.
 *
 * Each known input contributes a weighted, pass/partial/fail check. The
 * score is the share of available weight earned (0–100). It is a
 * suitability score, NOT a probability or a yield prediction. Missing
 * inputs are excluded from the denominator and reported as warnings, so
 * the ranking never pretends to know something it was not told.
 *
 * Short-term rain forecast is never compared with seasonal water need
 * (different units and time scales); it only raises timing risks.
 */
import cropData from "./data/crops.json";
import type { Season } from "../../lib/weather";
import { SOIL_TYPES } from "../../domain/taxonomy";

export type WaterNeed = "low" | "medium" | "high";
export type WaterAvailability = "irrigated" | "rainfed" | "limited";
export type DurationPref = "short" | "medium" | "any";

export interface Crop {
  id: string;
  en: string;
  ta: string;
  soils: string[];
  seasons: Season[];
  water: WaterNeed;
  phMin: number;
  phMax: number;
  durationDays: number;
}

export interface CropStage {
  id: string;
  fromFraction: number;
  en: string;
  ta: string;
}

export const CROPS: readonly Crop[] = cropData.crops as Crop[];
export const STAGES: readonly CropStage[] = cropData.stages;
export const CROP_SOURCE = cropData.source;

export interface CropInputs {
  soil: string | null;
  season: Season | null;
  water: WaterAvailability | null;
  ph: number | null;
  duration: DurationPref | null;
  /** Next-5-day rain forecast (mm); used only for timing risks. */
  rainNext5dMm: number | null;
}

export type CheckId = "soil" | "season" | "water" | "ph" | "duration";

export interface Check {
  id: CheckId;
  /** 1 = full match, 0.5 = partial, 0 = mismatch. */
  result: 0 | 0.5 | 1;
  weight: number;
}

export type RiskId = "heavy_rain_low_water_crop" | "heavy_rain_sowing" | "no_rain_rainfed";

export interface Recommendation {
  crop: Crop;
  score: number;
  checks: Check[];
  risks: RiskId[];
}

export interface RecommendationResult {
  ranked: Recommendation[];
  missing: CheckId[];
}

export const WEIGHTS: Record<CheckId, number> = { soil: 35, season: 30, water: 20, ph: 10, duration: 5 };

export const HEAVY_RAIN_MM = 50;

function waterCheck(need: WaterNeed, have: WaterAvailability): 0 | 0.5 | 1 {
  if (have === "irrigated") return 1;
  if (have === "rainfed") return need === "high" ? 0 : need === "medium" ? 0.5 : 1;
  // limited
  return need === "low" ? 1 : need === "medium" ? 0.5 : 0;
}

function phCheck(crop: Crop, ph: number): 0 | 0.5 | 1 {
  if (ph >= crop.phMin && ph <= crop.phMax) return 1;
  const distance = ph < crop.phMin ? crop.phMin - ph : ph - crop.phMax;
  return distance <= 0.5 ? 0.5 : 0;
}

function durationCheck(days: number, pref: DurationPref): 0 | 0.5 | 1 {
  if (pref === "any") return 1;
  if (pref === "short") return days <= 100 ? 1 : days <= 120 ? 0.5 : 0;
  return days <= 140 ? 1 : 0.5;
}

export function validInputs(inputs: CropInputs): string[] {
  const errors: string[] = [];
  if (inputs.soil !== null && !SOIL_TYPES.some((s) => s.id === inputs.soil)) errors.push(`unknown soil type "${inputs.soil}"`);
  if (inputs.ph !== null && (!Number.isFinite(inputs.ph) || inputs.ph < 3 || inputs.ph > 10)) errors.push("pH must be between 3 and 10");
  return errors;
}

export function recommendCrops(inputs: CropInputs, crops: readonly Crop[] = CROPS): RecommendationResult {
  const missing: CheckId[] = [];
  if (inputs.soil === null) missing.push("soil");
  if (inputs.season === null) missing.push("season");
  if (inputs.water === null) missing.push("water");
  if (inputs.ph === null) missing.push("ph");
  if (inputs.duration === null) missing.push("duration");

  const ranked = crops.map((crop): Recommendation => {
    const checks: Check[] = [];
    if (inputs.soil !== null) checks.push({ id: "soil", weight: WEIGHTS.soil, result: crop.soils.includes(inputs.soil) ? 1 : 0 });
    if (inputs.season !== null)
      checks.push({ id: "season", weight: WEIGHTS.season, result: crop.seasons.includes(inputs.season) ? 1 : 0 });
    if (inputs.water !== null) checks.push({ id: "water", weight: WEIGHTS.water, result: waterCheck(crop.water, inputs.water) });
    if (inputs.ph !== null) checks.push({ id: "ph", weight: WEIGHTS.ph, result: phCheck(crop, inputs.ph) });
    if (inputs.duration !== null)
      checks.push({ id: "duration", weight: WEIGHTS.duration, result: durationCheck(crop.durationDays, inputs.duration) });

    const total = checks.reduce((n, c) => n + c.weight, 0);
    const earned = checks.reduce((n, c) => n + c.weight * c.result, 0);
    const score = total === 0 ? 0 : Math.round((earned / total) * 100);

    const risks: RiskId[] = [];
    if (inputs.rainNext5dMm !== null) {
      if (inputs.rainNext5dMm >= HEAVY_RAIN_MM) {
        risks.push("heavy_rain_sowing");
        if (crop.water === "low") risks.push("heavy_rain_low_water_crop");
      } else if (inputs.rainNext5dMm < 1 && inputs.water === "rainfed") {
        risks.push("no_rain_rainfed");
      }
    }
    return { crop, score, checks, risks };
  });

  ranked.sort((a, b) => b.score - a.score || a.crop.durationDays - b.crop.durationDays || a.crop.id.localeCompare(b.crop.id));
  return { ranked, missing };
}

/** Growth stage for a crop on a given day since planting. */
export function stageFor(crop: Crop, daysSincePlanting: number): { stage: CropStage; index: number; done: boolean } {
  const fraction = Math.max(0, daysSincePlanting) / crop.durationDays;
  let index = 0;
  STAGES.forEach((s, i) => {
    if (fraction >= s.fromFraction) index = i;
  });
  return { stage: STAGES[index], index, done: fraction >= 1 };
}

export function stageStartDay(crop: Crop, stage: CropStage): number {
  return Math.round(stage.fromFraction * crop.durationDays);
}

export function cropById(id: string): Crop | undefined {
  return CROPS.find((c) => c.id === id);
}

export function cropName(crop: Crop, lang: "ta" | "en"): string {
  return lang === "ta" ? crop.ta : crop.en;
}

/**
 * irrigation/irrigationLogic.ts — crop water need ESTIMATES (FAO-56 method).
 *
 *   ET0  : Hargreaves–Samani reference evapotranspiration from daily max/min
 *          temperature and extraterrestrial radiation (latitude + date).
 *          FAO Irrigation and Drainage Paper 56, eq. 52 (Hargreaves) and
 *          eqs. 21–25 (Ra).
 *   ETc  : ET0 × Kc, with Kc per growth stage from FAO-56 Table 12.
 *   Peff : simple effective-rain rule — days under 5 mm count as zero,
 *          otherwise 80 % of the rain is taken as effective.
 *   Gross: net need ÷ application efficiency (drip 0.90, sprinkler 0.75,
 *          surface/flood 0.60).
 *   1 mm of water over 1 m² is 1 litre.
 *
 * These are estimates for planning only. There is no soil-moisture sensor;
 * the farmer should check soil moisture by hand before irrigating.
 */
import { STAGES, cropById, stageFor, type Crop } from "../farm/cropEngine";

export type IrrigationMethod = "drip" | "sprinkler" | "surface";
export const EFFICIENCY: Record<IrrigationMethod, number> = { drip: 0.9, sprinkler: 0.75, surface: 0.6 };
export const M2_PER_ACRE = 4046.86;
/** Approximate centre of Tamil Nadu, used only when the farm's latitude is unknown. */
export const TN_DEFAULT_LAT = 11.0;

/** FAO-56 Table 12 single crop coefficients (initial, mid-season, end). */
export const KC: Record<string, { ini: number; mid: number; end: number }> = {
  paddy: { ini: 1.05, mid: 1.2, end: 0.75 },
  groundnut: { ini: 0.4, mid: 1.15, end: 0.6 },
  cotton: { ini: 0.35, mid: 1.18, end: 0.6 },
  blackgram: { ini: 0.4, mid: 1.1, end: 0.3 },
  pearl_millet: { ini: 0.3, mid: 1.0, end: 0.3 },
  maize: { ini: 0.3, mid: 1.2, end: 0.5 },
  tomato: { ini: 0.6, mid: 1.15, end: 0.8 },
  ragi: { ini: 0.3, mid: 1.0, end: 0.3 },
};

export function kcFor(cropId: string, stageId: string): number {
  const k = KC[cropId] ?? { ini: 0.5, mid: 1.05, end: 0.6 };
  switch (stageId) {
    case "establishment":
      return k.ini;
    case "vegetative":
      return Math.round(((k.ini + k.mid) / 2) * 100) / 100;
    case "flowering":
    case "filling":
      return k.mid;
    default:
      return k.end;
  }
}

function dayOfYear(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 0)) / 86_400_000);
}

/** Extraterrestrial radiation Ra in MJ m⁻² day⁻¹ (FAO-56 eq. 21). */
export function extraterrestrialRadiation(latDeg: number, iso: string): number {
  const J = dayOfYear(iso);
  const phi = (latDeg * Math.PI) / 180;
  const dr = 1 + 0.033 * Math.cos((2 * Math.PI * J) / 365);
  const delta = 0.409 * Math.sin((2 * Math.PI * J) / 365 - 1.39);
  const ws = Math.acos(Math.max(-1, Math.min(1, -Math.tan(phi) * Math.tan(delta))));
  return ((24 * 60) / Math.PI) * 0.082 * dr * (ws * Math.sin(phi) * Math.sin(delta) + Math.cos(phi) * Math.cos(delta) * Math.sin(ws));
}

/** Hargreaves ET0 in mm/day (FAO-56 eq. 52). */
export function hargreavesEt0(tMax: number, tMin: number, latDeg: number, iso: string): number {
  const range = Math.max(0, tMax - tMin);
  const tMean = (tMax + tMin) / 2;
  const raMm = 0.408 * extraterrestrialRadiation(latDeg, iso);
  return Math.max(0, 0.0023 * raMm * (tMean + 17.8) * Math.sqrt(range));
}

export function effectiveRain(rainMm: number): number {
  return rainMm < 5 ? 0 : 0.8 * rainMm;
}

export interface DayInput {
  date: string;
  maxC: number;
  minC: number;
  rainMm: number;
}

export interface DayEstimate extends DayInput {
  et0: number;
  kc: number;
  etc: number;
  peff: number;
  netMm: number;
  grossMm: number;
  litres: number;
}

export interface IrrigationInput {
  cropId: string;
  daysSinceSowing: number;
  areaAcres: number;
  method: IrrigationMethod;
  latDeg: number | null;
  days: DayInput[];
}

export interface IrrigationEstimate {
  crop: Crop;
  stageId: string;
  kc: number;
  days: DayEstimate[];
  totalNetMm: number;
  totalGrossMm: number;
  totalLitres: number;
  rainCoveredDays: number;
  latitudeAssumed: boolean;
  warnings: ("heavy_rain" | "heat" | "paddy_flooded" | "crop_finished" | "no_days")[];
}

const r1 = (n: number) => Math.round(n * 10) / 10;

export function validateIrrigationInput(i: Partial<IrrigationInput>): string[] {
  const errs: string[] = [];
  if (!i.cropId || !cropById(i.cropId)) errs.push("crop");
  if (i.daysSinceSowing === undefined || !Number.isFinite(i.daysSinceSowing) || i.daysSinceSowing < 0 || i.daysSinceSowing > 400) errs.push("days");
  if (!i.areaAcres || !Number.isFinite(i.areaAcres) || i.areaAcres <= 0 || i.areaAcres > 1000) errs.push("area");
  for (const d of i.days ?? []) {
    if (!Number.isFinite(d.maxC) || !Number.isFinite(d.minC) || d.maxC < d.minC || d.maxC > 55 || d.minC < -5) errs.push("temp");
    if (!Number.isFinite(d.rainMm) || d.rainMm < 0 || d.rainMm > 500) errs.push("rain");
  }
  return [...new Set(errs)];
}

export function estimateIrrigation(input: IrrigationInput): IrrigationEstimate | null {
  const crop = cropById(input.cropId);
  if (!crop) return null;
  const st = stageFor(crop, input.daysSinceSowing);
  const lat = input.latDeg ?? TN_DEFAULT_LAT;
  const areaM2 = input.areaAcres * M2_PER_ACRE;
  const eff = EFFICIENCY[input.method];
  const warnings: IrrigationEstimate["warnings"] = [];
  if (st.done) warnings.push("crop_finished");
  if (!input.days.length) warnings.push("no_days");

  const days: DayEstimate[] = input.days.map((d, i) => {
    const stage = stageFor(crop, input.daysSinceSowing + i).stage;
    const kc = kcFor(crop.id, stage.id);
    const et0 = hargreavesEt0(d.maxC, d.minC, lat, d.date);
    const etc = et0 * kc;
    const peff = effectiveRain(d.rainMm);
    const netMm = Math.max(0, etc - peff);
    const grossMm = netMm / eff;
    return { ...d, et0: r1(et0), kc, etc: r1(etc), peff: r1(peff), netMm: r1(netMm), grossMm: r1(grossMm), litres: Math.round(grossMm * areaM2) };
  });
  if (input.days.some((d) => d.rainMm >= 50)) warnings.push("heavy_rain");
  if (input.days.some((d) => d.maxC >= 38)) warnings.push("heat");
  if (crop.id === "paddy") warnings.push("paddy_flooded");

  const totalNet = days.reduce((s, d) => s + d.netMm, 0);
  const totalGross = days.reduce((s, d) => s + d.grossMm, 0);
  return {
    crop,
    stageId: st.stage.id,
    kc: kcFor(crop.id, st.stage.id),
    days,
    totalNetMm: r1(totalNet),
    totalGrossMm: r1(totalGross),
    totalLitres: days.reduce((s, d) => s + d.litres, 0),
    rainCoveredDays: days.filter((d) => d.netMm === 0).length,
    latitudeAssumed: input.latDeg === null,
    warnings,
  };
}

/** Qualitative interval guidance by soil water-holding behaviour (no numbers invented). */
export function soilAdvice(soil: string | null): "light_frequent" | "heavy_less_often" | "medium" | null {
  if (!soil) return null;
  if (soil === "red" || soil === "laterite") return "light_frequent";
  if (soil === "black") return "heavy_less_often";
  if (soil === "alluvial") return "medium";
  return null;
}

export const STAGE_IDS = STAGES.map((s) => s.id);

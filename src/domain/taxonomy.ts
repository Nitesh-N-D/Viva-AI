/**
 * domain/taxonomy.ts
 *
 * Single source of truth for the class identifiers a model may emit and
 * the human-readable names shown for them. Models never carry display
 * strings: a trained artifact ships `labels.json` (an ordered list of
 * these ids) and the app looks the names up here. A model whose labels
 * are not all listed below is rejected by `validateModelMetadata`.
 */
import type { Lang } from "../i18n";

export interface TaxonEntry {
  id: string;
  en: string;
  ta: string;
}

export const SOIL_TYPES: readonly TaxonEntry[] = [
  { id: "alluvial", en: "Alluvial soil", ta: "வண்டல் மண்" },
  { id: "black", en: "Black soil", ta: "கருமண்" },
  { id: "laterite", en: "Laterite soil", ta: "லேட்டரைட் மண்" },
  { id: "red", en: "Red soil", ta: "செம்மண்" },
];

// Tomato-leaf classes from the PlantVillage-derived Kaggle dataset
// kaustubhb999/tomatoleaf (CC0) used by the disease notebook; ids map 1:1
// to its ten folders (see packages/ml-models/disease_classifier). The
// classifier is NOT a general plant-disease model: it has only ever seen
// tomato leaves photographed on plain backgrounds.
export const DISEASE_CLASSES: readonly TaxonEntry[] = [
  { id: "tomato_healthy", en: "Healthy tomato leaf", ta: "ஆரோக்கியமான தக்காளி இலை" },
  { id: "tomato_early_blight", en: "Early blight (tomato)", ta: "முன் இலைக்கருகல் (தக்காளி)" },
  { id: "tomato_late_blight", en: "Late blight (tomato)", ta: "பின் இலைக்கருகல் (தக்காளி)" },
  { id: "tomato_bacterial_spot", en: "Bacterial spot (tomato)", ta: "பாக்டீரியா இலைப்புள்ளி (தக்காளி)" },
  { id: "tomato_septoria_leaf_spot", en: "Septoria leaf spot (tomato)", ta: "செப்டோரியா இலைப்புள்ளி (தக்காளி)" },
  { id: "tomato_yellow_leaf_curl_virus", en: "Yellow leaf curl virus (tomato)", ta: "மஞ்சள் இலைச்சுருள் வைரஸ் (தக்காளி)" },
  { id: "tomato_leaf_mold", en: "Leaf mould (tomato)", ta: "இலைப் பூஞ்சணம் (தக்காளி)" },
  { id: "tomato_spider_mites", en: "Spider mite damage (tomato)", ta: "சிலந்திப் பேன் தாக்குதல் (தக்காளி)" },
  { id: "tomato_target_spot", en: "Target spot (tomato)", ta: "இலக்குப் புள்ளி நோய் (தக்காளி)" },
  { id: "tomato_mosaic_virus", en: "Mosaic virus (tomato)", ta: "தேமல் வைரஸ் (தக்காளி)" },
];

export const HEALTHY_DISEASE_IDS: ReadonlySet<string> = new Set(["tomato_healthy"]);

export type ModelTask = "soil" | "disease";

export const TAXONOMY: Record<ModelTask, readonly TaxonEntry[]> = {
  soil: SOIL_TYPES,
  disease: DISEASE_CLASSES,
};

export function taxonName(task: ModelTask, id: string, lang: Lang): string {
  const entry = TAXONOMY[task].find((e) => e.id === id);
  if (!entry) return id;
  return lang === "ta" ? entry.ta : entry.en;
}

export function isKnownSoilType(id: string): boolean {
  return SOIL_TYPES.some((s) => s.id === id);
}

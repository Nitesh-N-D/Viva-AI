/**
 * domain/mandiPlaces.ts
 *
 * Names exactly as the data.gov.in Agmarknet resource spells them, with
 * display names. Every `api` string below was observed in the live API on
 * 2026-11-01. Filters are exact and case-sensitive, so these strings are
 * sent unchanged; the display names are only for the UI.
 *
 * The resource only holds the current day's arrivals, so a state, district
 * or commodity missing on a given day simply returns no records. The app
 * then shows a truthful "no records" state instead of guessing.
 */
import { TN_DISTRICTS } from "./districts";

export interface MandiName {
  /** Exact Agmarknet value used in API filters. */
  api: string;
  en: string;
  ta: string;
}

export const MANDI_STATES: readonly MandiName[] = [
  { api: "Tamil Nadu", en: "Tamil Nadu", ta: "தமிழ்நாடு" },
  { api: "Andhra Pradesh", en: "Andhra Pradesh", ta: "ஆந்திரப் பிரதேசம்" },
  { api: "Assam", en: "Assam", ta: "அசாம்" },
  { api: "Bihar", en: "Bihar", ta: "பீகார்" },
  { api: "Chandigarh", en: "Chandigarh", ta: "சண்டிகர்" },
  { api: "Chattisgarh", en: "Chhattisgarh", ta: "சத்தீஸ்கர்" },
  { api: "Gujarat", en: "Gujarat", ta: "குஜராத்" },
  { api: "Haryana", en: "Haryana", ta: "ஹரியானா" },
  { api: "Himachal Pradesh", en: "Himachal Pradesh", ta: "இமாச்சலப் பிரதேசம்" },
  { api: "Karnataka", en: "Karnataka", ta: "கர்நாடகா" },
  { api: "Keralam", en: "Kerala", ta: "கேரளா" },
  { api: "Madhya Pradesh", en: "Madhya Pradesh", ta: "மத்தியப் பிரதேசம்" },
  { api: "Maharashtra", en: "Maharashtra", ta: "மகாராஷ்டிரா" },
  { api: "NCT of Delhi", en: "Delhi", ta: "டெல்லி" },
  { api: "Odisha", en: "Odisha", ta: "ஒடிசா" },
  { api: "Punjab", en: "Punjab", ta: "பஞ்சாப்" },
  { api: "Rajasthan", en: "Rajasthan", ta: "ராஜஸ்தான்" },
  { api: "Telangana", en: "Telangana", ta: "தெலங்கானா" },
  { api: "Tripura", en: "Tripura", ta: "திரிபுரா" },
  { api: "Uttar Pradesh", en: "Uttar Pradesh", ta: "உத்தரப் பிரதேசம்" },
  { api: "Uttarakhand", en: "Uttarakhand", ta: "உத்தரகாண்ட்" },
  { api: "West Bengal", en: "West Bengal", ta: "மேற்கு வங்காளம்" },
];

export const DEFAULT_STATE = "Tamil Nadu";

/**
 * App district name (domain/districts.ts) → Agmarknet spelling, where they
 * differ. Chennai had no records on 2026-11-01 and keeps its own name.
 */
const TN_API_SPELLING: Record<string, string> = {
  Chengalpattu: "Chengalpet",
  Kanniyakumari: "Kannyiakumari",
  Nilgiris: "The Nilgiris",
  Sivaganga: "Sivagangai",
  Tenkasi: "Thenkasi",
  Tiruchirappalli: "Thiruchirappalli",
  Tirupathur: "Thirupathur",
  Tiruppur: "Thiruppur",
  Tiruvallur: "Thiruvallur",
  Tiruvannamalai: "Thiruvannamalai",
  Viluppuram: "Villupuram",
};

/** Tamil Nadu districts with their Agmarknet spelling, sorted by English name. */
export const TN_MANDI_DISTRICTS: readonly MandiName[] = TN_DISTRICTS.map((d) => ({
  api: TN_API_SPELLING[d.en] ?? d.en,
  // "Villupuram" is the common English spelling and the one Agmarknet uses.
  en: d.en === "Viluppuram" ? "Villupuram" : d.en,
  ta: d.ta,
}));

/** App district name (e.g. a saved location "Viluppuram") → Agmarknet spelling. */
export function districtToApi(appName: string): string {
  return TN_API_SPELLING[appName] ?? appName;
}

/** Display name for a district string returned by the API. */
export function mandiDistrictName(api: string, state: string, lang: "ta" | "en"): string {
  if (state !== "Tamil Nadu") return api;
  const d = TN_MANDI_DISTRICTS.find((x) => x.api === api);
  return d ? (lang === "ta" ? d.ta : d.en) : api;
}

export function mandiStateName(api: string, lang: "ta" | "en"): string {
  const s = MANDI_STATES.find((x) => x.api === api);
  return s ? (lang === "ta" ? s.ta : s.en) : api;
}

export interface MandiCommodity extends MandiName {
  id: string;
}

/** Commodities, most-traded in Tamil Nadu first. Every api string was seen in the live data. */
export const MANDI_COMMODITIES: readonly MandiCommodity[] = [
  { id: "tomato", api: "Tomato", en: "Tomato", ta: "தக்காளி" },
  { id: "onion", api: "Onion", en: "Onion", ta: "வெங்காயம்" },
  { id: "small-onion", api: "Onion Green", en: "Green onion", ta: "வெங்காயத்தாள்" },
  { id: "potato", api: "Potato", en: "Potato", ta: "உருளைக்கிழங்கு" },
  { id: "brinjal", api: "Brinjal", en: "Brinjal", ta: "கத்தரிக்காய்" },
  { id: "bhindi", api: "Bhindi(Ladies Finger)", en: "Ladies finger", ta: "வெண்டைக்காய்" },
  { id: "green-chilli", api: "Green Chilli", en: "Green chilli", ta: "பச்சை மிளகாய்" },
  { id: "coconut", api: "Coconut", en: "Coconut", ta: "தேங்காய்" },
  { id: "banana", api: "Banana", en: "Banana", ta: "வாழைப்பழம்" },
  { id: "banana-green", api: "Banana - Green", en: "Raw banana", ta: "வாழைக்காய்" },
  { id: "drumstick", api: "Drumstick", en: "Drumstick", ta: "முருங்கைக்காய்" },
  { id: "bitter-gourd", api: "Bitter gourd", en: "Bitter gourd", ta: "பாகற்காய்" },
  { id: "bottle-gourd", api: "Bottle gourd", en: "Bottle gourd", ta: "சுரைக்காய்" },
  { id: "snake-gourd", api: "Snakeguard", en: "Snake gourd", ta: "புடலங்காய்" },
  { id: "ridge-gourd", api: "Ridgeguard(Tori)", en: "Ridge gourd", ta: "பீர்க்கங்காய்" },
  { id: "ash-gourd", api: "Ashgourd", en: "Ash gourd", ta: "பூசணிக்காய் (வெள்ளை)" },
  { id: "pumpkin", api: "Pumpkin", en: "Pumpkin", ta: "பரங்கிக்காய்" },
  { id: "cluster-beans", api: "Cluster beans", en: "Cluster beans", ta: "கொத்தவரங்காய்" },
  { id: "beans", api: "Beans", en: "Beans", ta: "பீன்ஸ்" },
  { id: "carrot", api: "Carrot", en: "Carrot", ta: "கேரட்" },
  { id: "beetroot", api: "Beetroot", en: "Beetroot", ta: "பீட்ரூட்" },
  { id: "cabbage", api: "Cabbage", en: "Cabbage", ta: "முட்டைக்கோஸ்" },
  { id: "cauliflower", api: "Cauliflower", en: "Cauliflower", ta: "காலிஃபிளவர்" },
  { id: "radish", api: "Raddish", en: "Radish", ta: "முள்ளங்கி" },
  { id: "amaranthus", api: "Amaranthus", en: "Amaranthus (greens)", ta: "கீரை" },
  { id: "coriander", api: "Coriander(Leaves)", en: "Coriander leaves", ta: "கொத்தமல்லி" },
  { id: "mint", api: "Mint(Pudina)", en: "Mint", ta: "புதினா" },
  { id: "lemon", api: "Lemon", en: "Lemon", ta: "எலுமிச்சை" },
  { id: "ginger", api: "Ginger(Green)", en: "Ginger", ta: "இஞ்சி" },
  { id: "garlic", api: "Garlic", en: "Garlic", ta: "பூண்டு" },
  { id: "tapioca", api: "Tapioca", en: "Tapioca", ta: "மரவள்ளிக்கிழங்கு" },
  { id: "sweet-potato", api: "Sweet Potato", en: "Sweet potato", ta: "சர்க்கரைவள்ளிக்கிழங்கு" },
  { id: "papaya", api: "Papaya", en: "Papaya", ta: "பப்பாளி" },
  { id: "guava", api: "Guava", en: "Guava", ta: "கொய்யா" },
  { id: "mango", api: "Mango(Raw-Ripe)", en: "Mango", ta: "மாங்காய்" },
  { id: "groundnut", api: "Groundnut", en: "Groundnut", ta: "நிலக்கடலை" },
  { id: "paddy", api: "Paddy(Common)", en: "Paddy", ta: "நெல்" },
  { id: "maize", api: "Maize", en: "Maize", ta: "மக்காச்சோளம்" },
  { id: "cotton", api: "Cotton", en: "Cotton", ta: "பருத்தி" },
  { id: "blackgram", api: "Black Gram(Urd Beans)(Whole)", en: "Black gram", ta: "உளுந்து" },
  { id: "greengram", api: "Green Gram(Moong)(Whole)", en: "Green gram", ta: "பச்சைப் பயறு" },
  { id: "ragi", api: "Ragi(Finger Millet)", en: "Ragi", ta: "கேழ்வரகு" },
  { id: "bajra", api: "Bajra(Pearl Millet/Cumbu)", en: "Pearl millet (cumbu)", ta: "கம்பு" },
  { id: "jowar", api: "Jowar(Sorghum)", en: "Sorghum", ta: "சோளம்" },
];

export const DEFAULT_COMMODITY = "tomato";

export function commodityName(api: string, lang: "ta" | "en"): string {
  const c = MANDI_COMMODITIES.find((x) => x.api === api);
  return c ? (lang === "ta" ? c.ta : c.en) : api;
}

/**
 * domain/districts.ts — the 38 districts of Tamil Nadu, used for the
 * manual-location fallback, weather lookup by name and mandi filters.
 */
export interface District {
  en: string;
  ta: string;
}

export const TN_DISTRICTS: readonly District[] = [
  { en: "Ariyalur", ta: "அரியலூர்" },
  { en: "Chengalpattu", ta: "செங்கல்பட்டு" },
  { en: "Chennai", ta: "சென்னை" },
  { en: "Coimbatore", ta: "கோயம்புத்தூர்" },
  { en: "Cuddalore", ta: "கடலூர்" },
  { en: "Dharmapuri", ta: "தர்மபுரி" },
  { en: "Dindigul", ta: "திண்டுக்கல்" },
  { en: "Erode", ta: "ஈரோடு" },
  { en: "Kallakurichi", ta: "கள்ளக்குறிச்சி" },
  { en: "Kancheepuram", ta: "காஞ்சிபுரம்" },
  { en: "Kanniyakumari", ta: "கன்னியாகுமரி" },
  { en: "Karur", ta: "கரூர்" },
  { en: "Krishnagiri", ta: "கிருஷ்ணகிரி" },
  { en: "Madurai", ta: "மதுரை" },
  { en: "Mayiladuthurai", ta: "மயிலாடுதுறை" },
  { en: "Nagapattinam", ta: "நாகப்பட்டினம்" },
  { en: "Namakkal", ta: "நாமக்கல்" },
  { en: "Nilgiris", ta: "நீலகிரி" },
  { en: "Perambalur", ta: "பெரம்பலூர்" },
  { en: "Pudukkottai", ta: "புதுக்கோட்டை" },
  { en: "Ramanathapuram", ta: "இராமநாதபுரம்" },
  { en: "Ranipet", ta: "இராணிப்பேட்டை" },
  { en: "Salem", ta: "சேலம்" },
  { en: "Sivaganga", ta: "சிவகங்கை" },
  { en: "Tenkasi", ta: "தென்காசி" },
  { en: "Thanjavur", ta: "தஞ்சாவூர்" },
  { en: "Theni", ta: "தேனி" },
  { en: "Thoothukudi", ta: "தூத்துக்குடி" },
  { en: "Tiruchirappalli", ta: "திருச்சிராப்பள்ளி" },
  { en: "Tirunelveli", ta: "திருநெல்வேலி" },
  { en: "Tirupathur", ta: "திருப்பத்தூர்" },
  { en: "Tiruppur", ta: "திருப்பூர்" },
  { en: "Tiruvallur", ta: "திருவள்ளூர்" },
  { en: "Tiruvannamalai", ta: "திருவண்ணாமலை" },
  { en: "Tiruvarur", ta: "திருவாரூர்" },
  { en: "Vellore", ta: "வேலூர்" },
  { en: "Viluppuram", ta: "விழுப்புரம்" },
  { en: "Virudhunagar", ta: "விருதுநகர்" },
];

/**
 * District headquarters coordinates (2 decimals, ~1 km), used for weather.
 * Looking weather up by name is unreliable: OpenWeatherMap returns 404 for
 * "Viluppuram", "Kallakurichi", "Kancheepuram", "Nilgiris", "Ranipet" and
 * "Tiruvarur", and its geocoder puts "Ariyalur" near Chennai. Each pair was
 * checked with OpenWeatherMap reverse geocoding (2026-11-03) and resolves to
 * the district's headquarters town (Nagercoil for Kanniyakumari,
 * Udhagamandalam for Nilgiris, Wallajah/Ranipet, Palayamkottai/Tirunelveli).
 */
export const DISTRICT_HQ: Readonly<Record<string, { lat: number; lng: number }>> = {
  Ariyalur: { lat: 11.14, lng: 79.08 },
  Chengalpattu: { lat: 12.69, lng: 79.98 },
  Chennai: { lat: 13.08, lng: 80.27 },
  Coimbatore: { lat: 11.0, lng: 76.96 },
  Cuddalore: { lat: 11.75, lng: 79.75 },
  Dharmapuri: { lat: 12.13, lng: 78.16 },
  Dindigul: { lat: 10.36, lng: 77.98 },
  Erode: { lat: 11.34, lng: 77.72 },
  Kallakurichi: { lat: 11.74, lng: 78.96 },
  Kancheepuram: { lat: 12.83, lng: 79.7 },
  Kanniyakumari: { lat: 8.18, lng: 77.41 },
  Karur: { lat: 10.96, lng: 78.08 },
  Krishnagiri: { lat: 12.52, lng: 78.21 },
  Madurai: { lat: 9.93, lng: 78.12 },
  Mayiladuthurai: { lat: 11.1, lng: 79.65 },
  Nagapattinam: { lat: 10.77, lng: 79.84 },
  Namakkal: { lat: 11.22, lng: 78.17 },
  Nilgiris: { lat: 11.41, lng: 76.7 },
  Perambalur: { lat: 11.23, lng: 78.88 },
  Pudukkottai: { lat: 10.38, lng: 78.82 },
  Ramanathapuram: { lat: 9.37, lng: 78.83 },
  Ranipet: { lat: 12.93, lng: 79.33 },
  Salem: { lat: 11.66, lng: 78.15 },
  Sivaganga: { lat: 9.85, lng: 78.48 },
  Tenkasi: { lat: 8.96, lng: 77.3 },
  Thanjavur: { lat: 10.79, lng: 79.14 },
  Theni: { lat: 10.01, lng: 77.48 },
  Thoothukudi: { lat: 8.76, lng: 78.13 },
  Tiruchirappalli: { lat: 10.79, lng: 78.7 },
  Tirunelveli: { lat: 8.71, lng: 77.76 },
  Tirupathur: { lat: 12.5, lng: 78.57 },
  Tiruppur: { lat: 11.11, lng: 77.34 },
  Tiruvallur: { lat: 13.14, lng: 79.91 },
  Tiruvannamalai: { lat: 12.23, lng: 79.07 },
  Tiruvarur: { lat: 10.77, lng: 79.64 },
  Vellore: { lat: 12.92, lng: 79.13 },
  Viluppuram: { lat: 11.94, lng: 79.49 },
  Virudhunagar: { lat: 9.58, lng: 77.96 },
};

export function districtCoords(en: string | null | undefined): { lat: number; lng: number } | null {
  return (en && DISTRICT_HQ[en]) || null;
}

export function districtName(en: string, lang: "ta" | "en"): string {
  if (lang === "en") return en;
  return TN_DISTRICTS.find((d) => d.en === en)?.ta ?? en;
}

/** Map a free-text place name (e.g. from a weather API) to a known district. */
export function matchDistrict(name: string | undefined | null): string | null {
  if (!name) return null;
  const n = name.trim().toLowerCase();
  return TN_DISTRICTS.find((d) => d.en.toLowerCase() === n)?.en ?? null;
}

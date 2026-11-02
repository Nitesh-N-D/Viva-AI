import type { Lang } from "../i18n";
import { districtName } from "../domain/districts";
import type { AppLocation } from "./store";

export type LocationLabelKind = "district" | "gps" | "unset";

type Translate = (key: string, vars?: Record<string, string | number | null | undefined>) => string;

/**
 * The one place that turns the saved location into display text.
 *
 * - district saved      → the district name in the current language
 * - GPS coordinates only → "GPS location (approx.)": the app has no reverse
 *   geocoder, so it never invents a place name for raw coordinates
 * - nothing saved        → "Location not set"
 *
 * It never returns an empty string, `undefined`, `null` or a raw `{token}`.
 */
export function locationLabel(location: AppLocation | null | undefined, t: Translate, lang: Lang): { kind: LocationLabelKind; text: string } {
  if (location?.district) {
    const name = districtName(location.district, lang);
    if (name) return { kind: "district", text: name };
  }
  if (location?.coords && Number.isFinite(location.coords.lat) && Number.isFinite(location.coords.lng)) {
    return { kind: "gps", text: t("location.gpsApprox") };
  }
  return { kind: "unset", text: t("location.notSet") };
}

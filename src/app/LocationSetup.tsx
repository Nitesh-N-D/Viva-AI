import React, { useState } from "react";
import { useT } from "../i18n";
import { TN_DISTRICTS, districtName } from "../domain/districts";
import { Button } from "../shared/ui/Button";
import { SelectField } from "../shared/ui/Field";
import { Notice } from "../shared/ui/Feedback";
import { useAppStore, type AppLocation } from "./store";

type GpsState = "idle" | "locating" | "denied" | "timeout" | "unavailable" | "unsupported";

/** GeolocationPositionError code → UI state (1 denied, 2 unavailable, 3 timeout). */
export function gpsErrorState(code: number): GpsState {
  if (code === 1) return "denied";
  if (code === 3) return "timeout";
  return "unavailable";
}

/**
 * Location picker shared by first-run setup and Settings. GPS is optional:
 * the district list always works, and nothing in the app waits on it.
 */
export function LocationSetup({ onDone, compact }: { onDone?: () => void; compact?: boolean }) {
  const { t, lang } = useT();
  const current = useAppStore((s) => s.location);
  const setLocation = useAppStore((s) => s.setLocation);
  const [district, setDistrict] = useState(current?.district ?? "");
  const [gps, setGps] = useState<GpsState>("idle");

  function save(loc: AppLocation) {
    setLocation(loc);
    onDone?.();
  }

  function useGps() {
    // Geolocation needs a secure context (https or localhost).
    if (typeof navigator === "undefined" || !("geolocation" in navigator) || (typeof window !== "undefined" && window.isSecureContext === false)) {
      setGps("unsupported");
      return;
    }
    setGps("locating");
    try {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude, longitude } = pos.coords;
          if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
            setGps("unavailable");
            return;
          }
          setGps("idle");
          // Stored rounded to ~1 km by the store; the raw fix is not kept.
          save({ district: district || null, coords: { lat: latitude, lng: longitude }, source: "gps" });
        },
        (err) => setGps(gpsErrorState(err.code)),
        { timeout: 10_000, maximumAge: 10 * 60_000, enableHighAccuracy: false }
      );
    } catch {
      setGps("unavailable");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {!compact && <p className="text-soil-700">{t("onboarding.intro")}</p>}

      <Button onClick={useGps} disabled={gps === "locating"} variant="secondary" icon="📍" block>
        {gps === "locating" ? t("onboarding.locating") : t("onboarding.useLocation")}
      </Button>
      {gps === "denied" && (
        <Notice tone="warning" title={t("onboarding.locationDenied")}>
          {t("location.deniedHelp")}
        </Notice>
      )}
      {gps === "timeout" && <Notice tone="warning">{t("location.timeout")}</Notice>}
      {gps === "unavailable" && <Notice tone="warning">{t("onboarding.locationError")}</Notice>}
      {gps === "unsupported" && <Notice tone="warning">{t("onboarding.locationUnsupported")}</Notice>}

      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (district) save({ district, coords: null, source: "manual" });
        }}
      >
        <SelectField
          label={t("onboarding.districtLabel")}
          value={district}
          onChange={(e) => setDistrict(e.target.value)}
          placeholder={t("onboarding.districtPlaceholder")}
          options={TN_DISTRICTS.map((d) => ({ value: d.en, label: districtName(d.en, lang) }))}
        />
        <Button type="submit" disabled={!district} block>
          {t("onboarding.continue")}
        </Button>
      </form>

      <p className="text-xs text-soil-500">{t("onboarding.privacy")}</p>
    </div>
  );
}

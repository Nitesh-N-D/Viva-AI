import React, { useState } from "react";
import { useT } from "../i18n";
import { locationLabel } from "./locationLabel";
import { taxonName } from "../domain/taxonomy";
import { cropById, cropName, stageFor } from "../modules/farm/cropEngine";
import { formatIsoDate, percent, relativeTime } from "../lib/format";
import { Card, Stat } from "../shared/ui/Card";
import { Button } from "../shared/ui/Button";
import { Badge, Notice, Skeleton, SourceBadge } from "../shared/ui/Feedback";
import { LocationSetup } from "./LocationSetup";
import { navigate, type Route } from "./router";
import { useAppStore } from "./store";
import { useWeather } from "./useWeather";
import { useSyncStatus } from "./useSync";

const ACTIONS: { route: Route; icon: string; key: string; tone: string }[] = [
  { route: { name: "soil" }, icon: "🟤", key: "home.soilScan", tone: "bg-soil-100 text-soil-900" },
  { route: { name: "disease" }, icon: "🍃", key: "home.diseaseScan", tone: "bg-leaf-100 text-leaf-900" },
  { route: { name: "crops", soil: null }, icon: "🌾", key: "home.crops", tone: "bg-ember-100 text-soil-900" },
  { route: { name: "market" }, icon: "₹", key: "home.mandi", tone: "bg-info-100 text-soil-900" },
  { route: { name: "map" }, icon: "🗺️", key: "home.soilMap", tone: "bg-leaf-50 text-leaf-900" },
  { route: { name: "maker" }, icon: "🔧", key: "home.maker", tone: "bg-steel-100 text-steel-900" },
];

function WeatherCard() {
  const { t, lang } = useT();
  const location = useAppStore((s) => s.location);
  const { weather, loading, refresh } = useWeather(location);

  if (!location) return null;
  return (
    <Card
      title={t("home.weather")}
      action={
        <Button size="sm" variant="ghost" onClick={() => void refresh()} disabled={loading} aria-label={t("home.refreshWeather")}>
          ↻
        </Button>
      }
    >
      {!weather && <Skeleton className="h-20" />}
      {weather && weather.source === "unavailable" && (
        <Notice tone={weather.error === "no_key" ? "info" : "warning"}>{t(`weather.error.${weather.error ?? "network"}`)}</Notice>
      )}
      {weather && weather.source !== "unavailable" && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 flex-wrap text-xs text-soil-600">
            <SourceBadge source={weather.source} />
            {weather.placeName && <span>{weather.placeName}</span>}
            {weather.fetchedAt && <span>· {t("common.updated", { time: relativeTime(weather.fetchedAt, lang) })}</span>}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Stat label={t("home.temp")} value={weather.tempC !== null ? `${Math.round(weather.tempC)}°C` : "—"} hint={weather.condition ?? undefined} />
            <Stat label={t("home.humidity")} value={weather.humidity !== null ? `${weather.humidity}%` : "—"} />
            <Stat label={t("home.wind")} value={weather.windKph !== null ? `${Math.round(weather.windKph)} km/h` : "—"} />
            <Stat label={t("home.rain5d")} value={weather.rainNext5dMm !== null ? `${weather.rainNext5dMm} mm` : "—"} hint={t(`seasons.${weather.season}`)} />
          </div>
          {weather.daily.length > 0 && (
            <ol className="grid grid-cols-5 gap-1 text-center text-xs" aria-label={t("home.forecast")}>
              {weather.daily.map((d) => (
                <li key={d.date} className="rounded-tile bg-soil-50 p-1.5">
                  <p className="font-semibold">{formatIsoDate(d.date, lang).replace(/\s?\d{4}$/, "")}</p>
                  <p>
                    {Math.round(d.maxC)}° / {Math.round(d.minC)}°
                  </p>
                  <p className="text-info-700">{d.rainMm > 0 ? `${d.rainMm} mm` : "—"}</p>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </Card>
  );
}

function ActiveCropCard() {
  const { t, lang } = useT();
  const active = useAppStore((s) => s.activeCrop);
  const crop = active ? cropById(active.cropId) : undefined;
  if (!active || !crop) return null;
  const days = Math.max(0, Math.floor((Date.now() - active.plantedAt) / 86_400_000));
  const { stage, done } = stageFor(crop, days);
  const pct = Math.min(100, Math.round((days / crop.durationDays) * 100));
  return (
    <Card title={t("home.myCrop")} action={<Button size="sm" variant="ghost" onClick={() => navigate({ name: "farm" })}>{t("common.open")}</Button>}>
      <p className="font-display font-bold text-lg">{cropName(crop, lang)}</p>
      <p className="text-sm text-soil-700">
        {done ? t("farm.harvestDue") : t("farm.dayOf", { day: days, total: crop.durationDays })} · {stage[lang]}
      </p>
      <div className="h-2 rounded-full bg-soil-100 overflow-hidden mt-2" aria-hidden="true">
        <div className="h-full bg-leaf-600" style={{ width: `${pct}%` }} />
      </div>
    </Card>
  );
}

function RecentScans() {
  const { t, lang } = useT();
  const scans = useAppStore((s) => s.recentScans);
  if (scans.length === 0) return null;
  return (
    <Card title={t("home.recentScans")}>
      <ul className="flex flex-col divide-y divide-soil-100">
        {scans.slice(0, 5).map((s) => (
          <li key={`${s.at}-${s.labelId}`} className="flex items-center justify-between gap-2 py-2 text-sm">
            <span className="min-w-0 truncate">
              {s.task === "soil" ? "🟤" : "🍃"} {taxonName(s.task, s.labelId, lang)}
            </span>
            <span className="text-xs text-soil-500 shrink-0">
              {percent(s.score)} · {relativeTime(s.at, lang)}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function SyncCard() {
  const { t, lang } = useT();
  const { stats, lastSync, configured } = useSyncStatus();
  if (!configured && stats.total === 0) return null;
  return (
    <Card title={t("sync.title")} action={<Button size="sm" variant="ghost" onClick={() => navigate({ name: "settings" })}>{t("common.open")}</Button>}>
      <div className="flex flex-wrap gap-2 items-center text-sm">
        {stats.total > 0 ? <Badge tone="warning">{t("sync.pendingShort", { count: stats.total })}</Badge> : <Badge tone="live">{t("sync.syncedShort")}</Badge>}
        {lastSync && <span className="text-xs text-soil-600">{t("sync.lastSync", { time: relativeTime(lastSync.at, lang) })}</span>}
      </div>
    </Card>
  );
}

export function HomeScreen() {
  const { t, lang } = useT();
  const location = useAppStore((s) => s.location);
  const [setupDismissed, setSetupDismissed] = useState(false);
  const place = locationLabel(location, t, lang);

  return (
    <div className="flex flex-col gap-4 max-w-5xl mx-auto w-full px-4 py-4 sm:py-6">
      <header>
        <h1 className="font-display font-extrabold text-2xl sm:text-3xl text-soil-900">{t("home.greeting")}</h1>
        <p className="text-soil-600 text-sm">
          {place.kind === "district" ? t("home.nearYou", { place: place.text }) : place.kind === "gps" ? place.text : t("home.tagline")}
        </p>
      </header>

      {!location && !setupDismissed && (
        <Card title={t("home.setLocation")}>
          <p className="text-sm text-soil-700 mb-3">{t("onboarding.locationWhy")}</p>
          <LocationSetup />
          <Button variant="ghost" size="sm" className="mt-2" onClick={() => setSetupDismissed(true)}>
            {t("onboarding.skip")}
          </Button>
        </Card>
      )}

      <nav aria-label={t("home.actions")}>
        <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {ACTIONS.map((a) => (
            <li key={a.key}>
              <button
                type="button"
                onClick={() => navigate(a.route)}
                className={`w-full h-full min-h-[96px] rounded-card shadow-card ${a.tone} flex flex-col items-center justify-center gap-1 p-3 text-center font-semibold hover:shadow-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-leaf-600 transition-shadow`}
              >
                <span className="text-3xl" aria-hidden="true">
                  {a.icon}
                </span>
                <span className="text-sm leading-tight">{t(a.key)}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div className="grid gap-4 lg:grid-cols-2">
        <WeatherCard />
        <ActiveCropCard />
        <RecentScans />
        <SyncCard />
      </div>
    </div>
  );
}

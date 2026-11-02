import React, { useCallback, useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { useT } from "../../../i18n";
import {
  MAX_REVIEW_LENGTH,
  getRatings,
  getSoilMapTiles,
  isFirebaseConfigured,
  ratingTargetId,
  reportRating,
  saveRating,
  type MapTileSummary,
  type RatingSummary,
  type Remote,
  type ReportReason,
} from "../../../lib/firebase";
import { SOIL_TYPES, taxonName } from "../../../domain/taxonomy";
import { relativeTime } from "../../../lib/format";
import { useAppStore } from "../../../app/store";
import { Screen } from "../../../shared/ui/Screen";
import { Card } from "../../../shared/ui/Card";
import { Button } from "../../../shared/ui/Button";
import { Badge, EmptyState, Notice, Spinner } from "../../../shared/ui/Feedback";
import { SelectField } from "../../../shared/ui/Field";
import { StarInput, Stars } from "../../../shared/ui/StarRating";
import { Dialog } from "../../../shared/ui/Dialog";
import { toast } from "../../../shared/ui/Toast";

export const SOIL_COLORS: Record<string, string> = {
  red: "#b5502f",
  black: "#2f2a26",
  alluvial: "#6f8f5e",
  laterite: "#c98a3a",
};

const TN_CENTER: [number, number] = [11.0, 78.4];

function FlyTo({ target }: { target: { lat: number; lng: number; zoom: number } | null }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.flyTo([target.lat, target.lng], target.zoom, { duration: 0.8 });
  }, [map, target]);
  return null;
}

function ReviewList({ summary, onReport }: { summary: RatingSummary; onReport: (id: string) => void }) {
  const { t, lang } = useT();
  if (summary.reviews.length === 0) return <p className="text-sm text-soil-600">{t("map.noReviews")}</p>;
  return (
    <ul className="flex flex-col gap-3">
      {summary.reviews.map((r) => (
        <li key={r.id} className="border-b border-soil-100 pb-2 last:border-0">
          <div className="flex items-center justify-between gap-2">
            <Stars value={r.stars} label={t("map.starsLabel", { n: r.stars })} size="text-sm" />
            <span className="text-xs text-soil-500">{relativeTime(r.updatedAt, lang)}</span>
          </div>
          <p className="text-sm mt-1 break-words">{r.review}</p>
          {r.mine ? (
            <Badge tone="neutral">{t("map.yourReview")}</Badge>
          ) : (
            <button type="button" className="text-xs text-soil-500 underline mt-1 min-h-[32px]" onClick={() => onReport(r.id)}>
              {t("map.report")}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

function RatingForm({ tile, summary, onSaved }: { tile: MapTileSummary; summary: RatingSummary | undefined; onSaved: () => void }) {
  const { t } = useT();
  const [stars, setStars] = useState(summary?.mine?.stars ?? 0);
  const [review, setReview] = useState(summary?.mine?.review ?? "");
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (stars < 1) return;
    setSaving(true);
    try {
      await saveRating("soilTile", ratingTargetId(tile.geoTile), stars, review);
      toast.success(t("map.ratingSaved"));
      onSaved();
    } catch (err) {
      console.warn("[map] rating failed", err);
      toast.error(t("map.ratingFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 mt-2">
      <p className="text-sm font-semibold">{summary?.mine ? t("map.updateRating") : t("map.ratePrompt")}</p>
      <StarInput name={`rate-${tile.geoTile}`} value={stars} onChange={setStars} labelFor={(n) => t("map.rateStar", { n })} disabled={saving} />
      <label className="text-xs text-soil-600" htmlFor={`review-${tile.geoTile}`}>
        {t("map.reviewLabel")}
      </label>
      <textarea
        id={`review-${tile.geoTile}`}
        value={review}
        maxLength={MAX_REVIEW_LENGTH}
        onChange={(e) => setReview(e.target.value)}
        rows={2}
        className="w-full rounded-tile border border-soil-200 p-2 text-sm"
        placeholder={t("map.reviewPlaceholder")}
      />
      <Button type="submit" size="sm" disabled={stars < 1 || saving}>
        {saving ? t("common.saving") : t("map.submitRating")}
      </Button>
    </form>
  );
}

function TilePopup({
  tile,
  summary,
  ratingsState,
  onSaved,
  onViewReviews,
}: {
  tile: MapTileSummary;
  summary: RatingSummary | undefined;
  ratingsState: Remote<unknown>["status"] | "loading";
  onSaved: () => void;
  onViewReviews: () => void;
}) {
  const { t, lang } = useT();
  const soilName = taxonName("soil", tile.dominantSoilType, lang);
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs text-soil-500">{t("map.category")}</p>
      <p className="font-display font-bold text-base">{t("map.dominant", { soil: soilName })}</p>
      <p className="text-xs text-soil-600">
        {t("map.scans", { count: tile.scanCount })} ·{" "}
        {Object.entries(tile.soilCounts)
          .map(([id, n]) => `${taxonName("soil", id, lang)} ${n}`)
          .join(", ")}
      </p>
      <hr className="border-soil-100 my-1" />
      {ratingsState === "loading" && <p className="text-xs">{t("common.loading")}</p>}
      {ratingsState === "error" && <p className="text-xs text-danger-600">{t("map.ratingsError")}</p>}
      {ratingsState === "ok" &&
        (summary ? (
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-2">
              <span className="font-display font-bold text-lg">{summary.average.toFixed(1)}</span>
              <Stars value={summary.average} label={t("map.avgRating", { avg: summary.average, count: summary.count })} />
            </div>
            <p className="text-xs text-soil-600">
              {t("map.ratingCount", { count: summary.count })} · {t("map.latest", { time: relativeTime(summary.latestUpdate, lang) })}
            </p>
            <button type="button" className="text-xs text-leaf-700 underline text-left min-h-[32px]" onClick={onViewReviews}>
              {t("map.viewReviews", { count: summary.reviews.length })}
            </button>
          </div>
        ) : (
          <p className="text-xs text-soil-600">{t("map.noRatings")}</p>
        ))}
      {ratingsState === "ok" && <RatingForm tile={tile} summary={summary} onSaved={onSaved} />}
    </div>
  );
}

export function SoilMap() {
  const { t, lang } = useT();
  const location = useAppStore((s) => s.location);
  const [tiles, setTiles] = useState<Remote<MapTileSummary[]> | null>(null);
  const [ratings, setRatings] = useState<Remote<Map<string, RatingSummary>> | null>(null);
  const [soilFilter, setSoilFilter] = useState("");
  const [minRating, setMinRating] = useState(0);
  const [flyTarget, setFlyTarget] = useState<{ lat: number; lng: number; zoom: number } | null>(null);
  const [reviewsFor, setReviewsFor] = useState<string | null>(null);
  const [reporting, setReporting] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  const loadRatings = useCallback(async () => setRatings(await getRatings("soilTile")), []);
  const loadAll = useCallback(async () => {
    setTiles(null);
    setTiles(await getSoilMapTiles());
    void loadRatings();
  }, [loadRatings]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const ratingMap = ratings?.status === "ok" ? ratings.data : null;

  const visible = useMemo(() => {
    if (tiles?.status !== "ok") return [];
    return tiles.data.filter((tile) => {
      if (soilFilter && tile.dominantSoilType !== soilFilter) return false;
      if (minRating > 0) {
        const s = ratingMap?.get(ratingTargetId(tile.geoTile));
        if (!s || s.average < minRating) return false;
      }
      return true;
    });
  }, [tiles, soilFilter, minRating, ratingMap]);

  function locateMe() {
    if (location?.coords) {
      setFlyTarget({ ...location.coords, zoom: 12 });
      return;
    }
    if (!("geolocation" in navigator)) {
      toast.error(t("onboarding.locationUnsupported"));
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        setFlyTarget({ lat: Math.round(pos.coords.latitude * 100) / 100, lng: Math.round(pos.coords.longitude * 100) / 100, zoom: 12 });
      },
      () => {
        setLocating(false);
        toast.error(t("onboarding.locationError"));
      },
      { timeout: 10_000, maximumAge: 600_000 }
    );
  }

  async function submitReport(reason: ReportReason) {
    if (!reporting) return;
    try {
      await reportRating(reporting, reason);
      toast.success(t("map.reportSent"));
    } catch (err) {
      console.warn("[map] report failed", err);
      toast.error(t("map.reportFailed"));
    } finally {
      setReporting(null);
    }
  }

  const reviewSummary = reviewsFor ? ratingMap?.get(reviewsFor) : undefined;
  const scanTotal = tiles?.status === "ok" ? tiles.data.reduce((n, x) => n + x.scanCount, 0) : 0;

  return (
    <Screen title={t("map.title")} subtitle={t("map.subtitle")} wide>
      <Card>
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto] items-end">
          <SelectField
            label={t("map.filterSoil")}
            value={soilFilter}
            onChange={(e) => setSoilFilter(e.target.value)}
            placeholder={t("map.filterAll")}
            options={SOIL_TYPES.map((s) => ({ value: s.id, label: taxonName("soil", s.id, lang) }))}
          />
          <SelectField
            label={t("map.filterRating")}
            value={String(minRating)}
            onChange={(e) => setMinRating(Number(e.target.value))}
            options={[0, 3, 4].map((n) => ({ value: String(n), label: n === 0 ? t("map.anyRating") : t("map.atLeast", { n }) }))}
          />
          <Button
            variant="secondary"
            onClick={() => {
              setSoilFilter("");
              setMinRating(0);
              setFlyTarget({ lat: TN_CENTER[0], lng: TN_CENTER[1], zoom: 7 });
            }}
          >
            {t("map.reset")}
          </Button>
          <Button variant="secondary" onClick={locateMe} disabled={locating} icon="📍">
            {t("map.locateMe")}
          </Button>
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-2 text-xs text-soil-600">
        {tiles?.status === "ok" && <Badge tone="live">{t("map.source", { count: scanTotal })}</Badge>}
        {tiles?.status === "ok" && <span>{t("map.showing", { shown: visible.length, total: tiles.data.length })}</span>}
        <span>· {t("map.privacy")}</span>
      </div>

      {tiles === null && <Spinner />}
      {tiles?.status === "not_configured" && <Notice tone="info">{t("map.notConfigured")}</Notice>}
      {tiles?.status === "error" && (
        <Notice tone="error" title={t("map.loadError")} action={<Button size="sm" variant="secondary" onClick={() => void loadAll()}>{t("common.retry")}</Button>}>
          <p>{t("errors.unexpected")}</p>
          {tiles.message && (
            <details className="mt-2 text-xs" data-no-read>
              <summary className="cursor-pointer">{t("errors.details")}</summary>
              <span className="font-mono break-all">{tiles.message}</span>
            </details>
          )}
        </Notice>
      )}
      {!isFirebaseConfigured && <p className="text-xs text-soil-500">{t("map.signInNeeded")}</p>}

      <div className="relative rounded-card overflow-hidden border border-soil-200 shadow-card h-[60vh] min-h-[360px]">
        <MapContainer center={TN_CENTER} zoom={7} className="h-full w-full" scrollWheelZoom>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <FlyTo target={flyTarget} />
          {visible.map((tile) => {
            const id = ratingTargetId(tile.geoTile);
            return (
              <CircleMarker
                key={tile.geoTile}
                center={[tile.lat, tile.lng]}
                radius={Math.min(18, 7 + Math.log2(tile.scanCount + 1) * 3)}
                pathOptions={{ color: "#fff", weight: 2, fillColor: SOIL_COLORS[tile.dominantSoilType] ?? "#888", fillOpacity: 0.9 }}
              >
                <Popup>
                  <TilePopup
                    tile={tile}
                    summary={ratingMap?.get(id)}
                    ratingsState={ratings === null ? "loading" : ratings.status}
                    onSaved={() => void loadRatings()}
                    onViewReviews={() => setReviewsFor(id)}
                  />
                </Popup>
              </CircleMarker>
            );
          })}
        </MapContainer>

        <div className="absolute bottom-3 left-3 z-[400] bg-white/95 rounded-tile shadow-card p-2 text-xs" aria-label={t("map.legend")}>
          <p className="font-semibold mb-1">{t("map.legend")}</p>
          <ul className="flex flex-col gap-0.5">
            {SOIL_TYPES.map((s) => (
              <li key={s.id} className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full inline-block border border-white shadow" style={{ background: SOIL_COLORS[s.id] }} aria-hidden="true" />
                {taxonName("soil", s.id, lang)}
              </li>
            ))}
          </ul>
        </div>

        {tiles?.status === "ok" && visible.length === 0 && (
          <div className="absolute inset-x-0 top-3 z-[400] flex justify-center px-3 pointer-events-none">
            <div className="bg-white/95 rounded-tile shadow-card px-3 py-2 text-sm pointer-events-auto">
              {tiles.data.length === 0 ? t("map.noData") : t("map.noMatches")}
            </div>
          </div>
        )}
      </div>

      {tiles?.status === "ok" && tiles.data.length === 0 && <EmptyState icon="🗺️" title={t("map.noData")} body={t("map.howToAdd")} />}

      <Notice tone="neutral">{t("map.noServiceCentres")}</Notice>

      <Dialog open={reviewsFor !== null} onClose={() => setReviewsFor(null)} title={t("map.reviewsTitle")}>
        {reviewSummary ? <ReviewList summary={reviewSummary} onReport={(rid) => setReporting(rid)} /> : <p>{t("map.noReviews")}</p>}
      </Dialog>

      <Dialog open={reporting !== null} onClose={() => setReporting(null)} title={t("map.reportTitle")}>
        <div className="flex flex-col gap-2">
          <p className="text-sm text-soil-700">{t("map.reportBody")}</p>
          {(["spam", "abusive", "wrong"] as const).map((r) => (
            <Button key={r} variant="secondary" onClick={() => void submitReport(r)}>
              {t(`map.reportReason.${r}`)}
            </Button>
          ))}
        </div>
      </Dialog>
    </Screen>
  );
}

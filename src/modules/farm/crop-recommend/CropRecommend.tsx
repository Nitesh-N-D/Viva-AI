import React, { useState } from "react";
import { useT } from "../../../i18n";
import { SOIL_TYPES, taxonName } from "../../../domain/taxonomy";
import { seasonFor, type Season } from "../../../lib/weather";
import {
  CROP_SOURCE,
  cropName,
  recommendCrops,
  validInputs,
  type Check,
  type DurationPref,
  type WaterAvailability,
} from "../cropEngine";
import { Screen } from "../../../shared/ui/Screen";
import { Card } from "../../../shared/ui/Card";
import { Button } from "../../../shared/ui/Button";
import { Badge, Notice } from "../../../shared/ui/Feedback";
import { InputField, Segmented, SelectField } from "../../../shared/ui/Field";
import { navigate } from "../../../app/router";
import { useAppStore } from "../../../app/store";
import { useWeather } from "../../../app/useWeather";
import { toast } from "../../../shared/ui/Toast";

const RESULT_ICON: Record<Check["result"], string> = { 1: "✓", 0.5: "≈", 0: "✗" };
const RESULT_CLASS: Record<Check["result"], string> = { 1: "text-leaf-700", 0.5: "text-ember-600", 0: "text-danger-600" };

export function CropRecommend({ soil: routeSoil }: { soil: string | null }) {
  const { t, lang } = useT();
  const lastSoil = useAppStore((s) => s.lastSoil);
  const setLastSoil = useAppStore((s) => s.setLastSoil);
  const setActiveCrop = useAppStore((s) => s.setActiveCrop);
  const location = useAppStore((s) => s.location);
  const { weather } = useWeather(location);

  const [soil, setSoil] = useState<string>(routeSoil ?? lastSoil ?? "");
  const [season, setSeason] = useState<Season>(() => seasonFor(new Date()));
  const [water, setWater] = useState<WaterAvailability | null>(null);
  const [phText, setPhText] = useState("");
  const [duration, setDuration] = useState<DurationPref | null>(null);

  const ph = phText.trim() === "" ? null : Number(phText);
  const inputs = {
    soil: soil || null,
    season,
    water,
    ph: ph !== null && Number.isFinite(ph) ? ph : ph === null ? null : NaN,
    duration,
    rainNext5dMm: weather?.source !== "unavailable" ? weather?.rainNext5dMm ?? null : null,
  };
  const errors = validInputs(inputs);
  const phError = errors.find((e) => e.startsWith("pH")) ? t("cropRecommend.phInvalid") : null;
  // Eight crops × five checks: cheap enough to recompute on every render.
  const result = errors.length ? null : recommendCrops(inputs);

  return (
    <Screen title={t("cropRecommend.title")} subtitle={t("cropRecommend.subtitle")}>
      <Card title={t("cropRecommend.inputs")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label={t("cropRecommend.soil")}
            value={soil}
            onChange={(e) => {
              setSoil(e.target.value);
              setLastSoil(e.target.value || null);
            }}
            placeholder={t("cropRecommend.noSoil")}
            options={SOIL_TYPES.map((s) => ({ value: s.id, label: taxonName("soil", s.id, lang) }))}
          />
          <InputField
            label={t("cropRecommend.ph")}
            hint={t("cropRecommend.phHint")}
            inputMode="decimal"
            value={phText}
            onChange={(e) => setPhText(e.target.value)}
            error={phError}
            placeholder="6.5"
          />
        </div>
        <div className="flex flex-col gap-4 mt-4">
          <Segmented<Season>
            label={t("cropRecommend.season")}
            value={season}
            onChange={setSeason}
            options={(["kharif", "rabi", "summer"] as const).map((s) => ({ value: s, label: t(`seasons.${s}`) }))}
          />
          <Segmented<WaterAvailability>
            label={t("cropRecommend.water")}
            value={water}
            onChange={setWater}
            options={(["irrigated", "rainfed", "limited"] as const).map((w) => ({ value: w, label: t(`cropRecommend.waterOpt.${w}`) }))}
          />
          <Segmented<DurationPref>
            label={t("cropRecommend.duration")}
            value={duration}
            onChange={setDuration}
            options={(["short", "medium", "any"] as const).map((d) => ({ value: d, label: t(`cropRecommend.durationOpt.${d}`) }))}
          />
        </div>
        <p className="text-xs text-soil-500 mt-3">
          {inputs.rainNext5dMm !== null
            ? t("cropRecommend.rainUsed", { mm: inputs.rainNext5dMm })
            : t("cropRecommend.missingRain")}
        </p>
      </Card>

      {result && result.missing.length > 0 && (
        <Notice tone="info" title={t("cropRecommend.missingTitle")}>
          {result.missing.map((m) => t(`cropRecommend.check.${m}`)).join(", ")}
        </Notice>
      )}

      {result && (
        <section aria-label={t("cropRecommend.resultsLabel")} className="flex flex-col gap-3">
          {result.ranked.map((r, i) => (
            <Card key={r.crop.id} as="article">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs text-soil-500">#{i + 1}</p>
                  <h2 className="font-display font-bold text-lg">{cropName(r.crop, lang)}</h2>
                  <p className="text-xs text-soil-600">
                    {t("cropRecommend.durationDays", { days: r.crop.durationDays })} · {t(`cropRecommend.waterNeed.${r.crop.water}`)}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <span className="sr-only">{t("cropRecommend.score", { score: r.score })}</span>
                  <p className="font-display font-extrabold text-2xl text-leaf-800" aria-hidden="true">{r.score}</p>
                  <p className="text-[11px] text-soil-500" aria-hidden="true">/100</p>
                </div>
              </div>
              <div className="h-2 rounded-full bg-soil-100 overflow-hidden my-3" aria-hidden="true">
                <div className="h-full bg-leaf-600" style={{ width: `${r.score}%` }} />
              </div>
              <ul className="flex flex-col gap-1 text-sm">
                {r.checks.map((c) => (
                  <li key={c.id} className="flex gap-2">
                    <span className={`font-bold w-4 ${RESULT_CLASS[c.result]}`} aria-hidden="true">
                      {RESULT_ICON[c.result]}
                    </span>
                    <span>
                      {t(`cropRecommend.reason.${c.id}.${c.result === 1 ? "ok" : c.result === 0.5 ? "partial" : "bad"}`, {
                        soil: soil ? taxonName("soil", soil, lang) : "",
                        season: t(`seasons.${season}`),
                        min: r.crop.phMin,
                        max: r.crop.phMax,
                        days: r.crop.durationDays,
                      })}
                    </span>
                  </li>
                ))}
              </ul>
              {r.risks.length > 0 && (
                <div className="mt-3 flex flex-col gap-2">
                  {r.risks.map((risk) => (
                    <Notice key={risk} tone="warning">
                      {t(`cropRecommend.risk.${risk}`)}
                    </Notice>
                  ))}
                </div>
              )}
              <Button
                variant="secondary"
                size="sm"
                className="mt-3"
                onClick={() => {
                  setActiveCrop({ cropId: r.crop.id, plantedAt: Date.now() });
                  toast.success(t("cropRecommend.planted", { crop: cropName(r.crop, lang) }));
                  navigate({ name: "farm" });
                }}
              >
                {t("cropRecommend.plant")}
              </Button>
            </Card>
          ))}
        </section>
      )}

      <Card>
        <div className="flex flex-col gap-2 text-xs text-soil-600">
          <Badge tone="neutral">{t("cropRecommend.scoreNote")}</Badge>
          <p>{t("cropRecommend.disclaimer")}</p>
          <p>
            {t("common.source")}:{" "}
            <a href={CROP_SOURCE.url} target="_blank" rel="noopener noreferrer" className="underline text-leaf-700">
              {CROP_SOURCE.name}
            </a>
          </p>
        </div>
      </Card>
    </Screen>
  );
}

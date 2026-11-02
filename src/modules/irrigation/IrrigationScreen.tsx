import React, { useMemo, useState } from "react";
import { useT } from "../../i18n";
import { CROPS, STAGES, cropById, cropName } from "../farm/cropEngine";
import { formatDateTime, formatIsoDate } from "../../lib/format";
import { addDaysIso, todayIso } from "../../lib/localDb";
import { taxonName } from "../../domain/taxonomy";
import { useAppStore } from "../../app/store";
import { useWeather } from "../../app/useWeather";
import { estimateIrrigation, soilAdvice, validateIrrigationInput, EFFICIENCY, type DayInput, type IrrigationMethod } from "./irrigationLogic";
import { Screen } from "../../shared/ui/Screen";
import { Card, Stat } from "../../shared/ui/Card";
import { Button } from "../../shared/ui/Button";
import { Badge, Notice, SourceBadge, Spinner } from "../../shared/ui/Feedback";
import { InputField, Segmented, SelectField } from "../../shared/ui/Field";
import { AiExplain } from "../../shared/ui/AiExplain";

type DaySource = "forecast" | "manual";

const num = (s: string) => (s.trim() === "" ? NaN : Number(s));

export function IrrigationScreen() {
  const { t, lang } = useT();
  const location = useAppStore((s) => s.location);
  const activeCrop = useAppStore((s) => s.activeCrop);
  const lastSoil = useAppStore((s) => s.lastSoil);
  const { weather, loading, refresh } = useWeather(location);

  const [cropId, setCropId] = useState(activeCrop?.cropId ?? "");
  const [sowingDate, setSowingDate] = useState(activeCrop ? todayIso(new Date(activeCrop.plantedAt)) : "");
  const [area, setArea] = useState("1");
  const [method, setMethod] = useState<IrrigationMethod>("surface");
  const [manual, setManual] = useState({ maxC: "", minC: "", rainMm: "0", days: "3" });

  const forecastDays: DayInput[] = useMemo(
    () => (weather && weather.source !== "unavailable" ? weather.daily.map((d) => ({ date: d.date, maxC: d.maxC, minC: d.minC, rainMm: d.rainMm })) : []),
    [weather]
  );
  const source: DaySource = forecastDays.length ? "forecast" : "manual";

  const days: DayInput[] = useMemo(() => {
    if (source === "forecast") return forecastDays;
    const n = Math.min(7, Math.max(1, Math.round(num(manual.days)) || 1));
    const start = todayIso();
    return Array.from({ length: n }, (_, i) => ({ date: addDaysIso(start, i), maxC: num(manual.maxC), minC: num(manual.minC), rainMm: num(manual.rainMm) }));
  }, [source, forecastDays, manual]);

  const daysSinceSowing = sowingDate ? Math.floor((Date.parse(todayIso()) - Date.parse(sowingDate)) / 86_400_000) : NaN;
  const input = { cropId, daysSinceSowing, areaAcres: num(area), method, latDeg: location?.coords?.lat ?? null, days };
  const errors = validateIrrigationInput(input);
  const ready = errors.length === 0 && days.length > 0;
  const estimate = useMemo(() => (ready ? estimateIrrigation(input) : null), [ready, JSON.stringify(input)]); // eslint-disable-line react-hooks/exhaustive-deps
  const advice = soilAdvice(lastSoil);
  const stageName = (id: string) => {
    const s = STAGES.find((x) => x.id === id);
    return s ? s[lang] : id;
  };
  const touched = cropId !== "" && sowingDate !== "";
  const err = (k: string) => (touched && errors.includes(k) ? t(`irrigation.err.${k}`) : null);

  const aiContext = estimate
    ? [
        `Crop: ${estimate.crop.en}, ${daysSinceSowing} days after sowing, stage ${STAGES.find((s) => s.id === estimate.stageId)?.en ?? estimate.stageId}, Kc ${estimate.kc} (FAO-56 Table 12)`,
        `Area: ${input.areaAcres} acres, method ${method} (assumed efficiency ${EFFICIENCY[method]})`,
        `Weather input: ${source === "forecast" ? `OpenWeatherMap forecast (${weather?.source})` : "temperatures typed by farmer"}`,
        ...estimate.days.map((d) => `${d.date}: max ${d.maxC}°C min ${d.minC}°C rain ${d.rainMm} mm → ET0 ${d.et0} mm, crop need ${d.etc} mm, effective rain ${d.peff} mm, irrigation ${d.grossMm} mm (${d.litres} L)`),
        `Total estimated irrigation: ${estimate.totalGrossMm} mm ≈ ${estimate.totalLitres} litres. This is a Hargreaves-based estimate, not a sensor reading.`,
        lastSoil ? `Soil type: ${taxonName("soil", lastSoil, "en")}` : "",
        estimate.latitudeAssumed ? "Latitude assumed 11°N (Tamil Nadu average)." : "",
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  return (
    <Screen title={t("irrigation.title")} subtitle={t("irrigation.subtitle")} wide>
      <Notice tone="info">{t("irrigation.estimateNotice")}</Notice>

      <Card title={t("irrigation.yourField")}>
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField
            label={t("irrigation.crop")}
            value={cropId}
            onChange={(e) => setCropId(e.target.value)}
            placeholder={t("irrigation.chooseCrop")}
            options={CROPS.map((c) => ({ value: c.id, label: cropName(c, lang) }))}
            error={err("crop")}
          />
          <InputField label={t("irrigation.sowingDate")} type="date" max={todayIso()} value={sowingDate} onChange={(e) => setSowingDate(e.target.value)} error={err("days")} />
          <InputField label={t("irrigation.area")} type="number" inputMode="decimal" min="0" step="0.1" value={area} onChange={(e) => setArea(e.target.value)} suffix={t("planner.acres")} error={err("area")} />
          <Segmented
            label={t("irrigation.method")}
            value={method}
            onChange={setMethod}
            options={(["drip", "sprinkler", "surface"] as const).map((m) => ({ value: m, label: t(`irrigation.methods.${m}`) }))}
          />
        </div>
      </Card>

      <Card
        title={t("irrigation.weatherInput")}
        action={
          source === "forecast" && weather ? (
            <div className="flex items-center gap-2">
              <SourceBadge source={weather.source} />
              <Button size="sm" variant="ghost" onClick={() => void refresh()} disabled={loading}>
                {t("common.retry")}
              </Button>
            </div>
          ) : null
        }
      >
        {loading && !weather ? (
          <Spinner label={t("common.loading")} />
        ) : source === "forecast" ? (
          <p className="text-sm text-soil-700">
            {t("irrigation.usingForecast", { n: forecastDays.length, place: weather?.placeName ?? location?.district ?? "" })}
            {weather?.fetchedAt ? ` · ${formatDateTime(weather.fetchedAt, lang)}` : ""}
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            <Notice tone="warning">{location ? t("irrigation.noForecast") : t("irrigation.noLocation")}</Notice>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <InputField label={t("irrigation.maxC")} type="number" inputMode="decimal" value={manual.maxC} onChange={(e) => setManual({ ...manual, maxC: e.target.value })} suffix="°C" />
              <InputField label={t("irrigation.minC")} type="number" inputMode="decimal" value={manual.minC} onChange={(e) => setManual({ ...manual, minC: e.target.value })} suffix="°C" />
              <InputField label={t("irrigation.rain")} type="number" inputMode="decimal" min="0" value={manual.rainMm} onChange={(e) => setManual({ ...manual, rainMm: e.target.value })} suffix="mm" />
              <InputField label={t("irrigation.days")} type="number" inputMode="numeric" min="1" max="7" value={manual.days} onChange={(e) => setManual({ ...manual, days: e.target.value })} />
            </div>
            {touched && (errors.includes("temp") || errors.includes("rain")) && <p className="text-xs text-danger-600">{t(`irrigation.err.${errors.includes("temp") ? "temp" : "rain"}`)}</p>}
            <p className="text-xs text-soil-500">{t("irrigation.manualNote")}</p>
          </div>
        )}
      </Card>

      {estimate && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Stat label={t("irrigation.totalLitres")} value={`${estimate.totalLitres.toLocaleString(lang === "ta" ? "ta-IN" : "en-IN")} L`} hint={t("irrigation.forDays", { n: estimate.days.length })} />
            <Stat label={t("irrigation.totalMm")} value={`${estimate.totalGrossMm} mm`} hint={t("irrigation.grossHint")} />
            <Stat label={t("irrigation.stage")} value={stageName(estimate.stageId)} hint={`Kc ${estimate.kc}`} />
          </div>

          {estimate.warnings.filter((w) => w !== "no_days").map((w) => (
            <Notice key={w} tone={w === "heavy_rain" || w === "heat" ? "warning" : "info"}>
              {t(`irrigation.warn.${w}`)}
            </Notice>
          ))}
          {estimate.rainCoveredDays > 0 && <Notice tone="success">{t("irrigation.rainCovered", { n: estimate.rainCoveredDays })}</Notice>}

          <Card title={t("irrigation.dailyTable")}>
            <div className="overflow-x-auto -mx-4 px-4">
              <table className="w-full text-sm min-w-[36rem]">
                <thead>
                  <tr className="text-left text-soil-600 border-b border-soil-100">
                    <th className="py-2 pr-2 font-semibold">{t("irrigation.date")}</th>
                    <th className="py-2 pr-2 font-semibold">{t("irrigation.temp")}</th>
                    <th className="py-2 pr-2 font-semibold">{t("irrigation.rain")}</th>
                    <th className="py-2 pr-2 font-semibold">ET₀</th>
                    <th className="py-2 pr-2 font-semibold">{t("irrigation.cropNeed")}</th>
                    <th className="py-2 pr-2 font-semibold">{t("irrigation.irrigate")}</th>
                  </tr>
                </thead>
                <tbody>
                  {estimate.days.map((d) => (
                    <tr key={d.date} className="border-b border-soil-50">
                      <td className="py-2 pr-2">{formatIsoDate(d.date, lang)}</td>
                      <td className="py-2 pr-2">
                        {Math.round(d.maxC)}° / {Math.round(d.minC)}°
                      </td>
                      <td className="py-2 pr-2">{d.rainMm} mm</td>
                      <td className="py-2 pr-2">{d.et0} mm</td>
                      <td className="py-2 pr-2">{d.etc} mm</td>
                      <td className="py-2 pr-2 font-semibold">
                        {d.netMm === 0 ? <Badge tone="live">{t("irrigation.skip")}</Badge> : `${d.grossMm} mm · ${d.litres.toLocaleString("en-IN")} L`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-soil-500 mt-2">
              {t("irrigation.method_note", { eff: Math.round(EFFICIENCY[method] * 100) })}
              {estimate.latitudeAssumed ? ` ${t("irrigation.latAssumed")}` : ""}
            </p>
          </Card>

          {advice && (
            <Card title={t("irrigation.soilTitle", { soil: taxonName("soil", lastSoil!, lang) })}>
              <p className="text-sm">{t(`irrigation.soil.${advice}`)}</p>
            </Card>
          )}

          <Card title={t("ai.sectionTitle")}>
            <AiExplain task="irrigation_explain" context={aiContext} />
          </Card>
        </>
      )}

      <details className="text-xs text-soil-600">
        <summary className="cursor-pointer min-h-[44px] flex items-center font-semibold">{t("irrigation.howTitle")}</summary>
        <p className="mt-1">{t("irrigation.how")}</p>
      </details>
      {cropId && !cropById(cropId) && <p className="sr-only">{t("irrigation.err.crop")}</p>}
    </Screen>
  );
}

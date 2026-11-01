import React, { useState } from "react";
import { useT } from "../../../i18n";
import { STAGES, cropById, cropName, stageFor, stageStartDay } from "../cropEngine";
import { enqueue } from "../../../shared/offline-sync/SyncQueue";
import { isFirebaseConfigured } from "../../../lib/firebase";
import { formatDateTime } from "../../../lib/format";
import { useAppStore } from "../../../app/store";
import { navigate } from "../../../app/router";
import { Screen } from "../../../shared/ui/Screen";
import { Card } from "../../../shared/ui/Card";
import { Button } from "../../../shared/ui/Button";
import { EmptyState, Notice } from "../../../shared/ui/Feedback";
import { toast } from "../../../shared/ui/Toast";

export const DAY_MS = 86_400_000;

export function daysSince(plantedAt: number, now = Date.now()): number {
  return Math.max(0, Math.floor((now - plantedAt) / DAY_MS));
}

export function MyCrop() {
  const { t, lang } = useT();
  const active = useAppStore((s) => s.activeCrop);
  const setActiveCrop = useAppStore((s) => s.setActiveCrop);
  const [reported, setReported] = useState<"on_track" | "lagging" | null>(null);
  const crop = active ? cropById(active.cropId) : undefined;

  if (!active || !crop) {
    return (
      <Screen title={t("farm.title")}>
        <EmptyState
          icon="🌱"
          title={t("farm.noCrop")}
          body={t("farm.noCropBody")}
          action={<Button onClick={() => navigate({ name: "crops", soil: null })}>{t("home.crops")}</Button>}
        />
      </Screen>
    );
  }

  const days = daysSince(active.plantedAt);
  const { stage, index, done } = stageFor(crop, days);
  const name = cropName(crop, lang);

  async function report(status: "on_track" | "lagging") {
    setReported(status);
    if (!isFirebaseConfigured || !crop) return;
    try {
      await enqueue("growthUpdates", { cropId: crop.id, daysSincePlanting: Math.min(days, 400), status, timestamp: Date.now() });
      toast.success(t("farm.reportQueued"));
    } catch (err) {
      console.warn("[farm] could not queue growth update", err);
      toast.error(t("farm.reportFailed"));
    }
  }

  return (
    <Screen title={name} subtitle={t("farm.title")} speakText={`${name}. ${stage[lang]}`}>
      <Card>
        <p className="text-sm text-soil-600">{t("farm.plantedOn", { date: formatDateTime(active.plantedAt, lang) })}</p>
        <p className="font-display font-bold text-xl mt-1">{done ? t("farm.harvestDue") : t("farm.dayOf", { day: days, total: crop.durationDays })}</p>
        <p className="text-leaf-800 font-semibold">{stage[lang]}</p>
        <div className="h-2 rounded-full bg-soil-100 overflow-hidden mt-3" aria-hidden="true">
          <div className="h-full bg-leaf-600" style={{ width: `${Math.min(100, (days / crop.durationDays) * 100)}%` }} />
        </div>
      </Card>

      <Card title={t("farm.checkIn")}>
        <p className="text-sm text-soil-700 mb-3">{t("farm.checkInQuestion", { stage: stage[lang] })}</p>
        <div className="grid grid-cols-2 gap-2">
          <Button onClick={() => void report("on_track")} variant={reported === "on_track" ? "primary" : "secondary"}>
            {t("farm.onTrack")}
          </Button>
          <Button onClick={() => void report("lagging")} variant={reported === "lagging" ? "primary" : "secondary"}>
            {t("farm.lagging")}
          </Button>
        </div>
        {reported === "lagging" && (
          <div className="mt-3">
            <Notice tone="info" action={<Button size="sm" variant="secondary" onClick={() => navigate({ name: "disease" })}>{t("home.diseaseScan")}</Button>}>
              {t("farm.laggingAdvice")}
            </Notice>
          </div>
        )}
      </Card>

      <Card title={t("farm.timeline")}>
        <ol className="border-l-2 border-leaf-600 pl-4 flex flex-col gap-2">
          {STAGES.map((s, i) => (
            <li key={s.id} className={i <= index ? "text-leaf-800 font-semibold" : "text-soil-500"} aria-current={i === index ? "step" : undefined}>
              {t("farm.dayN", { day: stageStartDay(crop, s) })} — {s[lang]}
            </li>
          ))}
          <li className={done ? "text-leaf-800 font-semibold" : "text-soil-500"}>
            {t("farm.dayN", { day: crop.durationDays })} — {t("farm.harvest")}
          </li>
        </ol>
        <p className="text-xs text-soil-500 mt-3">{t("farm.stageNote")}</p>
      </Card>

      <Button
        variant="ghost"
        onClick={() => {
          setActiveCrop(null);
          navigate({ name: "crops", soil: null });
        }}
      >
        {t("farm.endCrop")}
      </Button>
    </Screen>
  );
}

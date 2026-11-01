import React, { useEffect, useState } from "react";
import { useT } from "../../../i18n";
import { classifier, type ClassifyOutcome, type ModelStatus } from "../../../lib/inference/classifier";
import { HEALTHY_DISEASE_IDS, TAXONOMY, taxonName, type ModelTask } from "../../../domain/taxonomy";
import { isFirebaseConfigured, toGeoTile } from "../../../lib/firebase";
import { enqueue } from "../../../shared/offline-sync/SyncQueue";
import { Screen } from "../../../shared/ui/Screen";
import { Card } from "../../../shared/ui/Card";
import { Button } from "../../../shared/ui/Button";
import { Badge, Notice, Spinner } from "../../../shared/ui/Feedback";
import { ImageCapture, type CapturedImage } from "../../../shared/ui/ImageCapture";
import { navigate } from "../../../app/router";
import { useAppStore } from "../../../app/store";
import { percent } from "../../../lib/format";
import type { ModelMetadata } from "../../../lib/inference/metadata";

function ModelInfo({ meta }: { meta: ModelMetadata }) {
  const { t } = useT();
  return (
    <div className="text-xs text-soil-600 flex flex-col gap-0.5">
      <p>{t("model.version", { version: meta.modelVersion })}</p>
      {meta.training && <p>{t("model.trainedOn", { platform: meta.training.platform, dataset: meta.training.dataset })}</p>}
      {meta.evaluation && (
        <p>{t("model.testAccuracy", { acc: Math.round(meta.evaluation.testAccuracy * 1000) / 10, n: meta.evaluation.testSamples })}</p>
      )}
      <p>{t("model.scoreNote")}</p>
    </div>
  );
}

function ResultCard({ task, outcome }: { task: ModelTask; outcome: Extract<ClassifyOutcome, { status: "ok" }> }) {
  const { t, lang } = useT();
  const best = outcome.top[0];
  const healthy = task === "disease" && HEALTHY_DISEASE_IDS.has(best.labelId);
  return (
    <Card title={t("scan.resultTitle")}>
      <div className="flex flex-col gap-3">
        {!outcome.confident && <Notice tone="warning">{t("scan.lowConfidence")}</Notice>}
        <p className="font-display font-bold text-xl text-soil-900">
          {task === "soil"
            ? t("soilScan.result", { soilType: taxonName("soil", best.labelId, lang) })
            : healthy
              ? t("diseaseScan.healthy")
              : t("diseaseScan.result", { condition: taxonName("disease", best.labelId, lang) })}
        </p>
        <div>
          <p className="text-sm font-semibold text-soil-700 mb-2">{t("scan.topResults")}</p>
          <ol className="flex flex-col gap-2">
            {outcome.top.map((p) => (
              <li key={p.labelId} className="flex flex-col gap-1">
                <div className="flex justify-between text-sm">
                  <span>{taxonName(task, p.labelId, lang)}</span>
                  <span className="font-mono text-soil-600">{percent(p.score)}</span>
                </div>
                <div className="h-2 rounded-full bg-soil-100 overflow-hidden" aria-hidden="true">
                  <div className="h-full bg-leaf-600" style={{ width: `${Math.max(2, p.score * 100)}%` }} />
                </div>
              </li>
            ))}
          </ol>
        </div>
        <ModelInfo meta={outcome.metadata} />
        {task === "soil" ? (
          <Button onClick={() => navigate({ name: "crops", soil: best.labelId })} block>
            {t("soilScan.seeCrops")}
          </Button>
        ) : (
          <Button onClick={() => navigate({ name: "guidance", id: best.labelId })} block>
            {t("diseaseScan.seeGuidance")}
          </Button>
        )}
      </div>
    </Card>
  );
}

function ManualPicker({ task }: { task: ModelTask }) {
  const { t, lang } = useT();
  const setLastSoil = useAppStore((s) => s.setLastSoil);
  return (
    <Card title={task === "soil" ? t("soilScan.manualTitle") : t("diseaseScan.manualTitle")}>
      <div className="grid grid-cols-1 xs:grid-cols-2 gap-2">
        {TAXONOMY[task].map((entry) => (
          <Button
            key={entry.id}
            variant="secondary"
            onClick={() => {
              if (task === "soil") {
                setLastSoil(entry.id);
                navigate({ name: "crops", soil: entry.id });
              } else {
                navigate({ name: "guidance", id: entry.id });
              }
            }}
            className="justify-start text-left"
          >
            {taxonName(task, entry.id, lang)}
          </Button>
        ))}
      </div>
      {task === "soil" && <p className="text-xs text-soil-500 mt-3">{t("soilScan.manualHint")}</p>}
    </Card>
  );
}

export function ScanScreen({ task }: { task: ModelTask }) {
  const { t } = useT();
  const [status, setStatus] = useState<ModelStatus | null>(null);
  const [outcome, setOutcome] = useState<ClassifyOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const location = useAppStore((s) => s.location);
  const addScan = useAppStore((s) => s.addScan);
  const setLastSoil = useAppStore((s) => s.setLastSoil);

  useEffect(() => {
    let alive = true;
    setStatus(null);
    setOutcome(null);
    classifier.status(task).then((s) => alive && setStatus(s));
    return () => {
      alive = false;
    };
  }, [task]);

  async function analyse(img: CapturedImage) {
    setBusy(true);
    setOutcome(null);
    try {
      const result = await classifier.classify(task, img.canvas, 3);
      setOutcome(result);
      if (result.status !== "ok") return;
      const best = result.top[0];
      addScan({ task, labelId: best.labelId, score: best.score, modelVersion: result.metadata.modelVersion, at: Date.now() });
      if (task === "soil" && result.confident) {
        setLastSoil(best.labelId);
        // Only confident predictions from a validated model, at ~1 km
        // precision, are shared with the community map.
        if (isFirebaseConfigured && location?.coords) {
          await enqueue("soilScans", {
            geoTile: toGeoTile(location.coords.lat, location.coords.lng),
            soilType: best.labelId,
            confidence: Math.round(best.score * 1000) / 1000,
            modelVersion: result.metadata.modelVersion,
            timestamp: Date.now(),
          });
        }
      }
    } catch (err) {
      setOutcome({ status: "error", reason: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  const title = task === "soil" ? t("soilScan.title") : t("diseaseScan.title");

  return (
    <Screen
      title={title}
      speakText={`${title}. ${task === "soil" ? t("soilScan.instruction") : t("diseaseScan.instruction")}`}
      actions={
        <Button variant="ghost" size="sm" onClick={() => navigate({ name: task === "soil" ? "disease" : "soil" })}>
          {task === "soil" ? t("diseaseScan.title") : t("soilScan.title")}
        </Button>
      }
    >
      {task === "disease" && <Notice tone="info">{t("diseaseScan.scope")}</Notice>}

      {status === null && <Spinner label={t("model.checking")} />}

      {status?.state === "awaiting_training" && (
        <Card>
          <div className="flex flex-col gap-2">
            <Badge tone="warning">{t("model.awaiting")}</Badge>
            <p className="text-sm text-soil-700">{t("model.awaitingBody")}</p>
          </div>
        </Card>
      )}

      {status?.state === "error" && (
        <Notice tone="error" title={t("model.error")}>
          <span className="font-mono text-xs break-all">{status.reason}</span>
        </Notice>
      )}

      {status?.state === "ready" && (
        <Card>
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Badge tone="live">{t("model.ready")}</Badge>
              <span className="text-xs text-soil-500">{status.metadata.modelVersion}</span>
            </div>
            <ImageCapture
              instruction={task === "soil" ? t("soilScan.instruction") : t("diseaseScan.instruction")}
              onImage={analyse}
              onClear={() => setOutcome(null)}
              busy={busy}
            />
          </div>
        </Card>
      )}

      {outcome?.status === "ok" && <ResultCard task={task} outcome={outcome} />}
      {outcome?.status === "error" && (
        <Notice tone="error" title={t("model.error")}>
          <span className="font-mono text-xs break-all">{outcome.reason}</span>
        </Notice>
      )}

      {task === "soil" && status?.state === "ready" && !location?.coords && (
        <p className="text-xs text-soil-500">{t("soilScan.noGpsNoShare")}</p>
      )}

      {status !== null && <ManualPicker task={task} />}
    </Screen>
  );
}

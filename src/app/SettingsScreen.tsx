import React, { useEffect, useState } from "react";
import { useLangStore, useT, type Lang } from "../i18n";
import { classifier, type ModelStatus } from "../lib/inference/classifier";
import type { ModelTask } from "../domain/taxonomy";
import { clearQueue } from "../shared/offline-sync/SyncQueue";
import { relativeTime } from "../lib/format";
import { Screen } from "../shared/ui/Screen";
import { Card } from "../shared/ui/Card";
import { Button } from "../shared/ui/Button";
import { Badge, Notice } from "../shared/ui/Feedback";
import { Segmented } from "../shared/ui/Field";
import { Dialog } from "../shared/ui/Dialog";
import { toast } from "../shared/ui/Toast";
import { LocationSetup } from "./LocationSetup";
import { useAppStore } from "./store";
import { useSyncStatus } from "./useSync";

function ModelRow({ task }: { task: ModelTask }) {
  const { t } = useT();
  const [status, setStatus] = useState<ModelStatus | null>(null);
  useEffect(() => {
    let alive = true;
    classifier.status(task).then((s) => alive && setStatus(s));
    return () => {
      alive = false;
    };
  }, [task]);
  return (
    <li className="flex items-center justify-between gap-2 py-2">
      <span>{task === "soil" ? t("soilScan.title") : t("diseaseScan.title")}</span>
      {status === null && <span className="text-xs">{t("model.checking")}</span>}
      {status?.state === "ready" && <Badge tone="live">{status.metadata.modelVersion}</Badge>}
      {status?.state === "awaiting_training" && <Badge tone="warning">{t("model.awaiting")}</Badge>}
      {status?.state === "error" && <Badge tone="unavailable">{t("model.error")}</Badge>}
    </li>
  );
}

export function SettingsScreen() {
  const { t, lang } = useT();
  const setLang = useLangStore((s) => s.setLang);
  const { stats, syncing, lastSync, online, configured, syncNow } = useSyncStatus();
  const clearScans = useAppStore((s) => s.clearScans);
  const setActiveCrop = useAppStore((s) => s.setActiveCrop);
  const [confirmClear, setConfirmClear] = useState(false);

  async function doSync() {
    const r = await syncNow();
    if (!r) return;
    if (r.failed > 0) toast.error(t("sync.someFailed", { count: r.failed }));
    else toast.success(t("sync.done", { count: r.synced }));
  }

  return (
    <Screen title={t("settings.title")}>
      <Card title={t("settings.language")}>
        <Segmented<Lang>
          label={t("settings.language")}
          value={lang}
          onChange={setLang}
          options={[
            { value: "ta", label: "தமிழ்" },
            { value: "en", label: "English" },
          ]}
        />
      </Card>

      <Card title={t("settings.location")}>
        <p className="text-sm text-soil-600 mb-3">{t("settings.locationPrivacy")}</p>
        <LocationSetup compact onDone={() => toast.success(t("settings.locationSaved"))} />
      </Card>

      <Card title={t("sync.title")}>
        <div className="flex flex-col gap-3 text-sm">
          {!configured && <Notice tone="info">{t("sync.notConfigured")}</Notice>}
          {!online && <Notice tone="warning">{t("sync.offlineShort")}</Notice>}
          <p>
            {t("sync.pendingShort", { count: stats.total })}
            {stats.failing > 0 && ` · ${t("sync.failedShort", { count: stats.failing })}`}
          </p>
          <p className="text-soil-600">
            {lastSync ? t("sync.lastSyncDetail", { time: relativeTime(lastSync.at, lang), synced: lastSync.synced, failed: lastSync.failed }) : t("sync.never")}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void doSync()} disabled={!configured || !online || syncing || stats.total === 0}>
              {syncing ? t("sync.syncing") : t("sync.now")}
            </Button>
            <Button variant="danger" onClick={() => setConfirmClear(true)} disabled={stats.total === 0}>
              {t("sync.clear")}
            </Button>
          </div>
        </div>
      </Card>

      <Card title={t("settings.models")}>
        <ul className="divide-y divide-soil-100 text-sm">
          <ModelRow task="soil" />
          <ModelRow task="disease" />
        </ul>
        <p className="text-xs text-soil-500 mt-2">{t("model.scoreNote")}</p>
      </Card>

      <Card title={t("settings.data")}>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => { clearScans(); toast.info(t("settings.scansCleared")); }}>
            {t("settings.clearScans")}
          </Button>
          <Button variant="secondary" onClick={() => { setActiveCrop(null); toast.info(t("settings.cropCleared")); }}>
            {t("settings.clearCrop")}
          </Button>
        </div>
      </Card>

      <Card title={t("settings.about")}>
        <div className="flex flex-col gap-2 text-sm text-soil-700">
          <p>{t("settings.aboutBody")}</p>
          <p className="text-xs text-soil-500">{t("settings.disclaimer")}</p>
          <p className="text-xs text-soil-500">v{__APP_VERSION__}</p>
        </div>
      </Card>

      <Dialog open={confirmClear} onClose={() => setConfirmClear(false)} title={t("sync.clear")}>
        <p className="text-sm mb-3">{t("sync.clearConfirm", { count: stats.total })}</p>
        <div className="flex gap-2 justify-end">
          <Button variant="secondary" onClick={() => setConfirmClear(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="danger"
            onClick={async () => {
              await clearQueue();
              setConfirmClear(false);
              toast.info(t("sync.cleared"));
            }}
          >
            {t("sync.clear")}
          </Button>
        </div>
      </Dialog>
    </Screen>
  );
}

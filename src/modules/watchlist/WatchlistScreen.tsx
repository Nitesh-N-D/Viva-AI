import React, { useEffect, useState } from "react";
import { useT } from "../../i18n";
import { DEFAULT_STATE, MANDI_COMMODITIES, MANDI_STATES, TN_MANDI_DISTRICTS, districtToApi, mandiDistrictName, mandiStateName } from "../../domain/mandiPlaces";
import { deleteWatch, listAlerts, listObservations, listWatch, markAlertsSeen, putWatch, useDbQuery } from "../../lib/farmRepo";
import { newId, type PriceObservation, type WatchAlert, type WatchItem } from "../../lib/localDb";
import { AppError } from "../../lib/errors";
import { formatDateTime, formatInr, formatIsoDate, relativeTime } from "../../lib/format";
import { useAppStore } from "../../app/store";
import { useOnline } from "../../app/useSync";
import { latestByMarket, validateWatch } from "./watchlistLogic";
import { checkStale, checkWatch } from "./watchService";
import { navigate } from "../../app/router";
import { Screen } from "../../shared/ui/Screen";
import { Card } from "../../shared/ui/Card";
import { Button } from "../../shared/ui/Button";
import { Dialog } from "../../shared/ui/Dialog";
import { Badge, EmptyState, Notice, Skeleton } from "../../shared/ui/Feedback";
import { InputField, SelectField } from "../../shared/ui/Field";
import { ErrorNotice } from "../../shared/ui/ErrorNotice";
import { toast } from "../../shared/ui/Toast";
import { showAppNotification } from "../../shared/notify/notify";

/** The mandi screen can pre-fill a new watch through sessionStorage. */
export const WATCH_PREFILL_KEY = "viva-ai:watch-prefill";

function readPrefill(): Partial<WatchItem> | null {
  try {
    const raw = sessionStorage.getItem(WATCH_PREFILL_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(WATCH_PREFILL_KEY);
    const v = JSON.parse(raw) as Partial<WatchItem>;
    return typeof v === "object" && v ? { state: String(v.state ?? ""), district: String(v.district ?? ""), commodity: String(v.commodity ?? ""), market: String(v.market ?? "") } : null;
  } catch {
    return null;
  }
}

const optNum = (s: string) => (s.trim() === "" ? undefined : Number(s));

function WatchForm({ initial, onDone }: { initial: Partial<WatchItem> | null; onDone: () => void }) {
  const { t, lang } = useT();
  const savedDistrict = useAppStore((s) => s.location?.district ?? null);
  const [state, setState] = useState(initial?.state || DEFAULT_STATE);
  const [district, setDistrict] = useState(initial?.district ?? (savedDistrict ? districtToApi(savedDistrict) : ""));
  const [commodity, setCommodity] = useState(initial?.commodity || MANDI_COMMODITIES[0].api);
  const [market, setMarket] = useState(initial?.market ?? "");
  const [above, setAbove] = useState("");
  const [below, setBelow] = useState("");
  const [change, setChange] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [saveError, setSaveError] = useState<unknown>(null);
  const err = (k: string) => (errors.includes(k) ? t(`watchlist.err.${k}`) : null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const w: WatchItem = {
      id: newId("watch"),
      state,
      district: state === "Tamil Nadu" ? district : "",
      market: market.trim(),
      commodity,
      targetAbove: optNum(above),
      targetBelow: optNum(below),
      changePct: optNum(change),
      createdAt: Date.now(),
    };
    const errs = validateWatch(w);
    setErrors(errs);
    if (errs.length) return;
    try {
      await putWatch(w);
      toast.success(t("watchlist.saved"));
      onDone();
      // First check right away so the farmer sees real numbers (uses the mandi cache when fresh).
      void checkWatch(w).catch(() => undefined);
    } catch {
      setSaveError(new AppError("storage"));
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
      <SelectField
        label={t("mandi.state")}
        value={state}
        onChange={(e) => {
          setState(e.target.value);
          if (e.target.value !== "Tamil Nadu") setDistrict("");
        }}
        options={MANDI_STATES.map((s) => ({ value: s.api, label: lang === "ta" ? s.ta : s.en }))}
        error={err("state")}
      />
      {state === "Tamil Nadu" && (
        <SelectField
          label={t("mandi.district")}
          value={district}
          onChange={(e) => setDistrict(e.target.value)}
          placeholder={t("mandi.allDistricts")}
          options={TN_MANDI_DISTRICTS.map((d) => ({ value: d.api, label: lang === "ta" ? d.ta : d.en }))}
        />
      )}
      <SelectField
        label={t("mandi.commodity")}
        value={commodity}
        onChange={(e) => setCommodity(e.target.value)}
        options={MANDI_COMMODITIES.map((c) => ({ value: c.api, label: lang === "ta" ? c.ta : c.en }))}
        error={err("commodity")}
      />
      <InputField label={t("watchlist.market")} value={market} maxLength={80} onChange={(e) => setMarket(e.target.value)} placeholder={t("mandi.allMarkets")} hint={t("watchlist.marketHint")} />
      <fieldset className="flex flex-col gap-2 border border-soil-100 rounded-tile p-3">
        <legend className="text-sm font-semibold text-soil-700 px-1">{t("watchlist.rules")}</legend>
        <InputField label={t("watchlist.above")} type="number" inputMode="decimal" min="0" value={above} onChange={(e) => setAbove(e.target.value)} suffix={t("watchlist.perQuintal")} error={err("targetAbove") ?? err("range")} />
        <InputField label={t("watchlist.below")} type="number" inputMode="decimal" min="0" value={below} onChange={(e) => setBelow(e.target.value)} suffix={t("watchlist.perQuintal")} error={err("targetBelow")} />
        <InputField label={t("watchlist.change")} type="number" inputMode="decimal" min="0" value={change} onChange={(e) => setChange(e.target.value)} suffix="%" error={err("changePct")} />
        {errors.includes("noRule") && <p className="text-xs text-danger-600">{t("watchlist.err.noRule")}</p>}
      </fieldset>
      {saveError !== null && <ErrorNotice error={saveError} />}
      <Button type="submit" block>
        {t("watchlist.save")}
      </Button>
    </form>
  );
}

function WatchCard({ w, alerts, onCheck, checking }: { w: WatchItem; alerts: WatchAlert[]; onCheck: () => void; checking: boolean }) {
  const { t, lang } = useT();
  const obs = useDbQuery(() => listObservations(w.id), ["observations"], [] as PriceObservation[]);
  const latest = latestByMarket(obs.data).slice(0, 5);
  const commodity = MANDI_COMMODITIES.find((c) => c.api === w.commodity);
  const place = w.district ? mandiDistrictName(w.district, w.state, lang) : mandiStateName(w.state, lang);
  const rules = [
    w.targetAbove !== undefined ? t("watchlist.ruleAbove", { price: formatInr(w.targetAbove, lang) }) : null,
    w.targetBelow !== undefined ? t("watchlist.ruleBelow", { price: formatInr(w.targetBelow, lang) }) : null,
    w.changePct !== undefined ? t("watchlist.ruleChange", { pct: w.changePct }) : null,
  ].filter(Boolean);

  return (
    <Card
      title={`${commodity ? (lang === "ta" ? commodity.ta : commodity.en) : w.commodity} · ${w.market || place}`}
      action={
        <div className="flex gap-1">
          <Button size="sm" variant="secondary" onClick={onCheck} disabled={checking}>
            {checking ? t("watchlist.checking") : t("watchlist.checkNow")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label={t("watchlist.delete")}
            onClick={async () => {
              if (!window.confirm(t("watchlist.confirmDelete"))) return;
              await deleteWatch(w.id).catch(() => toast.error(t("errors.storage")));
            }}
          >
            🗑
          </Button>
        </div>
      }
    >
      <p className="text-xs text-soil-600">
        {place} · {rules.join(" · ")}
      </p>
      <p className="text-xs text-soil-500 mt-1">
        {w.lastCheckedAt ? t("watchlist.lastChecked", { time: relativeTime(w.lastCheckedAt, lang) }) : t("watchlist.neverChecked")}
        {w.lastStatus === "unavailable" ? ` · ${t("watchlist.statusUnavailable")}` : w.lastStatus === "no_records" ? ` · ${t("watchlist.statusNoRecords")}` : ""}
      </p>
      {alerts.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1">
          {alerts.slice(0, 3).map((a) => (
            <li key={a.id} className={`text-sm rounded-tile px-2 py-1 ${a.seen ? "bg-soil-50" : "bg-ember-50 font-semibold"}`}>
              🔔 {t(`watchlist.alert.${a.kind}`, { market: a.market, price: formatInr(a.modal, lang), threshold: a.kind === "change" ? `${a.threshold}%` : formatInr(a.threshold, lang), prev: a.previous !== undefined ? formatInr(a.previous, lang) : "" })}{" "}
              <span className="text-[11px] font-normal text-soil-500">({formatIsoDate(a.arrivalDate, lang)})</span>
            </li>
          ))}
        </ul>
      )}
      {latest.length > 0 ? (
        <table className="w-full text-sm mt-3">
          <thead>
            <tr className="text-left text-xs text-soil-600 border-b border-soil-100">
              <th className="py-1 font-semibold">{t("mandi.market")}</th>
              <th className="py-1 font-semibold">{t("watchlist.modal")}</th>
              <th className="py-1 font-semibold">{t("watchlist.arrival")}</th>
            </tr>
          </thead>
          <tbody>
            {latest.map((o) => (
              <tr key={o.id} className="border-b border-soil-50">
                <td className="py-1">{o.market}</td>
                <td className="py-1 font-semibold">{formatInr(o.modal, lang)}</td>
                <td className="py-1 text-xs">{formatIsoDate(o.arrivalDate, lang)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        !obs.loading && <p className="text-sm text-soil-600 mt-2">{t("watchlist.noObservations")}</p>
      )}
      {latest.length > 0 && <p className="text-[11px] text-soil-500 mt-1">{t("watchlist.fetchedNote", { time: formatDateTime(Math.max(...latest.map((o) => o.fetchedAt)), lang) })}</p>}
    </Card>
  );
}

export function WatchlistScreen() {
  const { t } = useT();
  const online = useOnline();
  const watch = useDbQuery(listWatch, ["watchlist"], [] as WatchItem[]);
  const alerts = useDbQuery(listAlerts, ["alerts"], [] as WatchAlert[]);
  const [adding, setAdding] = useState<Partial<WatchItem> | null | false>(false);
  const [checking, setChecking] = useState<Record<string, boolean>>({});
  const [checkError, setCheckError] = useState<unknown>(null);

  // Pre-fill from the mandi screen, then a single stale check on open (no polling).
  useEffect(() => {
    const pre = readPrefill();
    if (pre) setAdding(pre);
    void checkStale(online)
      .then((created) => {
        if (!created.length) return;
        const msg = t("watchlist.newAlerts", { n: created.length });
        toast.info(msg);
        void showAppNotification(msg, { tag: "viva-price-alerts", route: "#/watchlist" });
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Alerts shown on this screen count as seen once the farmer leaves it.
  useEffect(() => () => void markAlertsSeen().catch(() => undefined), []);

  const check = async (w: WatchItem) => {
    if (!online) {
      setCheckError(new AppError("offline"));
      return;
    }
    setCheckError(null);
    setChecking((c) => ({ ...c, [w.id]: true }));
    try {
      const created = await checkWatch(w, true);
      toast.info(created.length ? t("watchlist.newAlerts", { n: created.length }) : t("watchlist.noNewAlerts"));
    } catch (err) {
      setCheckError(err);
    } finally {
      setChecking((c) => ({ ...c, [w.id]: false }));
    }
  };

  const unseen = alerts.data.filter((a) => !a.seen).length;

  return (
    <Screen
      title={t("watchlist.title")}
      subtitle={t("watchlist.subtitle")}
      onBack={() => navigate({ name: "market" })}
      actions={
        <Button size="sm" onClick={() => setAdding(null)} icon="+">
          {t("watchlist.add")}
        </Button>
      }
    >
      <Notice tone="info">{t("watchlist.howItWorks")}</Notice>
      {!online && <Notice tone="warning">{t("errors.offline")}</Notice>}
      {checkError !== null && <ErrorNotice error={checkError} />}
      {Boolean(watch.error || alerts.error) && <ErrorNotice error={watch.error ?? alerts.error} onRetry={() => void watch.reload()} />}
      {unseen > 0 && (
        <p className="text-sm font-semibold text-ember-600" aria-live="polite">
          <Badge tone="warning">{unseen}</Badge> {t("watchlist.unseen", { n: unseen })}
        </p>
      )}

      {watch.loading ? (
        <Skeleton className="h-32" />
      ) : watch.data.length === 0 ? (
        <EmptyState icon="🔔" title={t("watchlist.emptyTitle")} body={t("watchlist.emptyBody")} action={<Button onClick={() => setAdding(null)}>{t("watchlist.add")}</Button>} />
      ) : (
        watch.data.map((w) => <WatchCard key={w.id} w={w} alerts={alerts.data.filter((a) => a.watchId === w.id)} onCheck={() => void check(w)} checking={Boolean(checking[w.id])} />)
      )}

      <Dialog open={adding !== false} onClose={() => setAdding(false)} title={t("watchlist.add")}>
        {adding !== false && <WatchForm initial={adding} onDone={() => setAdding(false)} />}
      </Dialog>
    </Screen>
  );
}

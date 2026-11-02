import React, { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "../../../i18n";
import {
  STALE_ARRIVAL_DAYS,
  arrivalAgeDays,
  dateOptions,
  filterMandiRecords,
  getMandiPrices,
  marketOptions,
  paginate,
  recordKey,
  sortMandiRecords,
  summariseMandi,
  type MandiResult,
  type MandiSortKey,
} from "../../../lib/mandi";
import {
  DEFAULT_COMMODITY,
  DEFAULT_STATE,
  MANDI_COMMODITIES,
  MANDI_STATES,
  TN_MANDI_DISTRICTS,
  districtToApi,
  mandiDistrictName,
  mandiStateName,
} from "../../../domain/mandiPlaces";
import { formatDateTime, formatInr, formatIsoDate, relativeTime } from "../../../lib/format";
import { useAppStore } from "../../../app/store";
import { Screen } from "../../../shared/ui/Screen";
import { Card, Stat } from "../../../shared/ui/Card";
import { Button } from "../../../shared/ui/Button";
import { Badge, EmptyState, Notice, Skeleton, SourceBadge } from "../../../shared/ui/Feedback";
import { InputField, SelectField } from "../../../shared/ui/Field";

const DEFAULT_DISTRICT = "Villupuram";
const SORT_KEYS: readonly MandiSortKey[] = ["date", "high", "low", "market"];

export function MandiPrices() {
  const { t, lang } = useT();
  const savedDistrict = useAppStore((s) => s.location?.district ?? null);

  // Query filters: changing these fetches (or reads the cache).
  const [state, setState] = useState(DEFAULT_STATE);
  const [district, setDistrict] = useState(savedDistrict ? districtToApi(savedDistrict) : DEFAULT_DISTRICT);
  const [commodityId, setCommodityId] = useState(DEFAULT_COMMODITY);
  // Local filters: applied to the loaded records, never fetch.
  const [market, setMarket] = useState("");
  const [date, setDate] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<MandiSortKey>("date");
  const [page, setPage] = useState(1);

  const [result, setResult] = useState<MandiResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<{ n: number; total: number } | null>(null);
  // Districts seen in an all-districts result, per state (for states without a built-in list).
  const [seenDistricts, setSeenDistricts] = useState<Record<string, string[]>>({});
  const requestId = useRef(0);

  const commodity = MANDI_COMMODITIES.find((c) => c.id === commodityId) ?? MANDI_COMMODITIES[0];
  const crop = lang === "ta" ? commodity.ta : commodity.en;

  const districtChoices = useMemo(() => {
    if (state === "Tamil Nadu") return TN_MANDI_DISTRICTS.map((d) => ({ value: d.api, label: lang === "ta" ? d.ta : d.en }));
    return (seenDistricts[state] ?? []).map((d) => ({ value: d, label: d }));
  }, [state, seenDistricts, lang]);

  const load = async (force: boolean) => {
    const id = ++requestId.current;
    setLoading(true);
    setProgress(null);
    try {
      const r = await getMandiPrices(
        { state, commodity: commodity.api, district: district || undefined },
        { force, onProgress: (n, total) => id === requestId.current && setProgress({ n, total }) }
      );
      if (id !== requestId.current) return; // a newer query superseded this one
      setResult(r);
      if (!district && r.records.length > 0) {
        const ds = [...new Set(r.records.map((x) => x.district))].sort();
        setSeenDistricts((prev) => ({ ...prev, [state]: [...new Set([...(prev[state] ?? []), ...ds])].sort() }));
      }
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  };

  // Refetch only when the query (state, district, commodity) changes.
  useEffect(() => {
    setResult(null);
    setMarket("");
    setDate("");
    void load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, district, commodity.api]);

  const onStateChange = (next: string) => {
    setState(next);
    // A district only makes sense inside its state.
    const valid = next === "Tamil Nadu" ? TN_MANDI_DISTRICTS.some((d) => d.api === district) : (seenDistricts[next] ?? []).includes(district);
    if (!valid) setDistrict("");
  };

  const clearFilters = () => {
    setDistrict("");
    setMarket("");
    setDate("");
    setSearch("");
    setSort("date");
  };

  const records = result?.records ?? [];
  const markets = useMemo(() => marketOptions(records), [records]);
  const dates = useMemo(() => dateOptions(records), [records]);
  const rows = useMemo(() => sortMandiRecords(filterMandiRecords(records, { market, date, search }), sort), [records, market, date, search, sort]);
  const summary = summariseMandi(rows);
  const view = paginate(rows, page);
  // Any change to the result set or its filters starts again at page 1.
  useEffect(() => setPage(1), [result, market, date, search, sort]);
  const latestAge = summary ? arrivalAgeDays(summary.latestDate) : null;
  const place = district ? mandiDistrictName(district, state, lang) : mandiStateName(state, lang);
  const localFiltered = market !== "" || date !== "" || search.trim() !== "";

  return (
    <Screen
      title={t("mandi.title")}
      subtitle={t("mandi.subtitle")}
      wide
      actions={
        <Button variant="secondary" size="sm" onClick={() => void load(true)} disabled={loading} icon="↻">
          {loading && result ? t("mandi.refreshing") : t("mandi.refresh")}
        </Button>
      }
    >
      <Card>
        <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" onSubmit={(e) => e.preventDefault()} aria-label={t("mandi.title")}>
          <SelectField
            label={t("mandi.state")}
            value={state}
            onChange={(e) => onStateChange(e.target.value)}
            options={MANDI_STATES.map((s) => ({ value: s.api, label: lang === "ta" ? s.ta : s.en }))}
          />
          <SelectField
            label={t("mandi.district")}
            value={district}
            onChange={(e) => setDistrict(e.target.value)}
            placeholder={t("mandi.allDistricts")}
            options={districtChoices}
          />
          <SelectField
            label={t("mandi.commodity")}
            value={commodityId}
            onChange={(e) => setCommodityId(e.target.value)}
            options={MANDI_COMMODITIES.map((c) => ({ value: c.id, label: lang === "ta" ? c.ta : c.en }))}
          />
          <SelectField
            label={t("mandi.market")}
            value={market}
            onChange={(e) => setMarket(e.target.value)}
            placeholder={t("mandi.allMarkets")}
            options={markets.map((m) => ({ value: m, label: m }))}
            disabled={markets.length === 0}
          />
          <SelectField
            label={t("mandi.date")}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            placeholder={t("mandi.allDates")}
            options={dates.map((d) => ({ value: d, label: formatIsoDate(d, lang) }))}
            disabled={dates.length < 2}
          />
          <InputField
            label={t("mandi.search")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("mandi.searchPlaceholder")}
            type="search"
          />
          <SelectField
            label={t("mandi.sortBy")}
            value={sort}
            onChange={(e) => setSort(e.target.value as MandiSortKey)}
            options={SORT_KEYS.map((k) => ({ value: k, label: t(`mandi.sort.${k}`) }))}
          />
          <div className="flex items-end">
            <Button type="button" variant="secondary" block onClick={clearFilters}>
              {t("mandi.clear")}
            </Button>
          </div>
        </form>
      </Card>

      {result && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-soil-600" aria-live="polite">
          <SourceBadge source={result.status} />
          {result.status === "live" && result.fetchedAt && <span>{t("mandi.liveNote", { time: relativeTime(result.fetchedAt, lang) })}</span>}
          {result.status === "cached" && result.fetchedAt && (
            <span>{t(result.failure ? "mandi.cachedFailNote" : "mandi.cachedNote", { time: relativeTime(result.fetchedAt, lang) })}</span>
          )}
          {result.sourceUpdated && <span>· {t("mandi.sourceUpdated", { time: formatDateTime(Date.parse(result.sourceUpdated), lang) })}</span>}
          {result.total > 0 && <span>· {t("mandi.records", { shown: rows.length, total: result.total })}</span>}
        </div>
      )}

      {loading && !result && (
        <div className="flex flex-col gap-2" aria-busy="true" role="status">
          <p className="text-sm text-soil-600">
            {progress ? t("mandi.loadingPages", { n: progress.n, total: progress.total }) : t("mandi.loading")}
          </p>
          <Skeleton className="h-24" />
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      )}

      {result?.failure && (
        <Notice tone={result.status === "cached" ? "warning" : "error"} title={result.status === "cached" ? undefined : t("mandi.unavailable")}>
          <span className="block">{t(`mandi.failure.${result.failure}`)}</span>
          {result.failure !== "no_proxy" && (
            <Button size="sm" variant="secondary" className="mt-2" onClick={() => void load(true)} disabled={loading}>
              {t("mandi.retry")}
            </Button>
          )}
        </Notice>
      )}

      {result?.truncated && <Notice tone="warning">{t("mandi.truncated", { total: result.total, n: result.records.length })}</Notice>}

      {latestAge !== null && latestAge > STALE_ARRIVAL_DAYS && <Notice tone="warning">{t("mandi.staleData", { days: latestAge })}</Notice>}

      {summary && (
        <Card title={t("mandi.summaryTitle", { crop })}>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            <Stat label={t("mandi.highestModal")} value={formatInr(summary.highest.modalPrice, lang)} hint={summary.highest.market} />
            <Stat label={t("mandi.lowestModal")} value={formatInr(summary.lowest.modalPrice, lang)} hint={summary.lowest.market} />
            <Stat label={t("mandi.medianModal")} value={formatInr(summary.median, lang)} hint={t("mandi.unit")} />
            <Stat label={t("mandi.markets")} value={summary.markets} />
            <Stat label={t("mandi.latestArrival")} value={formatIsoDate(summary.latestDate, lang)} />
          </div>
        </Card>
      )}

      {result && result.status !== "unavailable" && records.length === 0 && (
        <EmptyState icon="📭" title={t("mandi.noRecords", { crop, place })} body={t("mandi.noRecordsHint")} />
      )}
      {records.length > 0 && rows.length === 0 && localFiltered && (
        <EmptyState icon="🔍" title={t("mandi.noMatches")} action={<Button onClick={clearFilters}>{t("mandi.clear")}</Button>} />
      )}

      {rows.length > 0 && (
        <ul className="grid gap-3 md:grid-cols-2" aria-label={t("mandi.listLabel")}>
          {view.items.map((r) => {
            const age = arrivalAgeDays(r.arrivalDate);
            return (
              <li key={recordKey(r)}>
                <Card as="article" className="h-full">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="font-display font-semibold text-base break-words">{r.market}</h2>
                      <p className="text-xs text-soil-600">
                        {mandiDistrictName(r.district, r.state, lang)}, {mandiStateName(r.state, lang)}
                      </p>
                      <p className="text-xs text-soil-600">
                        {crop} · {t("mandi.variety")}: {r.variety || "—"} · {t("mandi.grade")}: {r.grade || "—"}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-display font-bold text-xl text-leaf-800">{formatInr(r.modalPrice, lang)}</p>
                      <p className="text-[11px] text-soil-500" title={t("mandi.modalHint")}>
                        {t("mandi.modal")}
                      </p>
                    </div>
                  </div>
                  <dl className="grid grid-cols-3 gap-2 mt-3 text-xs">
                    <div>
                      <dt className="text-soil-500">{t("mandi.min")}</dt>
                      <dd className="font-semibold">{r.minPrice !== null ? formatInr(r.minPrice, lang) : "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-soil-500">{t("mandi.max")}</dt>
                      <dd className="font-semibold">{r.maxPrice !== null ? formatInr(r.maxPrice, lang) : "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-soil-500">{t("mandi.arrivalDate")}</dt>
                      <dd className="font-semibold flex flex-wrap items-center gap-1">
                        {formatIsoDate(r.arrivalDate, lang)}
                        {age !== null && age > STALE_ARRIVAL_DAYS && <Badge tone="warning">{t("mandi.old")}</Badge>}
                      </dd>
                    </div>
                  </dl>
                  <p className="mt-2 text-[11px] text-soil-500">
                    {t("mandi.unit")} · {t("mandi.source")}
                  </p>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {view.pages > 1 && (
        <nav className="flex items-center justify-between gap-3" aria-label={t("mandi.pageOf", { page: view.page, pages: view.pages })}>
          <Button variant="secondary" size="sm" onClick={() => setPage(view.page - 1)} disabled={view.page <= 1}>
            {t("mandi.prevPage")}
          </Button>
          <span className="text-sm text-soil-600" aria-live="polite">
            {t("mandi.pageOf", { page: view.page, pages: view.pages })}
          </span>
          <Button variant="secondary" size="sm" onClick={() => setPage(view.page + 1)} disabled={view.page >= view.pages}>
            {t("mandi.nextPage")}
          </Button>
        </nav>
      )}

      <p className="text-xs text-soil-500">{t("mandi.disclaimer")}</p>
    </Screen>
  );
}

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useT } from "../../../i18n";
import {
  COMMODITIES,
  STALE_ARRIVAL_DAYS,
  arrivalAgeDays,
  getMandiPrices,
  summariseMandi,
  type MandiResult,
} from "../../../lib/mandi";
import { TN_DISTRICTS, districtName } from "../../../domain/districts";
import { formatInr, formatIsoDate, relativeTime } from "../../../lib/format";
import { useAppStore } from "../../../app/store";
import { Screen } from "../../../shared/ui/Screen";
import { Card, Stat } from "../../../shared/ui/Card";
import { Button } from "../../../shared/ui/Button";
import { Badge, EmptyState, Notice, Skeleton, SourceBadge } from "../../../shared/ui/Feedback";
import { InputField, SelectField } from "../../../shared/ui/Field";

type SortKey = "date" | "high" | "low";

export function MandiPrices() {
  const { t, lang } = useT();
  const savedDistrict = useAppStore((s) => s.location?.district ?? null);
  const [commodityId, setCommodityId] = useState(COMMODITIES[0].id);
  const [district, setDistrict] = useState<string>(savedDistrict ?? "");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("date");
  const [result, setResult] = useState<MandiResult | null>(null);
  const [loading, setLoading] = useState(false);

  const commodity = COMMODITIES.find((c) => c.id === commodityId) ?? COMMODITIES[0];

  const load = useCallback(
    async (force: boolean) => {
      setLoading(true);
      try {
        setResult(await getMandiPrices(commodity, district || null, { force }));
      } finally {
        setLoading(false);
      }
    },
    [commodity, district]
  );

  useEffect(() => {
    setResult(null);
    void load(false);
  }, [load]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = (result?.records ?? []).filter(
      (r) => !q || r.market.toLowerCase().includes(q) || r.district.toLowerCase().includes(q) || r.variety.toLowerCase().includes(q)
    );
    return [...filtered].sort((a, b) =>
      sort === "high"
        ? b.modalPrice - a.modalPrice
        : sort === "low"
          ? a.modalPrice - b.modalPrice
          : b.arrivalDate.localeCompare(a.arrivalDate) || b.modalPrice - a.modalPrice
    );
  }, [result, search, sort]);

  const summary = summariseMandi(rows);
  const latestAge = summary ? arrivalAgeDays(summary.latestDate) : null;

  return (
    <Screen
      title={t("mandi.title")}
      subtitle={t("mandi.subtitle")}
      wide
      actions={
        <Button variant="secondary" size="sm" onClick={() => void load(true)} disabled={loading} icon="↻">
          {t("mandi.refresh")}
        </Button>
      }
    >
      <Card>
        <div className="grid gap-3 sm:grid-cols-3">
          <SelectField
            label={t("mandi.commodity")}
            value={commodityId}
            onChange={(e) => setCommodityId(e.target.value)}
            options={COMMODITIES.map((c) => ({ value: c.id, label: lang === "ta" ? c.ta : c.en }))}
          />
          <SelectField
            label={t("mandi.district")}
            value={district}
            onChange={(e) => setDistrict(e.target.value)}
            placeholder={t("mandi.allDistricts")}
            options={TN_DISTRICTS.map((d) => ({ value: d.en, label: districtName(d.en, lang) }))}
          />
          <InputField label={t("mandi.search")} value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("mandi.searchPlaceholder")} type="search" />
        </div>
      </Card>

      {result && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-soil-600">
          <SourceBadge source={result.status} />
          {result.fetchedAt && <span>{t("common.updated", { time: relativeTime(result.fetchedAt, lang) })}</span>}
          <span>· {t("mandi.source")}</span>
        </div>
      )}

      {loading && !result && (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-24" />
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      )}

      {result?.failure === "no_key" && <Notice tone="warning">{t("mandi.noKey")}</Notice>}
      {result && result.failure && result.failure !== "no_key" && (
        <Notice tone={result.status === "cached" ? "warning" : "error"} title={t("mandi.fetchError")}>
          {result.status === "cached" && result.fetchedAt ? t("mandi.cachedNote", { time: relativeTime(result.fetchedAt, lang) }) : t(`mandi.failure.${result.failure}`)}
        </Notice>
      )}

      {latestAge !== null && latestAge > STALE_ARRIVAL_DAYS && <Notice tone="warning">{t("mandi.staleData", { days: latestAge })}</Notice>}

      {summary && (
        <Card title={t("mandi.compareTitle", { crop: lang === "ta" ? commodity.ta : commodity.en })}>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Stat label={t("mandi.bestPrice")} value={formatInr(summary.highest.modalPrice, lang)} hint={summary.highest.market} />
            <Stat label={t("mandi.lowestPrice")} value={formatInr(summary.lowest.modalPrice, lang)} hint={summary.lowest.market} />
            <Stat label={t("mandi.median")} value={formatInr(summary.median, lang)} hint={t("mandi.perQuintal")} />
            <Stat label={t("mandi.markets")} value={summary.markets} hint={formatIsoDate(summary.latestDate, lang)} />
          </div>
        </Card>
      )}

      {result && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-soil-700">{t("mandi.sortBy")}</span>
          {(["date", "high", "low"] as const).map((k) => (
            <Button key={k} size="sm" variant={sort === k ? "primary" : "secondary"} onClick={() => setSort(k)} aria-pressed={sort === k}>
              {t(`mandi.sort.${k}`)}
            </Button>
          ))}
        </div>
      )}

      {result && rows.length === 0 && result.status !== "unavailable" && <EmptyState icon="📭" title={t("mandi.noData")} />}
      {result?.status === "unavailable" && result.failure !== "no_key" && rows.length === 0 && (
        <EmptyState icon="📡" title={t("mandi.noData")} action={<Button onClick={() => void load(true)}>{t("common.retry")}</Button>} />
      )}

      {rows.length > 0 && (
        <ul className="grid gap-3 md:grid-cols-2" aria-label={t("mandi.listLabel")}>
          {rows.map((r) => {
            const age = arrivalAgeDays(r.arrivalDate);
            return (
              <li key={`${r.market}|${r.variety}|${r.grade}|${r.arrivalDate}`}>
                <Card as="article" className="h-full">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h2 className="font-display font-semibold text-base truncate">{r.market}</h2>
                      <p className="text-xs text-soil-600 truncate">
                        {districtName(r.district, lang)}
                        {r.variety && ` · ${r.variety}`}
                        {r.grade && ` · ${r.grade}`}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-display font-bold text-xl text-leaf-800">{formatInr(r.modalPrice, lang)}</p>
                      <p className="text-[11px] text-soil-500">
                        {t("mandi.modal")} · {t("mandi.perQuintal")}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-3 text-xs text-soil-600">
                    <span>
                      {t("mandi.min")} {r.minPrice !== null ? formatInr(r.minPrice, lang) : "—"} · {t("mandi.max")}{" "}
                      {r.maxPrice !== null ? formatInr(r.maxPrice, lang) : "—"}
                    </span>
                    <span className="flex items-center gap-1">
                      {formatIsoDate(r.arrivalDate, lang)}
                      {age !== null && age > STALE_ARRIVAL_DAYS && <Badge tone="warning">{t("mandi.old")}</Badge>}
                    </span>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-xs text-soil-500">{t("mandi.liveNote")}</p>
    </Screen>
  );
}

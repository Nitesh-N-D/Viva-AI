/**
 * watchlist/watchlistLogic.ts — price watchlist evaluation.
 *
 * Observations are recorded ONLY from records the app actually received from
 * the mandi price service (live or a saved copy of a real fetch). Alerts are
 * evaluated after a fetch, in the open app or in the service worker's
 * Periodic Background Sync check (src/sw.ts) where the browser offers it.
 * There is no server push.
 */
import type { MandiRecord } from "../../lib/mandi";
import type { PriceObservation, WatchAlert, WatchItem } from "../../lib/localDb";

/** Re-check on open when the last check is older than this (and the user is online). */
export const RECHECK_MS = 30 * 60 * 1000;

export function validateWatch(w: Partial<WatchItem>): string[] {
  const errs: string[] = [];
  if (!w.state) errs.push("state");
  if (!w.commodity) errs.push("commodity");
  const pos = (n: number | undefined) => n === undefined || (Number.isFinite(n) && n > 0 && n < 10_00_000);
  if (!pos(w.targetAbove)) errs.push("targetAbove");
  if (!pos(w.targetBelow)) errs.push("targetBelow");
  if (w.changePct !== undefined && (!Number.isFinite(w.changePct) || w.changePct <= 0 || w.changePct > 500)) errs.push("changePct");
  if (w.targetAbove !== undefined && w.targetBelow !== undefined && w.targetBelow >= w.targetAbove) errs.push("range");
  if (w.targetAbove === undefined && w.targetBelow === undefined && w.changePct === undefined) errs.push("noRule");
  return errs;
}

export function recordsForWatch(w: WatchItem, records: readonly MandiRecord[]): MandiRecord[] {
  return records.filter((r) => !w.market || r.market.toLowerCase() === w.market.toLowerCase());
}

export function observationsFrom(w: WatchItem, records: readonly MandiRecord[], fetchedAt: number): PriceObservation[] {
  const seen = new Map<string, PriceObservation>();
  for (const r of recordsForWatch(w, records)) {
    const id = `${w.id}|${r.market}|${r.arrivalDate}`;
    // Several varieties can share market+date: keep the highest modal price (the best offer seen).
    const prev = seen.get(id);
    if (prev && prev.modal >= r.modalPrice) continue;
    seen.set(id, {
      id,
      watchId: w.id,
      market: r.market,
      arrivalDate: r.arrivalDate,
      modal: r.modalPrice,
      min: r.minPrice ?? r.modalPrice,
      max: r.maxPrice ?? r.modalPrice,
      fetchedAt,
    });
  }
  return [...seen.values()];
}

/** Latest observation per market. */
export function latestByMarket(obs: readonly PriceObservation[]): PriceObservation[] {
  const m = new Map<string, PriceObservation>();
  for (const o of obs) {
    const cur = m.get(o.market);
    if (!cur || o.arrivalDate > cur.arrivalDate) m.set(o.market, o);
  }
  return [...m.values()].sort((a, b) => b.modal - a.modal);
}

/** Evaluates rules against all known observations; returns alerts with stable ids (dedupe on save). */
export function evaluateAlerts(w: WatchItem, obs: readonly PriceObservation[], now: number): WatchAlert[] {
  const alerts: WatchAlert[] = [];
  const byMarket = new Map<string, PriceObservation[]>();
  for (const o of obs) byMarket.set(o.market, [...(byMarket.get(o.market) ?? []), o]);
  for (const [market, list] of byMarket) {
    list.sort((a, b) => a.arrivalDate.localeCompare(b.arrivalDate));
    const latest = list[list.length - 1];
    const prev = list.length > 1 ? list[list.length - 2] : undefined;
    const mk = (kind: WatchAlert["kind"], threshold: number, previous?: number): WatchAlert => ({
      id: `${w.id}|${kind}|${market}|${latest.arrivalDate}`,
      watchId: w.id,
      kind,
      modal: latest.modal,
      previous,
      threshold,
      arrivalDate: latest.arrivalDate,
      market,
      createdAt: now,
      seen: false,
    });
    if (w.targetAbove !== undefined && latest.modal >= w.targetAbove) alerts.push(mk("above", w.targetAbove));
    if (w.targetBelow !== undefined && latest.modal <= w.targetBelow) alerts.push(mk("below", w.targetBelow));
    if (w.changePct !== undefined && prev && prev.modal > 0) {
      const pct = (Math.abs(latest.modal - prev.modal) / prev.modal) * 100;
      if (pct >= w.changePct) alerts.push(mk("change", w.changePct, prev.modal));
    }
  }
  return alerts;
}

export function needsRecheck(w: WatchItem, now: number): boolean {
  return !w.lastCheckedAt || now - w.lastCheckedAt > RECHECK_MS;
}

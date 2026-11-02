/**
 * watchlist/watchService.ts — runs price checks for watched items.
 *
 * A check is one call to the existing mandi price service (lib/mandi), which
 * has its own cache: a saved copy younger than 30 minutes is reused, so
 * checking does not hammer the API. There is no polling timer: checks run
 * when the farmer opens the watchlist (if the last check is old), presses
 * "check now", or loads matching prices on the mandi screen, and in the
 * service worker's periodic background check where the browser supports it
 * (src/sw.ts). The service worker has no localStorage, so there it always
 * fetches; needsRecheck() still limits it to stale items.
 */
import { getMandiPrices, type MandiFilter, type MandiResult } from "../../lib/mandi";
import { addAlerts, listObservations, listWatch, putObservations, putWatch } from "../../lib/farmRepo";
import type { WatchAlert, WatchItem } from "../../lib/localDb";
import { evaluateAlerts, needsRecheck, observationsFrom, recordsForWatch } from "./watchlistLogic";

function matches(w: WatchItem, f: MandiFilter): boolean {
  return w.state === f.state && w.commodity === f.commodity && (w.district || "") === (f.district || "");
}

async function ingest(w: WatchItem, result: MandiResult): Promise<WatchAlert[]> {
  const now = Date.now();
  if (result.status === "unavailable" || !result.fetchedAt) {
    await putWatch({ ...w, lastCheckedAt: now, lastStatus: "unavailable" });
    return [];
  }
  const recs = recordsForWatch(w, result.records);
  await putObservations(observationsFrom(w, recs, result.fetchedAt));
  const all = await listObservations(w.id);
  const created = await addAlerts(evaluateAlerts(w, all, now));
  await putWatch({ ...w, lastCheckedAt: now, lastStatus: recs.length ? "ok" : "no_records" });
  return created;
}

export async function checkWatch(w: WatchItem, force = false): Promise<WatchAlert[]> {
  const result = await getMandiPrices({ state: w.state, commodity: w.commodity, district: w.district || undefined }, { force });
  return ingest(w, result);
}

/** Checks every item whose last check is stale. Sequential to stay gentle on the API. */
export async function checkStale(online: boolean): Promise<WatchAlert[]> {
  if (!online) return [];
  const created: WatchAlert[] = [];
  for (const w of await listWatch()) {
    if (needsRecheck(w, Date.now())) created.push(...(await checkWatch(w)));
  }
  return created;
}

/** Called by the mandi screen after it loads real prices: updates matching watches without another request. */
export async function ingestMandiResult(f: MandiFilter, result: MandiResult): Promise<WatchAlert[]> {
  if (result.status === "unavailable") return [];
  const created: WatchAlert[] = [];
  for (const w of await listWatch()) if (matches(w, f)) created.push(...(await ingest(w, result)));
  return created;
}

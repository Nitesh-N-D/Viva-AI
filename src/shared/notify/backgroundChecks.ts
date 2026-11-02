/**
 * shared/notify/backgroundChecks.ts — the reminder and price-alert checks
 * that run both in the open app and in the service worker (src/sw.ts).
 *
 * Nothing here touches the DOM, localStorage-only state or React state, so
 * it is safe in a service worker. Both callers use the same logic and the
 * same IndexedDB records, so a reminder or alert raised in the background is
 * not raised again when the app opens (remindedAt / stable alert ids).
 */
import { listTasks, putTask } from "../../lib/farmRepo";
import { todayIso, type WatchAlert } from "../../lib/localDb";
import { dueReminders } from "../../modules/planner/plannerLogic";
import { checkStale } from "../../modules/watchlist/watchService";

/** Marks due tasks as reminded and returns how many were due. */
export async function runReminderCheck(now = Date.now()): Promise<number> {
  const due = dueReminders(await listTasks(), todayIso(new Date(now)), now);
  for (const task of due) await putTask({ ...task, remindedAt: now });
  return due.length;
}

/** Re-checks stale watchlist items against real mandi prices; returns new alerts only. */
export async function runPriceCheck(online: boolean): Promise<WatchAlert[]> {
  return checkStale(online);
}

/**
 * Notification texts the service worker cannot translate itself (the
 * dictionaries are not bundled into it). The open app saves them in the
 * current language; `{count}` / `{n}` are filled in by the worker.
 */
export interface NotifyStrings {
  lang: "ta" | "en";
  appName: string;
  reminder: string; // contains {count}
  alerts: string; // contains {n}
}

export const NOTIFY_CACHE = "viva-meta";
export const NOTIFY_STRINGS_URL = "/__viva/notify-strings.json";
export const PERIODIC_TAG = "viva-background-checks";

export function fill(template: string, vars: Record<string, number>): string {
  let s = template;
  for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

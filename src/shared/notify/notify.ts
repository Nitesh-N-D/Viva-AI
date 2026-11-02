/**
 * shared/notify/notify.ts — page-side notifications.
 *
 * showAppNotification() prefers ServiceWorkerRegistration.showNotification:
 * Chrome on Android throws on `new Notification()` from a page, so the old
 * page-only call never showed anything on phones.
 *
 * enableBackgroundChecks() registers Periodic Background Sync where the
 * browser offers it. The result says honestly what will happen, so the UI
 * never claims background alerts on a browser that only checks while open.
 */
import { t, useLangStore } from "../../i18n";
import { NOTIFY_CACHE, NOTIFY_STRINGS_URL, PERIODIC_TAG, type NotifyStrings } from "./backgroundChecks";

export function notificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

async function swRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    // ready never settles when no worker is registered (dev server): time out.
    return await Promise.race([navigator.serviceWorker.ready, new Promise<null>((r) => setTimeout(() => r(null), 3000))]);
  } catch {
    return null;
  }
}

/** Shows a system notification; resolves false when it could not be shown. */
export async function showAppNotification(body: string, opts: { tag: string; route: string }): Promise<boolean> {
  if (!notificationsSupported() || Notification.permission !== "granted") return false;
  const options: NotificationOptions = { body, tag: opts.tag, icon: "/icons/icon-192.png", data: { route: opts.route } };
  const reg = await swRegistration();
  if (reg) {
    try {
      await reg.showNotification(t("appName"), options);
      return true;
    } catch {
      // fall through to the page API
    }
  }
  try {
    new Notification(t("appName"), options);
    return true;
  } catch {
    return false;
  }
}

/** Saves the notification texts in the current language for the service worker. */
export async function saveNotifyStrings(): Promise<void> {
  if (typeof caches === "undefined") return;
  const lang = useLangStore.getState().lang;
  const strings: NotifyStrings = {
    lang,
    appName: t("appName", undefined, lang),
    // Keep the placeholders: the worker fills them in.
    reminder: rawTemplate("planner.reminder", "count", lang),
    alerts: rawTemplate("watchlist.newAlerts", "n", lang),
  };
  try {
    const cache = await caches.open(NOTIFY_CACHE);
    await cache.put(NOTIFY_STRINGS_URL, new Response(JSON.stringify(strings), { headers: { "content-type": "application/json" } }));
  } catch {
    // Cache storage blocked: background notifications are skipped, in-app ones still work.
  }
}

/** A translated string with `{varName}` left in for the service worker to fill. */
export function rawTemplate(key: string, varName: string, lang: "ta" | "en"): string {
  // Fill with a sentinel, then put the placeholder back, so t() never strips it.
  const sentinel = "\u0000N\u0000";
  return t(key, { [varName]: sentinel }, lang).split(sentinel).join(`{${varName}}`);
}

export type BackgroundStatus = "enabled" | "unsupported" | "needs_install" | "needs_permission" | "error";

interface PeriodicSyncManager {
  register(tag: string, opts: { minInterval: number }): Promise<void>;
  getTags(): Promise<string[]>;
}

/** Registers background checks (about twice a day; the browser may space them further). */
export async function enableBackgroundChecks(): Promise<BackgroundStatus> {
  if (!notificationsSupported()) return "unsupported";
  if (Notification.permission !== "granted") return "needs_permission";
  await saveNotifyStrings();
  const reg = await swRegistration();
  const periodic = (reg as (ServiceWorkerRegistration & { periodicSync?: PeriodicSyncManager }) | null)?.periodicSync;
  if (!reg || !periodic) return "unsupported";
  try {
    const perm = await navigator.permissions?.query({ name: "periodic-background-sync" as PermissionName });
    // Chromium grants this permission only to an installed app.
    if (perm && perm.state !== "granted") return "needs_install";
    await periodic.register(PERIODIC_TAG, { minInterval: 12 * 60 * 60 * 1000 });
    return "enabled";
  } catch {
    return "error";
  }
}

/** Current state without registering anything. */
export async function backgroundStatus(): Promise<BackgroundStatus> {
  if (!notificationsSupported()) return "unsupported";
  if (Notification.permission !== "granted") return "needs_permission";
  const reg = await swRegistration();
  const periodic = (reg as (ServiceWorkerRegistration & { periodicSync?: PeriodicSyncManager }) | null)?.periodicSync;
  if (!reg || !periodic) return "unsupported";
  try {
    return (await periodic.getTags()).includes(PERIODIC_TAG) ? "enabled" : "needs_install";
  } catch {
    return "error";
  }
}

/**
 * src/sw.ts — VIVA AI service worker (vite-plugin-pwa, injectManifest).
 *
 * 1. Offline shell: precaches the built app and keeps the same runtime
 *    caches the old generated worker had (models, weather).
 * 2. Background checks: when the browser supports Periodic Background Sync
 *    (Chromium on Android/desktop, installed app, notification permission
 *    granted) it wakes this worker now and then. The worker then runs the
 *    same planner-reminder and watchlist price checks as the open app and
 *    shows a system notification for anything new. The browser decides how
 *    often this happens (typically at most a few times a day); it is not a
 *    push service and browsers without the API only check while the app is
 *    open.
 */
/// <reference lib="webworker" />
import { clientsClaim } from "workbox-core";
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { NetworkFirst } from "workbox-strategies";
import {
  NOTIFY_CACHE,
  NOTIFY_STRINGS_URL,
  PERIODIC_TAG,
  fill,
  runPriceCheck,
  runReminderCheck,
  type NotifyStrings,
} from "./shared/notify/backgroundChecks";

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: (string | { url: string; revision: string | null })[] };

// A new release waits until the page asks for it (lib/appUpdate.ts sends
// SKIP_WAITING when the user reloads to update or a chunk is missing).
// Taking over open tabs automatically used to delete the precached chunks
// their older app shell still needed ("Failed to fetch dynamically imported module").
self.addEventListener("message", (event) => {
  if ((event.data as { type?: string } | null)?.type === "SKIP_WAITING") void self.skipWaiting();
});
clientsClaim();
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);
registerRoute(new NavigationRoute(createHandlerBoundToURL("index.html")));

registerRoute(({ url }) => url.pathname.startsWith("/models/"), new NetworkFirst({ cacheName: "viva-model-cache", networkTimeoutSeconds: 8 }));
// Second, network-level layer behind the app-level caches in lib/weather.ts.
registerRoute(({ url }) => url.origin === "https://api.openweathermap.org", new NetworkFirst({ cacheName: "viva-weather-cache", networkTimeoutSeconds: 5 }));

async function notifyStrings(): Promise<NotifyStrings | null> {
  try {
    const res = await (await caches.open(NOTIFY_CACHE)).match(NOTIFY_STRINGS_URL);
    return res ? ((await res.json()) as NotifyStrings) : null;
  } catch {
    return null;
  }
}

async function backgroundChecks(): Promise<void> {
  if (Notification.permission !== "granted") return;
  const strings = await notifyStrings();
  // Without saved texts the worker cannot speak the farmer's language: skip
  // rather than notify in the wrong one. The app saves them on every start.
  if (!strings) return;
  const reminders = await runReminderCheck().catch(() => 0);
  if (reminders > 0) {
    await self.registration.showNotification(strings.appName, {
      body: fill(strings.reminder, { count: reminders }),
      tag: "viva-tasks",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      lang: strings.lang,
      data: { route: "#/planner" },
    });
  }
  const alerts = await runPriceCheck(true).catch(() => []);
  if (alerts.length > 0) {
    await self.registration.showNotification(strings.appName, {
      body: fill(strings.alerts, { n: alerts.length }),
      tag: "viva-price-alerts",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      lang: strings.lang,
      data: { route: "#/watchlist" },
    });
  }
}

interface PeriodicSyncEvent extends ExtendableEvent {
  tag: string;
}

self.addEventListener("periodicsync", (event) => {
  const e = event as PeriodicSyncEvent;
  if (e.tag === PERIODIC_TAG) e.waitUntil(backgroundChecks());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const route = typeof event.notification.data?.route === "string" ? (event.notification.data.route as string) : "#/";
  const target = new URL("/" + route, self.location.origin).href;
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const w of wins) {
        if (new URL(w.url).origin === self.location.origin) {
          await w.focus();
          if ("navigate" in w) await w.navigate(target).catch(() => undefined);
          return;
        }
      }
      await self.clients.openWindow(target);
    })()
  );
});

/**
 * Reminders for planner tasks that are due today or overdue.
 *
 * While the app is open: checked on start, when the tab becomes visible and
 * every 15 minutes, shown as a toast and (with permission) a system
 * notification through the service worker.
 *
 * While the app is closed: only where the browser supports Periodic
 * Background Sync for this installed app (see src/sw.ts and
 * shared/notify/notify.ts). Both paths share runReminderCheck(), so a task
 * is reminded at most once a day.
 */
import { useEffect } from "react";
import { t, useLangStore } from "../../i18n";
import { toast } from "../../shared/ui/Toast";
import { enableBackgroundChecks, notificationsSupported, saveNotifyStrings, showAppNotification } from "../../shared/notify/notify";

export { notificationsSupported };

const INTERVAL_MS = 15 * 60 * 1000;

export function useTaskReminders(): void {
  useEffect(() => {
    let stopped = false;
    const check = async () => {
      if (stopped || document.visibilityState !== "visible") return;
      try {
        const { runReminderCheck } = await import("../../shared/notify/backgroundChecks");
        if (stopped) return;
        const count = await runReminderCheck();
        if (!count) return;
        const msg = t("planner.reminder", { count });
        toast.info(msg);
        void showAppNotification(msg, { tag: "viva-tasks", route: "#/planner" });
      } catch {
        // IndexedDB unavailable (private mode): reminders are best-effort.
      }
    };
    const timer = window.setInterval(() => void check(), INTERVAL_MS);
    const onVisible = () => void check();
    document.addEventListener("visibilitychange", onVisible);
    const first = window.setTimeout(() => void check(), 3000);
    // Keep the background registration and its notification texts current.
    if (notificationsSupported() && Notification.permission === "granted") void enableBackgroundChecks();
    const unsubLang = useLangStore.subscribe(() => void saveNotifyStrings());
    return () => {
      stopped = true;
      window.clearInterval(timer);
      window.clearTimeout(first);
      document.removeEventListener("visibilitychange", onVisible);
      unsubLang();
    };
  }, []);
}

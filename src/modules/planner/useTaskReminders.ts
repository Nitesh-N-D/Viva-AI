/**
 * In-app reminders for planner tasks that are due today or overdue.
 *
 * Runs only while the app is open: on start, when the tab becomes visible,
 * and every 15 minutes. It shows a toast and, if the farmer granted
 * notification permission, a system notification. There is no background
 * push service, so nothing fires while the app is closed.
 */
import { useEffect } from "react";
import { t } from "../../i18n";
import { toast } from "../../shared/ui/Toast";

const INTERVAL_MS = 15 * 60 * 1000;

export function notificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function useTaskReminders(): void {
  useEffect(() => {
    let stopped = false;
    const check = async () => {
      if (stopped || document.visibilityState !== "visible") return;
      try {
        const [{ listTasks, putTask }, { dueReminders }, { todayIso }] = await Promise.all([
          import("../../lib/farmRepo"),
          import("./plannerLogic"),
          import("../../lib/localDb"),
        ]);
        const now = Date.now();
        const due = dueReminders(await listTasks(), todayIso(), now);
        if (!due.length || stopped) return;
        const msg = t("planner.reminder", { count: due.length });
        toast.info(msg);
        if (notificationsSupported() && Notification.permission === "granted") {
          try {
            new Notification(t("appName"), { body: msg, tag: "viva-tasks", icon: "/icons/icon-192.png" });
          } catch {
            // Some mobile browsers only allow notifications from a service worker; the toast is enough.
          }
        }
        for (const task of due) await putTask({ ...task, remindedAt: now });
      } catch {
        // IndexedDB unavailable (private mode): reminders are best-effort.
      }
    };
    const timer = window.setInterval(() => void check(), INTERVAL_MS);
    const onVisible = () => void check();
    document.addEventListener("visibilitychange", onVisible);
    const first = window.setTimeout(() => void check(), 3000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      window.clearTimeout(first);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
}

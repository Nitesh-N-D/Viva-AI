import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, resetDbForTests, todayIso, type FarmTask } from "../lib/localDb";
import { putTask, listTasks } from "../lib/farmRepo";
import { fill, runReminderCheck } from "../shared/notify/backgroundChecks";
import { backgroundStatus, enableBackgroundChecks, rawTemplate, showAppNotification } from "../shared/notify/notify";

const task = (id: string, dueDate: string, extra: Partial<FarmTask> = {}): FarmTask => ({
  id,
  planId: null,
  title: id,
  category: "other",
  dueDate,
  done: false,
  remind: true,
  createdAt: 0,
  ...extra,
});

async function clearTasks() {
  const d = await db();
  await d.clear("tasks");
}

describe("background reminder check (shared by app and service worker)", () => {
  beforeEach(async () => {
    await clearTasks();
  });
  afterEach(async () => {
    await resetDbForTests();
  });

  it("counts due/overdue tasks once per day and records remindedAt", async () => {
    const today = todayIso();
    await putTask(task("due", today));
    await putTask(task("overdue", "2020-01-01"));
    await putTask(task("future", "2999-01-01"));
    await putTask(task("done", today, { done: true }));
    await putTask(task("muted", today, { remind: false }));
    const now = Date.now();
    expect(await runReminderCheck(now)).toBe(2);
    const stored = await listTasks();
    expect(stored.filter((t) => t.remindedAt === now).map((t) => t.id).sort()).toEqual(["due", "overdue"]);
    // A second run the same day (e.g. the app opening after a background run) does not repeat it.
    expect(await runReminderCheck(now + 60_000)).toBe(0);
  });

  it("reminds again on a later day", async () => {
    const yesterday = Date.now() - 86_400_000;
    await putTask(task("overdue", "2020-01-01", { remindedAt: yesterday - 3_600_000 }));
    expect(await runReminderCheck()).toBe(1);
  });
});

describe("notification texts for the service worker", () => {
  it("keeps the placeholder in both languages", () => {
    const ta = rawTemplate("planner.reminder", "count", "ta");
    const en = rawTemplate("watchlist.newAlerts", "n", "en");
    expect(ta).toContain("{count}");
    expect(en).toContain("{n}");
    expect(fill(en, { n: 3 })).toBe("3 new price alert(s)");
    expect(fill(ta, { count: 2 })).not.toMatch(/\{count\}/);
  });
});

describe("page notifications are honest about support", () => {
  const original = (globalThis as { Notification?: unknown }).Notification;
  afterEach(() => {
    (globalThis as { Notification?: unknown }).Notification = original;
    vi.restoreAllMocks();
  });

  it("reports unsupported without the Notification API", async () => {
    delete (globalThis as { Notification?: unknown }).Notification;
    expect(await showAppNotification("x", { tag: "t", route: "#/" })).toBe(false);
    expect(await enableBackgroundChecks()).toBe("unsupported");
    expect(await backgroundStatus()).toBe("unsupported");
  });

  it("needs permission before showing or registering anything", async () => {
    (globalThis as { Notification?: unknown }).Notification = Object.assign(vi.fn(), { permission: "default" });
    expect(await showAppNotification("x", { tag: "t", route: "#/" })).toBe(false);
    expect(await enableBackgroundChecks()).toBe("needs_permission");
  });

  it("falls back to the page Notification API when there is no service worker", async () => {
    const ctor = vi.fn();
    (globalThis as { Notification?: unknown }).Notification = Object.assign(ctor, { permission: "granted" });
    expect(await showAppNotification("hello", { tag: "viva-tasks", route: "#/planner" })).toBe(true);
    expect(ctor).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ body: "hello", tag: "viva-tasks" }));
    // No service worker in jsdom, so background checks are not claimed.
    expect(await enableBackgroundChecks()).toBe("unsupported");
  });

  it("registers periodic sync only when the browser grants it", async () => {
    (globalThis as { Notification?: unknown }).Notification = Object.assign(vi.fn(), { permission: "granted" });
    const register = vi.fn().mockResolvedValue(undefined);
    const reg = { periodicSync: { register, getTags: vi.fn().mockResolvedValue(["viva-background-checks"]) }, showNotification: vi.fn() };
    Object.defineProperty(navigator, "serviceWorker", { value: { ready: Promise.resolve(reg) }, configurable: true });
    const query = vi.fn().mockResolvedValue({ state: "prompt" });
    Object.defineProperty(navigator, "permissions", { value: { query }, configurable: true });
    expect(await enableBackgroundChecks()).toBe("needs_install");
    expect(register).not.toHaveBeenCalled();
    query.mockResolvedValue({ state: "granted" });
    expect(await enableBackgroundChecks()).toBe("enabled");
    expect(register).toHaveBeenCalledWith("viva-background-checks", { minInterval: 12 * 60 * 60 * 1000 });
    expect(await backgroundStatus()).toBe("enabled");
    // Notifications go through the service worker registration (works on Android Chrome).
    expect(await showAppNotification("hi", { tag: "t", route: "#/watchlist" })).toBe(true);
    expect(reg.showNotification).toHaveBeenCalled();
    delete (navigator as { serviceWorker?: unknown }).serviceWorker;
  });
});

/**
 * lib/farmRepo.ts — CRUD over the on-device IndexedDB stores (lib/localDb).
 * Every write emits a change event so open screens refresh.
 */
import { useCallback, useEffect, useState } from "react";
import {
  db,
  emitDbChange,
  onDbChange,
  type ChatMessage,
  type FarmPlan,
  type FarmTask,
  type FinanceEntry,
  type PriceObservation,
  type WatchAlert,
  type WatchItem,
} from "./localDb";

/* ---------------- plans & tasks ---------------- */

export async function listPlans(): Promise<FarmPlan[]> {
  return (await (await db()).getAll("plans")).sort((a, b) => b.createdAt - a.createdAt);
}

export async function savePlanWithTasks(plan: FarmPlan, tasks: FarmTask[]): Promise<void> {
  const d = await db();
  const tx = d.transaction(["plans", "tasks"], "readwrite");
  await tx.objectStore("plans").put(plan);
  for (const t of tasks) await tx.objectStore("tasks").put(t);
  await tx.done;
  emitDbChange("plans");
  emitDbChange("tasks");
}

export async function deletePlan(planId: string): Promise<void> {
  const d = await db();
  const tx = d.transaction(["plans", "tasks"], "readwrite");
  await tx.objectStore("plans").delete(planId);
  const keys = await tx.objectStore("tasks").index("byPlan").getAllKeys(planId);
  for (const k of keys) await tx.objectStore("tasks").delete(k);
  await tx.done;
  emitDbChange("plans");
  emitDbChange("tasks");
}

export async function listTasks(): Promise<FarmTask[]> {
  return (await db()).getAllFromIndex("tasks", "byDue");
}

export async function putTask(task: FarmTask): Promise<void> {
  await (await db()).put("tasks", task);
  emitDbChange("tasks");
}

export async function deleteTask(id: string): Promise<void> {
  await (await db()).delete("tasks", id);
  emitDbChange("tasks");
}

/* ---------------- finance ---------------- */

export async function listEntries(): Promise<FinanceEntry[]> {
  return (await (await db()).getAllFromIndex("finance", "byDate")).reverse();
}
export async function putEntry(e: FinanceEntry): Promise<void> {
  await (await db()).put("finance", e);
  emitDbChange("finance");
}
export async function deleteEntry(id: string): Promise<void> {
  await (await db()).delete("finance", id);
  emitDbChange("finance");
}

/* ---------------- watchlist ---------------- */

export async function listWatch(): Promise<WatchItem[]> {
  return (await (await db()).getAll("watchlist")).sort((a, b) => b.createdAt - a.createdAt);
}
export async function putWatch(w: WatchItem): Promise<void> {
  await (await db()).put("watchlist", w);
  emitDbChange("watchlist");
}
export async function deleteWatch(id: string): Promise<void> {
  const d = await db();
  const tx = d.transaction(["watchlist", "observations", "alerts"], "readwrite");
  await tx.objectStore("watchlist").delete(id);
  for (const k of await tx.objectStore("observations").index("byWatch").getAllKeys(id)) await tx.objectStore("observations").delete(k);
  for (const a of await tx.objectStore("alerts").getAll()) if (a.watchId === id) await tx.objectStore("alerts").delete(a.id);
  await tx.done;
  emitDbChange("watchlist");
  emitDbChange("alerts");
}
export async function listObservations(watchId: string): Promise<PriceObservation[]> {
  return (await db()).getAllFromIndex("observations", "byWatch", watchId);
}
export async function putObservations(obs: PriceObservation[]): Promise<void> {
  const d = await db();
  const tx = d.transaction("observations", "readwrite");
  for (const o of obs) await tx.store.put(o);
  await tx.done;
  emitDbChange("observations");
}
/** Saves alerts that are new (by id); returns only the newly created ones. */
export async function addAlerts(alerts: WatchAlert[]): Promise<WatchAlert[]> {
  const d = await db();
  const tx = d.transaction("alerts", "readwrite");
  const created: WatchAlert[] = [];
  for (const a of alerts) {
    if (await tx.store.get(a.id)) continue;
    await tx.store.put(a);
    created.push(a);
  }
  await tx.done;
  if (created.length) emitDbChange("alerts");
  return created;
}
export async function listAlerts(): Promise<WatchAlert[]> {
  return (await (await db()).getAllFromIndex("alerts", "byCreated")).reverse();
}
export async function markAlertsSeen(): Promise<void> {
  const d = await db();
  const tx = d.transaction("alerts", "readwrite");
  for (const a of await tx.store.getAll()) if (!a.seen) await tx.store.put({ ...a, seen: true });
  await tx.done;
  emitDbChange("alerts");
}

/* ---------------- chat ---------------- */

export const MAX_CHAT_MESSAGES = 200;

export async function listChat(): Promise<ChatMessage[]> {
  return (await db()).getAllFromIndex("chat", "byAt");
}
export async function addChat(m: ChatMessage): Promise<void> {
  const d = await db();
  await d.put("chat", m);
  const keys = await d.getAllKeysFromIndex("chat", "byAt");
  if (keys.length > MAX_CHAT_MESSAGES) {
    const tx = d.transaction("chat", "readwrite");
    for (const k of keys.slice(0, keys.length - MAX_CHAT_MESSAGES)) await tx.store.delete(k);
    await tx.done;
  }
  emitDbChange("chat");
}
export async function clearChat(): Promise<void> {
  await (await db()).clear("chat");
  emitDbChange("chat");
}

/* ---------------- hook ---------------- */

type StoreName = Parameters<typeof emitDbChange>[0];

/** Loads data from IndexedDB and reloads when any of `stores` changes. */
export function useDbQuery<T>(load: () => Promise<T>, stores: StoreName[], initial: T) {
  const [data, setData] = useState<T>(initial);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const key = stores.join(",");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(load, []);
  const reload = useCallback(async () => {
    try {
      setData(await run());
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [run]);
  useEffect(() => {
    void reload();
    const watched = new Set(key.split(","));
    return onDbChange((s) => {
      if (watched.has(s)) void reload();
    });
  }, [reload, key]);
  return { data, loading, error, reload };
}

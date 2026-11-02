/**
 * lib/localDb.ts — on-device IndexedDB store for the farmer's own records:
 * farm plans and tasks, income/expense entries, the mandi watchlist with
 * its price observations, and assistant chat history.
 *
 * Everything stays on this device (works offline, no account needed). Each
 * feature offers CSV/JSON export so the farmer can keep a backup.
 */
import { openDB, type DBSchema, type IDBPDatabase } from "idb";

export interface FarmPlan {
  id: string;
  cropId: string;
  label: string;
  sowingDate: string; // yyyy-mm-dd
  areaAcres?: number;
  createdAt: number;
}

export type TaskCategory = "land" | "sowing" | "irrigation" | "nutrient" | "weeding" | "protection" | "harvest" | "market" | "other";

export interface FarmTask {
  id: string;
  planId: string | null;
  title: string;
  /** i18n key for generated tasks, so they re-render in the current language. */
  titleKey?: string;
  category: TaskCategory;
  dueDate: string; // yyyy-mm-dd
  done: boolean;
  doneAt?: number;
  notes?: string;
  remind: boolean;
  remindedAt?: number;
  createdAt: number;
}

export type EntryKind = "expense" | "income";

export interface FinanceEntry {
  id: string;
  kind: EntryKind;
  category: string;
  amount: number; // INR, > 0
  date: string; // yyyy-mm-dd
  cropId?: string;
  quantity?: number;
  unit?: string;
  note?: string;
  createdAt: number;
}

export interface WatchItem {
  id: string;
  state: string;
  district: string;
  market: string;
  commodity: string;
  targetAbove?: number; // ₹/quintal
  targetBelow?: number;
  changePct?: number; // alert when modal price moves by at least this %
  createdAt: number;
  lastCheckedAt?: number;
  lastStatus?: "ok" | "unavailable" | "no_records";
}

export interface PriceObservation {
  id: string; // `${watchId}|${market}|${arrivalDate}`
  watchId: string;
  market: string;
  arrivalDate: string; // as given by the source
  modal: number;
  min: number;
  max: number;
  fetchedAt: number;
}

export interface WatchAlert {
  id: string;
  watchId: string;
  kind: "above" | "below" | "change";
  modal: number;
  previous?: number;
  threshold: number;
  arrivalDate: string;
  market: string;
  createdAt: number;
  seen: boolean;
}

export interface ChatMessage {
  id: string;
  role: "user" | "model";
  text: string;
  at: number;
  model?: string;
  /** Short description of the app data that was sent as context. */
  contextNote?: string;
  error?: boolean;
}

interface VivaDb extends DBSchema {
  plans: { key: string; value: FarmPlan };
  tasks: { key: string; value: FarmTask; indexes: { byDue: string; byPlan: string } };
  finance: { key: string; value: FinanceEntry; indexes: { byDate: string } };
  watchlist: { key: string; value: WatchItem };
  observations: { key: string; value: PriceObservation; indexes: { byWatch: string } };
  alerts: { key: string; value: WatchAlert; indexes: { byCreated: number } };
  chat: { key: string; value: ChatMessage; indexes: { byAt: number } };
}

const DB_NAME = "viva-ai-farm";
const DB_VERSION = 1;
let dbPromise: Promise<IDBPDatabase<VivaDb>> | null = null;

export function db(): Promise<IDBPDatabase<VivaDb>> {
  dbPromise ??= openDB<VivaDb>(DB_NAME, DB_VERSION, {
    upgrade(d) {
      d.createObjectStore("plans", { keyPath: "id" });
      const tasks = d.createObjectStore("tasks", { keyPath: "id" });
      tasks.createIndex("byDue", "dueDate");
      tasks.createIndex("byPlan", "planId");
      d.createObjectStore("finance", { keyPath: "id" }).createIndex("byDate", "date");
      d.createObjectStore("watchlist", { keyPath: "id" });
      d.createObjectStore("observations", { keyPath: "id" }).createIndex("byWatch", "watchId");
      d.createObjectStore("alerts", { keyPath: "id" }).createIndex("byCreated", "createdAt");
      d.createObjectStore("chat", { keyPath: "id" }).createIndex("byAt", "at");
    },
  }).catch((err) => {
    dbPromise = null; // allow a later retry (e.g. private mode toggled)
    throw err;
  });
  return dbPromise;
}

/** Test helper: close and forget the connection. */
export async function resetDbForTests(): Promise<void> {
  if (dbPromise) (await dbPromise).close();
  dbPromise = null;
}

export function newId(prefix: string): string {
  const rnd = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${rnd}`;
}

/* ---------- local change notifications (so screens refresh) ---------- */

type Store = "plans" | "tasks" | "finance" | "watchlist" | "observations" | "alerts" | "chat";
const listeners = new Set<(store: Store) => void>();
export function onDbChange(fn: (store: Store) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function emitDbChange(store: Store): void {
  for (const fn of listeners) fn(store);
}

/* ---------- date helpers (local calendar dates as yyyy-mm-dd) ---------- */

export function todayIso(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export function daysBetweenIso(a: string, b: string): number {
  const pa = a.split("-").map(Number);
  const pb = b.split("-").map(Number);
  return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86_400_000);
}

export function isIsoDate(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/* ---------- CSV ---------- */

export function toCsv(rows: (string | number | undefined | null)[][]): string {
  const cell = (v: string | number | undefined | null) => {
    const s = v === undefined || v === null ? "" : String(v);
    // Neutralise spreadsheet formula injection, then quote.
    const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n");
}

export function downloadText(filename: string, text: string, mime = "text/csv;charset=utf-8"): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

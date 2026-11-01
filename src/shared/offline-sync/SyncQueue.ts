/**
 * shared/offline-sync/SyncQueue.ts
 *
 * Every record bound for Firestore is written here first (IndexedDB) and
 * flushed later, so the app behaves the same offline and online.
 *
 *  - Each item gets an idempotency key at enqueue time. The writer uses
 *    it as the Firestore document id, so a retry after a lost response
 *    rewrites the same document instead of creating a duplicate.
 *  - Only one flush runs at a time (concurrent callers share it).
 *  - Successfully written items are deleted immediately; failures back
 *    off exponentially and keep their last error for the status UI.
 */
import { openDB, type IDBPDatabase } from "idb";

export type QueueCollection = "soilScans" | "fabricationRequests" | "growthUpdates";

export interface QueueItem {
  /** Idempotency key; also the Firestore document id. */
  id: string;
  collection: QueueCollection;
  payload: Record<string, unknown>;
  attempts: number;
  createdAt: number;
  nextAttemptAt: number;
  lastError?: string;
}

export type QueueWriter = (
  collection: QueueCollection,
  payload: Record<string, unknown>,
  idempotencyKey: string
) => Promise<void>;

export interface QueueStats {
  total: number;
  failing: number;
}

const DB_NAME = "viva-ai-sync";
const STORE = "outbox";
const BASE_BACKOFF_MS = 30_000;
const MAX_BACKOFF_MS = 60 * 60 * 1000;

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 2, {
      upgrade(db, oldVersion) {
        // v1 used an auto-increment "queue" store with no idempotency key,
        // and its soil records came from the old hash-based mock
        // classifier. Those must never reach Firestore, so the store is
        // dropped rather than migrated.
        if (oldVersion < 2 && db.objectStoreNames.contains("queue")) db.deleteObjectStore("queue");
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
      },
    });
  }
  return dbPromise;
}

const listeners = new Set<(stats: QueueStats) => void>();

export function subscribeQueue(listener: (stats: QueueStats) => void): () => void {
  listeners.add(listener);
  void queueStats().then(listener);
  return () => listeners.delete(listener);
}

async function notify() {
  if (listeners.size === 0) return;
  const stats = await queueStats();
  listeners.forEach((l) => l(stats));
}

export function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // Fallback for very old WebViews: 128 random bits from getRandomValues.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Queue a record; resolves to its idempotency key. Never touches the network. */
export async function enqueue(
  collection: QueueCollection,
  payload: Record<string, unknown>,
  idempotencyKey: string = newIdempotencyKey()
): Promise<string> {
  const db = await getDb();
  const now = Date.now();
  const item: QueueItem = { id: idempotencyKey, collection, payload, attempts: 0, createdAt: now, nextAttemptAt: now };
  // put (not add): enqueueing the same key twice is a no-op overwrite.
  await db.put(STORE, item);
  void notify();
  return idempotencyKey;
}

export async function queueStats(): Promise<QueueStats> {
  const db = await getDb();
  const all = (await db.getAll(STORE)) as QueueItem[];
  return { total: all.length, failing: all.filter((i) => i.attempts > 0).length };
}

export async function listQueue(): Promise<QueueItem[]> {
  const db = await getDb();
  return (await db.getAll(STORE)) as QueueItem[];
}

export async function clearQueue(): Promise<void> {
  const db = await getDb();
  await db.clear(STORE);
  void notify();
}

export function backoffMs(attempts: number): number {
  return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.max(0, attempts - 1));
}

let inFlight: Promise<{ synced: number; failed: number }> | null = null;

async function runFlush(writer: QueueWriter, now: number, ignoreBackoff: boolean) {
  const db = await getDb();
  const due = ((await db.getAll(STORE)) as QueueItem[])
    .filter((i) => ignoreBackoff || i.nextAttemptAt <= now)
    .sort((a, b) => a.createdAt - b.createdAt);

  let synced = 0;
  let failed = 0;
  for (const item of due) {
    try {
      await writer(item.collection, item.payload, item.id);
      await db.delete(STORE, item.id);
      synced++;
    } catch (err) {
      const attempts = item.attempts + 1;
      await db.put(STORE, {
        ...item,
        attempts,
        nextAttemptAt: now + backoffMs(attempts),
        lastError: err instanceof Error ? err.message : String(err),
      } satisfies QueueItem);
      failed++;
    }
  }
  return { synced, failed };
}

/**
 * Flush due items. Concurrent calls share the in-progress flush, so two
 * triggers (an `online` event and the interval) cannot double-write.
 */
export function flushQueue(
  writer: QueueWriter,
  opts: { now?: number; ignoreBackoff?: boolean } = {}
): Promise<{ synced: number; failed: number }> {
  if (!inFlight) {
    inFlight = runFlush(writer, opts.now ?? Date.now(), opts.ignoreBackoff ?? false).finally(() => {
      inFlight = null;
      void notify();
    });
  }
  return inFlight;
}

/** Flush on reconnect and every minute; reports non-empty flushes. Returns a cleanup function. */
export function registerAutoFlush(
  writer: QueueWriter,
  onResult?: (result: { synced: number; failed: number }) => void
): () => void {
  const tick = () => {
    if (!navigator.onLine) return;
    flushQueue(writer)
      .then((r) => {
        if (r.synced + r.failed > 0) onResult?.(r);
      })
      .catch((err) => console.warn("[sync] flush failed", err));
  };
  window.addEventListener("online", tick);
  const timer = window.setInterval(tick, 60_000);
  tick();
  return () => {
    window.removeEventListener("online", tick);
    window.clearInterval(timer);
  };
}

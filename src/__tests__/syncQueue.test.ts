import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { backoffMs, clearQueue, enqueue, flushQueue, listQueue, newIdempotencyKey, queueStats } from "../shared/offline-sync/SyncQueue";

describe("offline sync queue", () => {
  beforeEach(async () => {
    await clearQueue();
  });

  it("enqueues without touching the network and dedupes by idempotency key", async () => {
    await enqueue("growthUpdates", { a: 1 }, "key-1");
    await enqueue("growthUpdates", { a: 2 }, "key-1");
    const items = await listQueue();
    expect(items).toHaveLength(1);
    expect(items[0].payload).toEqual({ a: 2 });
    expect(await queueStats()).toEqual({ total: 1, failing: 0 });
  });

  it("flushes items with their idempotency key as document id", async () => {
    await enqueue("fabricationRequests", { shapeType: "l_bracket" }, "k1");
    const writer = vi.fn(() => Promise.resolve());
    expect(await flushQueue(writer)).toEqual({ synced: 1, failed: 0 });
    expect(writer).toHaveBeenCalledWith("fabricationRequests", { shapeType: "l_bracket" }, "k1");
    expect(await queueStats()).toEqual({ total: 0, failing: 0 });
  });

  it("keeps failures, records the error and backs off", async () => {
    await enqueue("soilScans", { x: 1 }, "k2");
    const now = Date.now() + 1000;
    const r = await flushQueue(() => Promise.reject(new Error("permission-denied")), { now });
    expect(r).toEqual({ synced: 0, failed: 1 });
    const [item] = await listQueue();
    expect(item).toMatchObject({ attempts: 1, lastError: "permission-denied", nextAttemptAt: now + backoffMs(1) });
    // Not due yet: a normal flush skips it.
    const writer = vi.fn(() => Promise.resolve());
    expect(await flushQueue(writer, { now: now + 1 })).toEqual({ synced: 0, failed: 0 });
    // Manual "sync now" ignores backoff.
    expect(await flushQueue(writer, { now: now + 1, ignoreBackoff: true })).toEqual({ synced: 1, failed: 0 });
  });

  it("shares a single in-flight flush between concurrent callers", async () => {
    await enqueue("growthUpdates", { a: 1 }, "k3");
    const writer = vi.fn(() => new Promise<void>((res) => setTimeout(res, 10)));
    const [a, b] = await Promise.all([flushQueue(writer), flushQueue(writer)]);
    expect(a).toEqual(b);
    expect(writer).toHaveBeenCalledTimes(1);
  });

  it("backoff grows exponentially and is capped", () => {
    expect(backoffMs(1)).toBe(30_000);
    expect(backoffMs(2)).toBe(60_000);
    expect(backoffMs(50)).toBe(3_600_000);
  });

  it("generates unique idempotency keys", () => {
    const keys = new Set(Array.from({ length: 200 }, newIdempotencyKey));
    expect(keys.size).toBe(200);
  });
});

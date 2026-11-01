import { useCallback, useEffect, useState } from "react";
import { flushQueue, subscribeQueue, type QueueStats } from "../shared/offline-sync/SyncQueue";
import { isFirebaseConfigured, writeQueuedItem } from "../lib/firebase";
import { useAppStore } from "./store";

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  return online;
}

export function useSyncStatus() {
  const [stats, setStats] = useState<QueueStats>({ total: 0, failing: 0 });
  const [syncing, setSyncing] = useState(false);
  const lastSync = useAppStore((s) => s.lastSync);
  const setLastSync = useAppStore((s) => s.setLastSync);
  const online = useOnline();

  useEffect(() => subscribeQueue(setStats), []);

  const syncNow = useCallback(async () => {
    if (!isFirebaseConfigured) return null;
    setSyncing(true);
    try {
      const r = await flushQueue(writeQueuedItem, { ignoreBackoff: true });
      setLastSync({ at: Date.now(), ...r });
      return r;
    } finally {
      setSyncing(false);
    }
  }, [setLastSync]);

  return { stats, syncing, lastSync, online, configured: isFirebaseConfigured, syncNow };
}

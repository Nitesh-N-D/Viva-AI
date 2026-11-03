/**
 * lib/appUpdate.ts — service-worker registration, controlled updates and
 * recovery from missing code chunks after a deploy.
 *
 * Why this exists: every deploy gives the JS chunks new hashed names and the
 * old files disappear from hosting. A tab that is still running the previous
 * app shell then asks for chunks that no longer exist ("Failed to fetch
 * dynamically imported module"). The pieces below keep that from trapping a
 * user on an error screen:
 *
 *  - The service worker no longer takes over open tabs by itself (src/sw.ts
 *    waits for SKIP_WAITING). An open tab keeps its own, complete precached
 *    release until the user accepts the update or reopens the app.
 *  - When a new version is waiting, `onUpdateReady` listeners are told so the
 *    shell can offer "Reload to update".
 *  - `recoverFromChunkError` activates a waiting worker (or checks for one)
 *    and reloads once. A timestamp guard stops reload loops: at most one
 *    automatic reload per RELOAD_GUARD_MS, and never while offline.
 */

const RELOAD_KEY = "viva-ai:chunk-reload-at";
export const RELOAD_GUARD_MS = 60_000;

let registration: ServiceWorkerRegistration | null = null;
let updateReady = false;
const listeners = new Set<(ready: boolean) => void>();

function setReady(ready: boolean) {
  updateReady = ready;
  listeners.forEach((l) => l(ready));
}

export function isUpdateReady(): boolean {
  return updateReady;
}

export function onUpdateReady(listener: (ready: boolean) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function watch(reg: ServiceWorkerRegistration) {
  registration = reg;
  // Only an update is "ready": the very first install has no previous controller.
  const check = () => {
    if (reg.waiting && navigator.serviceWorker.controller) setReady(true);
  };
  check();
  reg.addEventListener("updatefound", () => {
    const sw = reg.installing;
    sw?.addEventListener("statechange", () => {
      if (sw.state === "installed") check();
    });
  });
}

/** Registers /sw.js in production builds and checks for updates periodically. */
export function registerAppServiceWorker(): void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  if (!import.meta.env?.PROD) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((reg) => {
        watch(reg);
        const update = () => void reg.update().catch(() => undefined);
        setInterval(update, 30 * 60 * 1000);
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") update();
        });
      })
      .catch(() => undefined);
  });
}

/** Tells a waiting worker to take over, waits (briefly) for it, then reloads. */
export async function activateUpdateAndReload(reload: () => void = () => window.location.reload()): Promise<void> {
  const installing = registration?.installing;
  if (installing) {
    // An update check just found a new version: give it a moment to finish installing.
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, 5000);
      installing.addEventListener("statechange", () => {
        if (installing.state !== "installing") {
          clearTimeout(t);
          resolve();
        }
      });
    });
  }
  const waiting = registration?.waiting;
  if (waiting && "serviceWorker" in navigator) {
    await new Promise<void>((resolve) => {
      const done = () => resolve();
      navigator.serviceWorker.addEventListener("controllerchange", done, { once: true });
      setTimeout(done, 3000);
      waiting.postMessage({ type: "SKIP_WAITING" });
    });
  }
  reload();
}

export interface RecoverOptions {
  /** User pressed a button: skip the loop guard. */
  force?: boolean;
  reload?: () => void;
  now?: () => number;
  storage?: Pick<Storage, "getItem" | "setItem"> | null;
  online?: () => boolean;
}

/**
 * Called when a code chunk could not be loaded. Returns true when a reload
 * was started, false when it was not attempted (offline, or a reload already
 * happened within the guard window: the error screen is shown instead).
 */
export async function recoverFromChunkError(opts: RecoverOptions = {}): Promise<boolean> {
  const now = (opts.now ?? Date.now)();
  const online = opts.online ?? (() => typeof navigator === "undefined" || navigator.onLine !== false);
  if (!online()) return false;
  let storage: RecoverOptions["storage"] = opts.storage;
  if (storage === undefined) {
    try {
      storage = window.sessionStorage;
    } catch {
      storage = null;
    }
  }
  if (!opts.force) {
    // Without storage there is no way to tell a loop from a first try: do not reload.
    if (!storage) return false;
    let last = NaN;
    try {
      last = Number(storage.getItem(RELOAD_KEY));
    } catch {
      return false;
    }
    if (Number.isFinite(last) && last > 0 && now - last < RELOAD_GUARD_MS) return false;
  }
  try {
    storage?.setItem(RELOAD_KEY, String(now));
  } catch {
    if (!opts.force) return false;
  }
  try {
    await registration?.update();
  } catch {
    /* offline or blocked: reload anyway */
  }
  await activateUpdateAndReload(opts.reload);
  return true;
}

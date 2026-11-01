/**
 * lib/firebase.ts
 *
 * Spark (free) tier only: Anonymous Auth + Firestore, no Cloud Functions.
 * Config comes from VITE_ env vars; with none set, every export degrades
 * to a safe no-op and the UI reports "cloud sync not configured".
 *
 * Aggregates (map tiles, rating averages) are computed on the client from
 * the individual documents. Clients never write aggregate counters,
 * because on Spark there is no trusted server to stop a client from
 * writing arbitrary totals. See firestore.rules.
 */
import { initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, signInAnonymously, onAuthStateChanged, type Auth } from "firebase/auth";
import {
  getFirestore,
  collection,
  getDocs,
  limit,
  query,
  where,
  doc,
  getDoc,
  setDoc,
  type Firestore,
} from "firebase/firestore";
import type { QueueCollection } from "../shared/offline-sync/SyncQueue";

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const isFirebaseConfigured = Boolean(config.apiKey && config.projectId);

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;

if (isFirebaseConfigured) {
  app = initializeApp(config);
  auth = getAuth(app);
  db = getFirestore(app);
}

let authPromise: Promise<string | null> | null = null;

/** Resolves with the anonymous uid (signing in once if needed), or null. */
export function ensureAnonymousAuth(): Promise<string | null> {
  if (!auth) return Promise.resolve(null);
  if (!authPromise) {
    const a = auth;
    authPromise = new Promise<string | null>((resolve) => {
      const unsubscribe = onAuthStateChanged(a, (user) => {
        unsubscribe();
        if (user) {
          resolve(user.uid);
          return;
        }
        signInAnonymously(a)
          .then((cred) => resolve(cred.user.uid))
          .catch((err) => {
            console.warn("[firebase] anonymous sign-in failed", err);
            authPromise = null; // allow a later retry
            resolve(null);
          });
      });
    });
  }
  return authPromise;
}

/**
 * SyncQueue writer. The idempotency key is the document id; the rules
 * accept a re-write only when the data is identical, so a retry after a
 * lost acknowledgement succeeds without creating a duplicate.
 */
export async function writeQueuedItem(
  collectionName: QueueCollection,
  payload: Record<string, unknown>,
  idempotencyKey: string
): Promise<void> {
  if (!db) throw new Error("Firestore not configured");
  const uid = await ensureAnonymousAuth();
  if (!uid) throw new Error("not signed in");
  await setDoc(doc(db, collectionName, idempotencyKey), payload);
}

// ---------------------------------------------------------------------------
// Community soil map
// ---------------------------------------------------------------------------

export interface SoilScanDoc {
  geoTile: string;
  soilType: string;
  confidence: number;
  modelVersion: string;
  timestamp: number;
}

export interface MapTileSummary {
  geoTile: string;
  lat: number;
  lng: number;
  scanCount: number;
  soilCounts: Record<string, number>;
  dominantSoilType: string;
}

const GEO_TILE_RE = /^-?\d{1,2}\.\d{2},-?\d{1,3}\.\d{2}$/;

/** Rounds to 2 decimals (~1.1 km) so an exact field location is never stored. */
export function toGeoTile(lat: number, lng: number): string {
  return `${lat.toFixed(2)},${lng.toFixed(2)}`;
}

export function parseGeoTile(tile: string): { lat: number; lng: number } | null {
  if (!GEO_TILE_RE.test(tile)) return null;
  const [lat, lng] = tile.split(",").map(Number);
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

/** Pure aggregation of raw scans into per-tile summaries. Exported for tests. */
export function aggregateScans(scans: readonly Pick<SoilScanDoc, "geoTile" | "soilType">[]): MapTileSummary[] {
  const byTile = new Map<string, Record<string, number>>();
  for (const s of scans) {
    if (!parseGeoTile(s.geoTile)) continue;
    const counts = byTile.get(s.geoTile) ?? {};
    counts[s.soilType] = (counts[s.soilType] ?? 0) + 1;
    byTile.set(s.geoTile, counts);
  }
  return Array.from(byTile, ([geoTile, soilCounts]) => {
    const { lat, lng } = parseGeoTile(geoTile)!;
    const entries = Object.entries(soilCounts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return {
      geoTile,
      lat,
      lng,
      soilCounts,
      scanCount: entries.reduce((n, [, c]) => n + c, 0),
      dominantSoilType: entries[0][0],
    };
  });
}

export type Remote<T> = { status: "ok"; data: T } | { status: "not_configured" } | { status: "error"; message: string };

const MAX_SCANS = 2000;

export async function getSoilMapTiles(): Promise<Remote<MapTileSummary[]>> {
  if (!db) return { status: "not_configured" };
  try {
    const snap = await getDocs(query(collection(db, "soilScans"), limit(MAX_SCANS)));
    return { status: "ok", data: aggregateScans(snap.docs.map((d) => d.data() as SoilScanDoc)) };
  } catch (err) {
    return { status: "error", message: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// Ratings (one document per user per target; aggregates computed client-side)
// ---------------------------------------------------------------------------

/** Category of thing being rated. Only community soil tiles exist today. */
export type RatingTargetType = "soilTile";

/** Clients may only write "visible"; moderators set "hidden" from the console. */
export type RatingStatus = "visible" | "hidden";

export const MAX_REVIEW_LENGTH = 500;

export interface RatingDoc {
  targetType: RatingTargetType;
  targetId: string;
  uid: string;
  stars: number;
  review: string;
  status: RatingStatus;
  createdAt: number;
  updatedAt: number;
}

export interface RatingReview {
  id: string;
  stars: number;
  review: string;
  updatedAt: number;
  mine: boolean;
}

export interface RatingSummary {
  average: number;
  count: number;
  latestUpdate: number;
  mine: RatingDoc | null;
  /** Non-empty reviews, newest first. */
  reviews: RatingReview[];
}

export function ratingTargetId(geoTile: string): string {
  return geoTile.replace(",", "_");
}

export function ratingDocId(targetType: RatingTargetType, targetId: string, uid: string): string {
  return `${targetType}_${targetId}_${uid}`;
}

/** Replaces control characters, collapses whitespace, trims and caps the length. */
export function cleanReview(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    out += code < 0x20 || code === 0x7f ? " " : ch;
  }
  return out.replace(/\s+/g, " ").trim().slice(0, MAX_REVIEW_LENGTH);
}

/**
 * Pure aggregation; exported for tests. Skips hidden and malformed
 * documents, so a moderated or forged rating never affects an average.
 */
export function aggregateRatings(
  ratings: readonly (RatingDoc & { id?: string })[],
  myUid: string | null
): Map<string, RatingSummary> {
  const out = new Map<string, { sum: number; summary: RatingSummary }>();
  for (const r of ratings) {
    if (!Number.isInteger(r.stars) || r.stars < 1 || r.stars > 5) continue;
    if (r.status !== "visible") continue;
    const entry = out.get(r.targetId) ?? {
      sum: 0,
      summary: { average: 0, count: 0, latestUpdate: 0, mine: null, reviews: [] },
    };
    const mine = Boolean(myUid && r.uid === myUid);
    entry.sum += r.stars;
    entry.summary.count += 1;
    entry.summary.latestUpdate = Math.max(entry.summary.latestUpdate, r.updatedAt || 0);
    if (mine) entry.summary.mine = r;
    const review = typeof r.review === "string" ? r.review.trim() : "";
    if (review) {
      entry.summary.reviews.push({
        id: r.id ?? ratingDocId(r.targetType, r.targetId, r.uid),
        stars: r.stars,
        review,
        updatedAt: r.updatedAt,
        mine,
      });
    }
    out.set(r.targetId, entry);
  }
  return new Map(
    Array.from(out, ([id, { sum, summary }]): [string, RatingSummary] => {
      summary.average = Math.round((sum / summary.count) * 10) / 10;
      summary.reviews.sort((a, b) => b.updatedAt - a.updatedAt);
      return [id, summary];
    })
  );
}

export async function getRatings(targetType: RatingTargetType): Promise<Remote<Map<string, RatingSummary>>> {
  if (!db) return { status: "not_configured" };
  try {
    const uid = await ensureAnonymousAuth();
    const snap = await getDocs(
      query(collection(db, "ratings"), where("targetType", "==", targetType), where("status", "==", "visible"), limit(5000))
    );
    return {
      status: "ok",
      data: aggregateRatings(
        snap.docs.map((d) => ({ ...(d.data() as RatingDoc), id: d.id })),
        uid
      ),
    };
  } catch (err) {
    return { status: "error", message: err instanceof Error ? err.message : String(err) };
  }
}

/** Builds the document for a create or update of the caller's own rating. Pure; exported for tests. */
export function buildRating(
  input: { targetType: RatingTargetType; targetId: string; uid: string; stars: number; review: string },
  existing: Pick<RatingDoc, "createdAt"> | null,
  now: number
): RatingDoc {
  if (!Number.isInteger(input.stars) || input.stars < 1 || input.stars > 5) {
    throw new Error("stars must be an integer 1-5");
  }
  return {
    targetType: input.targetType,
    targetId: input.targetId,
    uid: input.uid,
    stars: input.stars,
    review: cleanReview(input.review),
    status: "visible",
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

/** Create or update the signed-in user's own rating for a target. */
export async function saveRating(
  targetType: RatingTargetType,
  targetId: string,
  stars: number,
  review: string
): Promise<RatingDoc> {
  if (!db) throw new Error("Firestore not configured");
  const uid = await ensureAnonymousAuth();
  if (!uid) throw new Error("not signed in");
  const ref = doc(db, "ratings", ratingDocId(targetType, targetId, uid));
  const prev = await getDoc(ref);
  const existing = prev.exists() ? (prev.data() as RatingDoc) : null;
  const rating = buildRating({ targetType, targetId, uid, stars, review }, existing, Date.now());
  await setDoc(ref, rating);
  return rating;
}

export type ReportReason = "spam" | "abusive" | "wrong";

/**
 * Flag a rating for moderator review. One report per user per rating
 * (doc id = ratingId_uid); reports are write-only for clients.
 */
export async function reportRating(ratingId: string, reason: ReportReason): Promise<void> {
  if (!db) throw new Error("Firestore not configured");
  const uid = await ensureAnonymousAuth();
  if (!uid) throw new Error("not signed in");
  await setDoc(doc(db, "ratingReports", `${ratingId}_${uid}`), {
    ratingId,
    reporterUid: uid,
    reason,
    createdAt: Date.now(),
  });
}

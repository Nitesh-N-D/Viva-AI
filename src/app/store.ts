/**
 * Persisted app state (this device only). Holds the user's chosen
 * location, active crop and recent scan results. Weather is in-memory and
 * refetched through lib/weather (which has its own cache).
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ModelTask } from "../domain/taxonomy";

export interface AppLocation {
  /** English district name from domain/districts, or null when GPS-only. */
  district: string | null;
  /** Rounded to 2 decimals (~1 km). Never the raw GPS fix. */
  coords: { lat: number; lng: number } | null;
  source: "gps" | "manual";
}

export interface ActiveCrop {
  cropId: string;
  plantedAt: number;
}

export interface RecentScan {
  task: ModelTask;
  labelId: string;
  score: number;
  modelVersion: string;
  at: number;
}

interface AppState {
  location: AppLocation | null;
  activeCrop: ActiveCrop | null;
  recentScans: RecentScan[];
  /** Soil type last chosen or predicted, used to pre-fill crop advice. */
  lastSoil: string | null;
  lastSync: { at: number; synced: number; failed: number } | null;
  setLocation: (loc: AppLocation | null) => void;
  setActiveCrop: (crop: ActiveCrop | null) => void;
  addScan: (scan: RecentScan) => void;
  clearScans: () => void;
  setLastSoil: (soil: string | null) => void;
  setLastSync: (s: { at: number; synced: number; failed: number }) => void;
}

export const MAX_RECENT_SCANS = 10;

export function roundCoord(v: number): number {
  return Math.round(v * 100) / 100;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      location: null,
      activeCrop: null,
      recentScans: [],
      lastSoil: null,
      lastSync: null,
      setLocation: (location) =>
        set({
          location: location && {
            ...location,
            coords: location.coords && { lat: roundCoord(location.coords.lat), lng: roundCoord(location.coords.lng) },
          },
        }),
      setActiveCrop: (activeCrop) => set({ activeCrop }),
      addScan: (scan) => set((s) => ({ recentScans: [scan, ...s.recentScans].slice(0, MAX_RECENT_SCANS) })),
      clearScans: () => set({ recentScans: [] }),
      setLastSoil: (lastSoil) => set({ lastSoil }),
      setLastSync: (lastSync) => set({ lastSync }),
    }),
    { name: "viva-ai:app", version: 1 }
  )
);

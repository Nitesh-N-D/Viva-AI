import { useCallback, useEffect, useState } from "react";
import { getWeather, type WeatherQuery, type WeatherSnapshot } from "../lib/weather";
import type { AppLocation } from "./store";

export function weatherQueryFor(location: AppLocation | null): WeatherQuery | null {
  if (!location) return null;
  if (location.coords) return location.coords;
  if (location.district) return { district: location.district };
  return null;
}

/** Loads weather for the saved location. Never blocks the rest of the app. */
export function useWeather(location: AppLocation | null) {
  const [weather, setWeather] = useState<WeatherSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const q = weatherQueryFor(location);
  const key = q ? JSON.stringify(q) : "";

  const load = useCallback(
    async (force: boolean) => {
      if (!key) return;
      setLoading(true);
      try {
        setWeather(await getWeather(JSON.parse(key) as WeatherQuery, { force }));
      } finally {
        setLoading(false);
      }
    },
    [key]
  );

  useEffect(() => {
    setWeather(null);
    void load(false);
  }, [load]);

  return { weather, loading, refresh: () => load(true) };
}

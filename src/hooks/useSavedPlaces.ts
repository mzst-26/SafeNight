/**
 * useSavedPlaces — Manage saved/favorite destinations locally.
 *
 * Uses AsyncStorage (free, on-device) to persist user's saved places
 * like "Home", "Work", and custom favorites. Zero backend cost.
 *
 * Each saved place stores: id, label, name, lat, lng, address.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = '@safenight_saved_places';

export interface SavedPlace {
  id: string;
  label: string;       // e.g. "Home", "Work", "Gym"
  name: string;        // place name from search
  address?: string;     // secondary text / address
  lat: number;
  lng: number;
  icon: string;         // Ionicons name
  createdAt: string;
}

export interface SaveResult {
  ok: boolean;
  updated?: boolean;
  existingLabel?: string;
}

/** Pre-defined place types with default icons */
export const PLACE_PRESETS: { label: string; icon: string }[] = [
  { label: 'Home', icon: 'home' },
  { label: 'Work', icon: 'briefcase' },
  { label: 'Gym', icon: 'fitness' },
  { label: 'School', icon: 'school' },
];

export function useSavedPlaces() {
  const [places, setPlaces] = useState<SavedPlace[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Load from AsyncStorage on mount
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          setPlaces(JSON.parse(raw));
        }
      } catch {
        // Silently fail — saved places are nice-to-have
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  // Persist to AsyncStorage whenever places change (skip initial load)
  const persist = useCallback(async (updated: SavedPlace[]) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch {
      // Silently fail
    }
  }, []);

  /** Add or update a saved place. If a place with the same label exists, it's replaced.
   *  Prevents saving the same location under multiple labels — returns {ok:false, existingLabel}
   *  in that case.
   */
  const savePlace = useCallback(
    async (place: Omit<SavedPlace, 'id' | 'createdAt'>): Promise<SaveResult> => {
      // small epsilon for lat/lng equality (~5-10 meters)
      const sameLocation = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) =>
        Math.abs(a.lat - b.lat) < 0.00005 && Math.abs(a.lng - b.lng) < 0.00005;

      // check if this location already exists under a different label
      const existingByLocation = places.find((p) => sameLocation(p, place));
      if (existingByLocation && existingByLocation.label.toLowerCase() !== place.label.toLowerCase()) {
        return { ok: false, existingLabel: existingByLocation.label };
      }

      // proceed to add / replace by label
      const filtered = places.filter((p) => p.label.toLowerCase() !== place.label.toLowerCase());
      const newPlace: SavedPlace = {
        ...place,
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        createdAt: new Date().toISOString(),
      };
      const updated = [newPlace, ...filtered];
      setPlaces(updated);
      persist(updated);
      return { ok: true, updated: filtered.length > 0 };
    },
    [places, persist],
  );

  /** Remove a saved place by ID */
  const removePlace = useCallback(
    async (id: string) => {
      setPlaces((prev) => {
        const updated = prev.filter((p) => p.id !== id);
        persist(updated);
        return updated;
      });
    },
    [persist],
  );

  /** Get a saved place by label (e.g. "Home") */
  const getByLabel = useCallback(
    (label: string): SavedPlace | undefined => {
      return places.find((p) => p.label.toLowerCase() === label.toLowerCase());
    },
    [places],
  );

  return {
    places,
    isLoading,
    savePlace,
    removePlace,
    getByLabel,
  };
}

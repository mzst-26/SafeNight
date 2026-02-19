/**
 * useFriendLocations — Poll live contact positions for map display.
 *
 * When enabled, fetches the full contacts list every 10 seconds and
 * extracts lat/lng + name from those who have an active live session.
 * Returns an array of FriendMarker objects ready for the map, plus a
 * manual `checkNow()` function that returns the count found.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { contactsApi } from '../services/userApi';

export interface FriendMarker {
  userId: string;
  name: string;
  lat: number;
  lng: number;
  destinationName?: string;
  /** Breadcrumb trail — actual positions taken so far */
  path?: Array<{ lat: number; lng: number }>;
  /** Full planned route polyline shared at session start */
  routePath?: Array<{ lat: number; lng: number }>;
}

export interface FriendLocationResult {
  friends: FriendMarker[];
  /** Trigger an immediate check; resolves with { found, names } */
  checkNow: () => Promise<{ found: number; names: string[] }>;
}

const POLL_INTERVAL = 15_000; // 15 seconds

/**
 * Remove consecutive duplicate coordinates from a path so that a stationary
 * device (or simulator) with 90 identical GPS fixes doesn't produce an
 * invisible zero-length polyline on the map.
 * Two points are considered duplicates when they round to the same 5dp value
 * (~1 metre precision).
 */
function deduplicatePath(
  raw: Array<{ lat: number; lng: number }>,
): Array<{ lat: number; lng: number }> {
  const result: Array<{ lat: number; lng: number }> = [];
  for (const pt of raw) {
    const prev = result[result.length - 1];
    if (
      prev &&
      Math.round(prev.lat * 1e5) === Math.round(pt.lat * 1e5) &&
      Math.round(prev.lng * 1e5) === Math.round(pt.lng * 1e5)
    ) {
      continue; // skip consecutive duplicate
    }
    result.push(pt);
  }
  return result;
}

export function useFriendLocations(enabled: boolean): FriendLocationResult {
  const [friends, setFriends] = useState<FriendMarker[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const appActiveRef = useRef(true);

  const poll = useCallback(async (): Promise<FriendMarker[]> => {
    // Skip polling when app is backgrounded to save server resources
    if (!appActiveRef.current) return [];
    try {
      const contacts = await contactsApi.getAll();
      const live = contacts
        .filter((c) => c.is_live && c.live_session)
        .map((c) => ({
          userId: c.user.id,
          name: c.user.name || c.nickname || 'Friend',
          lat: c.live_session!.current_lat,
          lng: c.live_session!.current_lng,
          destinationName: c.live_session!.destination_name ?? undefined,
          path: deduplicatePath(
            c.live_session!.path?.map(({ lat, lng }) => ({ lat, lng })) ?? [],
          ),
          routePath: c.live_session!.route_path ?? undefined,
        }));
      setFriends(live);
      return live;
    } catch {
      // Silently fail — friend locations are supplementary
      return [];
    }
  }, []);

  /** Manual one-shot check — returns how many friends are live */
  const checkNow = useCallback(async () => {
    const result = await poll();
    return {
      found: result.length,
      names: result.map((f) => f.name),
    };
  }, [poll]);

  useEffect(() => {
    if (!enabled) {
      setFriends([]);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    // Initial fetch
    poll();

    // Poll at regular intervals
    intervalRef.current = setInterval(poll, POLL_INTERVAL);

    // Pause polling when app is backgrounded
    const sub = AppState.addEventListener('change', (state) => {
      appActiveRef.current = state === 'active';
    });

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      sub.remove();
    };
  }, [enabled, poll]);

  return { friends, checkNow };
}

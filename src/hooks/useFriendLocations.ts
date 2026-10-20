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
  /** Epoch ms of the poll that produced this marker */
  updatedAt?: number;
  /** True when the most recent poll failed and this marker is from an earlier poll */
  stale?: boolean;
}

/**
 * fresh   – a poll succeeded just now
 * stale   – the poll failed; `found`/`names` are the last known result
 * skipped – the app is backgrounded; no request was made. `found` is the
 *           last known count, or null when there has never been a result.
 */
export type FriendCheckStatus = 'fresh' | 'stale' | 'skipped';

export interface FriendLocationResult {
  friends: FriendMarker[];
  /** Trigger an immediate check and resolve with the status, count and names */
  checkNow: () => Promise<{ status: FriendCheckStatus; found: number | null; names: string[] }>;
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
  /** Last successful poll result, kept so a failed or skipped check can report it */
  const lastKnownRef = useRef<FriendMarker[] | null>(null);

  const poll = useCallback(async (): Promise<{
    status: FriendCheckStatus;
    live: FriendMarker[] | null;
  }> => {
    // Skip polling when app is backgrounded to save server resources
    if (!appActiveRef.current) {
      return { status: 'skipped', live: lastKnownRef.current };
    }
    try {
      const contacts = await contactsApi.getAll();
      const updatedAt = Date.now();
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
          updatedAt,
          stale: false,
        }));
      lastKnownRef.current = live;
      setFriends(live);
      return { status: 'fresh', live };
    } catch {
      // Friend locations are supplementary: keep the last markers, flag them stale
      setFriends((prev) => prev.map((f) => ({ ...f, stale: true })));
      return { status: 'stale', live: lastKnownRef.current };
    }
  }, []);

  /** Manual one-shot check: status, count and names; never a fake zero */
  const checkNow = useCallback(async () => {
    const { status, live } = await poll();
    return {
      status,
      found: live ? live.length : null,
      names: live ? live.map((f) => f.name) : [],
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

    // Start from the app's real state: the effect can mount while backgrounded
    appActiveRef.current = AppState.currentState === 'active';

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

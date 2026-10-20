/**
 * useLiveTracking.ts — Live location sharing hook.
 *
 * Handles:
 * 1. Starting a live session when the user navigates
 * 2. Sending location updates every 5s during the session
 * 3. Heartbeat every 15s to keep the session marked as alive
 * 4. Ending the session on arrival / manual stop
 * 5. Session persists if app is closed — only ends via explicit stop or server-side 5-min expiry
 * 6. Registering Expo push token for notifications
 * 7. Watching a contact's live location (polling)
 */

import * as Device from 'expo-device';
import * as Location from 'expo-location';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { liveApi, type LiveSession, type WatchResult } from '../services/userApi';
import { LimitError } from '../types/limitError';

// ─── Push notification setup ─────────────────────────────────────────────────
// expo-notifications crashes on web at import time (localStorage SSR issue),
// so we lazy-load it only on native platforms.
// In Expo Go SDK 53+, the module loads but remote notification features throw.
// We detect Expo Go and skip entirely to avoid the native error log.
let Notifications: typeof import('expo-notifications') | null = null;

if (Platform.OS !== 'web') {
  // Detect Expo Go — push notifications are not supported there in SDK 53+
  let isExpoGo = false;
  try {
    const Constants = require('expo-constants');
    isExpoGo = Constants.default?.appOwnership === 'expo';
  } catch {
    // expo-constants not available — assume not Expo Go
  }

  if (isExpoGo) {
    console.warn('[push] Running in Expo Go — push notifications disabled. Use a development build.');
  } else {
    try {
      const mod = require('expo-notifications');
      if (mod && typeof mod.setNotificationHandler === 'function') {
        mod.setNotificationHandler({
          handleNotification: async () => ({
            shouldShowAlert: true,
            shouldPlaySound: true,
            shouldSetBadge: false,
            shouldShowBanner: true,
            shouldShowList: true,
          }),
        });
        Notifications = mod;
      }
    } catch {
      console.warn('[push] expo-notifications not available. Push disabled.');
      Notifications = null;
    }
  }
}

/** Register for Expo push notifications and return the token */
async function registerForPushNotifications(): Promise<string | null> {
  // Push notifications are not supported on web
  if (Platform.OS === 'web' || !Notifications) return null;

  // Push notifications don't work on simulators
  if (!Device.isDevice) {
    console.log('[push] Push notifications require a physical device');
    return null;
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    console.log('[push] Push notification permission denied');
    return null;
  }

  // Android needs a notification channel
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'SafeNight',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#6366f1',
    });
  }

  const tokenData = await Notifications.getExpoPushTokenAsync({
    projectId: undefined, // Uses the project ID from app.json
  });

  return tokenData.data;
}

// ─── Live tracking hook ──────────────────────────────────────────────────────

const UPLOAD_INTERVAL_MS = 5000;
const MAX_UPLOAD_BACKOFF_MS = 60_000;
const UPLOAD_FAILURE_THRESHOLD = 3;
const UPLOAD_FAILING_MESSAGE = 'Live location updates are failing. Retrying.';
const SESSION_ENDED_MESSAGE = 'Session ended';

interface TrackingHandles {
  watcher: Location.LocationSubscription | null;
  uploadTimer: ReturnType<typeof setTimeout> | null;
  heartbeat: ReturnType<typeof setInterval> | null;
}

/** Stop every watcher and timer owned by a tracking session. Safe to call repeatedly. */
function clearTrackingHandles(handles: { current: TrackingHandles }) {
  handles.current.watcher?.remove();
  if (handles.current.uploadTimer) clearTimeout(handles.current.uploadTimer);
  if (handles.current.heartbeat) clearInterval(handles.current.heartbeat);
  handles.current = { watcher: null, uploadTimer: null, heartbeat: null };
}

/** Delay before the next upload tick after `failures` consecutive failures */
function nextUploadDelay(failures: number): number {
  return Math.min(UPLOAD_INTERVAL_MS * 2 ** failures, MAX_UPLOAD_BACKOFF_MS);
}

interface LiveTrackingState {
  isTracking: boolean;
  session: LiveSession | null;
  pushToken: string | null;
  error: string | null;
  /** True when we're waiting for the user to accept the background location disclosure */
  showBackgroundDisclosure: boolean;
}

export type StartTrackingResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'permission-denied' | 'limit-reached' | 'unavailable';
      message: string;
    };

export function useLiveTracking(isLoggedIn = false) {
  const [state, setState] = useState<LiveTrackingState>({
    isTracking: false,
    session: null,
    pushToken: null,
    error: null,
    showBackgroundDisclosure: false,
  });

  const handles = useRef<TrackingHandles>({ watcher: null, uploadTimer: null, heartbeat: null });
  const trackingActive = useRef(false);
  const pendingStart = useRef<Promise<StartTrackingResult> | null>(null);
  // Bumped by stop and unmount. Each start captures it, so a watcher, upload or
  // restore that began before a stop cannot re-arm or keep running afterwards.
  const trackingGeneration = useRef(0);
  const uploadInFlight = useRef(false);
  const uploadFailures = useRef(0);
  const lastLocation = useRef<{ lat: number; lng: number } | null>(null);
  // Resolves the background-permission gate inside startTracking
  const bgPermResolveRef = useRef<((granted: boolean) => void) | null>(null);

  // Register push token when logged in
  useEffect(() => {
    if (!isLoggedIn) return;
    (async () => {
      try {
        const token = await registerForPushNotifications();
        if (token) {
          setState((s) => ({ ...s, pushToken: token }));
          await liveApi.registerPushToken(token);
        }
      } catch {
        // Silently fail — push is nice-to-have
      }
    })();
  }, [isLoggedIn]);

  /**
   * Start the location watcher, the upload loop and the heartbeat for an
   * existing session. Shared by startTracking and the restore-on-mount path.
   */
  const beginTracking = useCallback(async (generation: number): Promise<boolean> => {
        // Stopped or unmounted before the watcher could start
        if (generation !== trackingGeneration.current) return false;

        // Start watching location
        const watcher = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.High,
            distanceInterval: 10, // Update every 10 meters
            timeInterval: 5000,   // Or every 5 seconds
          },
          (loc) => {
            lastLocation.current = {
              lat: loc.coords.latitude,
              lng: loc.coords.longitude,
            };
          },
        );

        // Stopped or unmounted while the watcher was starting: release it now
        if (generation !== trackingGeneration.current) {
          watcher.remove();
          return false;
        }
        handles.current.watcher = watcher;

        trackingActive.current = true;

        // Send location updates to server every 5 seconds. Each tick is scheduled
        // only after the previous upload settles (no overlap). Failures back off
        // exponentially; 401/403/404 ends the session locally.
        const scheduleNextUpload = (delay: number) => {
          // A tick from a stopped session must not re-arm the loop
          if (generation !== trackingGeneration.current) return;
          handles.current.uploadTimer = setTimeout(uploadTick, delay);
        };
        const uploadTick = async () => {
          handles.current.uploadTimer = null;
          if (uploadInFlight.current || !lastLocation.current) {
            scheduleNextUpload(UPLOAD_INTERVAL_MS);
            return;
          }
          uploadInFlight.current = true;
          try {
            await liveApi.updateLocation(lastLocation.current.lat, lastLocation.current.lng);
            uploadFailures.current = 0;
            setState((s) =>
              s.error === UPLOAD_FAILING_MESSAGE ? { ...s, error: null } : s,
            );
            scheduleNextUpload(UPLOAD_INTERVAL_MS);
          } catch (err: unknown) {
            const status = (err as { status?: number } | null)?.status;
            if (status === 401 || status === 403 || status === 404) {
              // Session is gone on the server: stop everything locally
              clearTrackingHandles(handles);
              trackingActive.current = false;
              setState((s) => ({
                ...s,
                isTracking: false,
                session: null,
                error: SESSION_ENDED_MESSAGE,
              }));
              return;
            }
            uploadFailures.current += 1;
            if (uploadFailures.current >= UPLOAD_FAILURE_THRESHOLD) {
              setState((s) => ({ ...s, error: UPLOAD_FAILING_MESSAGE }));
            }
            scheduleNextUpload(nextUploadDelay(uploadFailures.current));
          } finally {
            uploadInFlight.current = false;
          }
        };
        scheduleNextUpload(UPLOAD_INTERVAL_MS);

        // Send heartbeat every 15 seconds (keeps session alive even if
        // location doesn't change — important for safety use case where
        // user may be stationary)
        handles.current.heartbeat = setInterval(() => {
          liveApi.heartbeat();
        }, 15000);

        return true;
  }, []);

  // Re-send a push token that failed to register, on each app foreground
  useEffect(() => {
    if (!isLoggedIn) return;
    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        liveApi.flushPendingPushToken().catch(() => {});
      }
    });
    return () => sub.remove();
  }, [isLoggedIn]);

  // Restore an existing session when logged in. Tracking resumes (watcher and
  // timers, via beginTracking) only if location permission is already granted;
  // otherwise the session is not reported as tracking.
  useEffect(() => {
    if (!isLoggedIn) return;
    (async () => {
      try {
        const session = await liveApi.getMySession();
        if (!session) return;
        if (trackingActive.current || pendingStart.current) return;

        // Runs through pendingStart like startTracking, so a start requested
        // while the restore is pending reuses it instead of adding a watcher
        const generation = trackingGeneration.current;
        const restore = (async (): Promise<StartTrackingResult> => {
          try {
            const { status } = await Location.getForegroundPermissionsAsync();
            if (status !== 'granted') {
              setState((s) => ({ ...s, isTracking: false }));
              return { ok: false, reason: 'permission-denied', message: 'Location permission required' };
            }

            const fix = await Location.getCurrentPositionAsync({
              accuracy: Location.Accuracy.High,
            });
            lastLocation.current = {
              lat: fix.coords.latitude,
              lng: fix.coords.longitude,
            };
            const started = await beginTracking(generation);
            if (!started) {
              return { ok: false, reason: 'unavailable', message: 'Tracking was stopped' };
            }
            setState((s) => ({ ...s, isTracking: true, session }));
            return { ok: true };
          } catch {
            clearTrackingHandles(handles);
            trackingActive.current = false;
            setState((s) => ({ ...s, isTracking: false }));
            return { ok: false, reason: 'unavailable', message: 'Failed to restore tracking' };
          }
        })();
        const pending = restore.finally(() => {
          pendingStart.current = null;
        });
        pendingStart.current = pending;
        await pending;
      } catch {
        clearTrackingHandles(handles);
        trackingActive.current = false;
        setState((s) => ({ ...s, isTracking: false }));
      }
    })();
  }, [isLoggedIn, beginTracking]);

  // Start live tracking — call this when navigation begins
  const startTracking = useCallback(
    (params: {
      destination_lat?: number;
      destination_lng?: number;
      destination_name?: string;
      /** Planned route polyline — passed through to the live session so contacts can see it */
      route_path?: Array<{ lat: number; lng: number }>;
    }): Promise<StartTrackingResult> => {
      // Never start twice: reuse the active session or the start already in flight
      if (trackingActive.current) return Promise.resolve({ ok: true });
      if (pendingStart.current) return pendingStart.current;

      const generation = trackingGeneration.current;
      const run = (async (): Promise<StartTrackingResult> => {
      try {
        // Get current location
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          const message = 'Location permission required';
          setState((s) => ({ ...s, error: message }));
          return { ok: false, reason: 'permission-denied', message };
        }

        // ── Background location (Android only) ───────────────────────────
        // Google Play requires a prominent in-app disclosure before requesting
        // ACCESS_BACKGROUND_LOCATION. Show our disclosure modal and wait for
        // the user to respond before calling the system prompt.
        if (Platform.OS === 'android') {
          const { status: bgStatus } = await Location.getBackgroundPermissionsAsync();
          if (bgStatus !== 'granted') {
            // Show the prominent disclosure modal and pause until user responds
            const userAllowed = await new Promise<boolean>((resolve) => {
              bgPermResolveRef.current = resolve;
              setState((s) => ({ ...s, showBackgroundDisclosure: true }));
            });

            if (!userAllowed) {
              // User declined the disclosure — block navigation entirely
              const message = 'Background location permission denied.';
              setState((s) => ({ ...s, error: message }));
              return { ok: false, reason: 'permission-denied', message };
            }

            // User accepted disclosure — now show the system permission prompt
            const { status: sysGranted } = await Location.requestBackgroundPermissionsAsync();
            if (sysGranted !== 'granted') {
              // System prompt denied — block navigation
              const message = 'Background location permission denied.';
              setState((s) => ({ ...s, error: message }));
              return { ok: false, reason: 'permission-denied', message };
            }
          }
        }
        // ─────────────────────────────────────────────────────────────────

        const location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });

        const session = await liveApi.start({
          current_lat: location.coords.latitude,
          current_lng: location.coords.longitude,
          ...params,
        });

        lastLocation.current = {
          lat: location.coords.latitude,
          lng: location.coords.longitude,
        };

        const started = await beginTracking(generation);
        if (!started) {
          return { ok: false, reason: 'unavailable', message: 'Tracking was stopped' };
        }
        setState((s) => ({ ...s, isTracking: true, session, error: null }));
        return { ok: true };
      } catch (err: unknown) {
        // Limit errors are handled globally by the LimitReachedModal
        if (err instanceof LimitError) {
          return {
            ok: false,
            reason: 'limit-reached',
            message: 'Live sharing limit reached for your current plan.',
          };
        }
        // Release any watcher/timer started before the failure
        clearTrackingHandles(handles);
        trackingActive.current = false;
        const msg = err instanceof Error ? err.message : 'Failed to start tracking';
        setState((s) => ({ ...s, error: msg }));
        return { ok: false, reason: 'unavailable', message: msg };
      }
      })();

      pendingStart.current = run.finally(() => {
        pendingStart.current = null;
      });
      return pendingStart.current;
    },
    [beginTracking],
  );

  // Stop live tracking — call when navigation ends or user manually stops
  const stopTracking = useCallback(
    async (status: 'completed' | 'cancelled' = 'completed') => {
      try {
        // Invalidate in-flight starts, uploads and restores before clearing timers
        trackingGeneration.current += 1;
        // Stop location watching
        clearTrackingHandles(handles);
        trackingActive.current = false;
        uploadFailures.current = 0;

        await liveApi.end(status);
        setState((s) => ({
          ...s,
          isTracking: false,
          session: null,
          error: null,
        }));
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to stop tracking';
        setState((s) => ({ ...s, error: msg }));
      }
    },
    [],
  );

  // Clean up on unmount
  useEffect(() => {
    return () => {
      trackingGeneration.current += 1;
      clearTrackingHandles(handles);
      trackingActive.current = false;
    };
  }, []);

  // ── Session persistence on app close ──
  // The live session is NOT cancelled when the app goes to background or is
  // closed. It stays active on the server so contacts can still see the last
  // known location. The server-side stale-session cleanup (EXPIRE_THRESHOLD_S
  // = 5 min) will automatically expire the session if no heartbeat arrives.
  // The session is only ended explicitly when the user stops navigation.

  return {
    ...state,
    startTracking,
    stopTracking,
    /** Called when the user taps "Allow" on the background location disclosure modal */
    confirmBackgroundPermission: useCallback(() => {
      setState((s) => ({ ...s, showBackgroundDisclosure: false }));
      bgPermResolveRef.current?.(true);
      bgPermResolveRef.current = null;
    }, []),
    /** Called when the user taps "Not Now" on the background location disclosure modal */
    denyBackgroundPermission: useCallback(() => {
      setState((s) => ({ ...s, showBackgroundDisclosure: false }));
      bgPermResolveRef.current?.(false);
      bgPermResolveRef.current = null;
    }, []),
  };
}

// ─── Watch a contact's live location ─────────────────────────────────────────

interface WatchState {
  active: boolean;
  data: WatchResult | null;
  isLoading: boolean;
  error: string | null;
}

/**
 * Poll a contact's live location every 5 seconds.
 * Pass the contact's user ID. Returns their location or inactive status.
 */
export function useWatchContact(userId: string | null) {
  const [state, setState] = useState<WatchState>({
    active: false,
    data: null,
    isLoading: true,
    error: null,
  });

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!userId) {
      setState({ active: false, data: null, isLoading: false, error: null });
      return;
    }

    // Set when userId changes or the component unmounts, so an in-flight poll
    // for a previous contact cannot overwrite the current state
    let cancelled = false;

    const poll = async () => {
      try {
        const result = await liveApi.watchContact(userId);
        if (cancelled) return;
        setState({
          active: result.active,
          data: result,
          isLoading: false,
          error: null,
        });
      } catch (err: unknown) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : 'Failed to watch';
        // Do not keep showing the last location once a poll has failed
        setState({ active: false, data: null, isLoading: false, error: msg });
      }
    };

    // Initial fetch
    poll();

    // Poll every 5 seconds
    intervalRef.current = setInterval(poll, 5000);

    return () => {
      cancelled = true;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [userId]);

  return state;
}

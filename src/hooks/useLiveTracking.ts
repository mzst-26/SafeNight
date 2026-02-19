/**
 * useLiveTracking.ts — Live location sharing hook.
 *
 * Handles:
 * 1. Starting a live session when the user navigates
 * 2. Sending location updates every 5s during the session
 * 3. Heartbeat every 15s to keep the session marked as alive
 * 4. Ending the session on arrival / manual stop
 * 5. Best-effort session end on app close (beforeunload / AppState)
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

  const locationSubscription = useRef<Location.LocationSubscription | null>(null);
  const updateInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const heartbeatInterval = useRef<ReturnType<typeof setInterval> | null>(null);
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

  // Check for existing session when logged in
  useEffect(() => {
    if (!isLoggedIn) return;
    (async () => {
      try {
        const session = await liveApi.getMySession();
        if (session) {
          setState((s) => ({ ...s, isTracking: true, session }));
        }
      } catch {
        // Ignore
      }
    })();
  }, [isLoggedIn]);

  // Start live tracking — call this when navigation begins
  const startTracking = useCallback(
    async (params: {
      destination_lat?: number;
      destination_lng?: number;
      destination_name?: string;
    }): Promise<StartTrackingResult> => {
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

        setState((s) => ({ ...s, isTracking: true, session, error: null }));
        lastLocation.current = {
          lat: location.coords.latitude,
          lng: location.coords.longitude,
        };

        // Start watching location
        locationSubscription.current = await Location.watchPositionAsync(
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

        // Send location updates to server every 5 seconds
        updateInterval.current = setInterval(async () => {
          if (lastLocation.current) {
            await liveApi.updateLocation(
              lastLocation.current.lat,
              lastLocation.current.lng,
            );
          }
        }, 5000);

        // Send heartbeat every 15 seconds (keeps session alive even if
        // location doesn't change — important for safety use case where
        // user may be stationary)
        heartbeatInterval.current = setInterval(() => {
          liveApi.heartbeat();
        }, 15000);

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
        const msg = err instanceof Error ? err.message : 'Failed to start tracking';
        setState((s) => ({ ...s, error: msg }));
        return { ok: false, reason: 'unavailable', message: msg };
      }
    },
    [],
  );

  // Stop live tracking — call when navigation ends or user manually stops
  const stopTracking = useCallback(
    async (status: 'completed' | 'cancelled' = 'completed') => {
      try {
        // Stop location watching
        if (locationSubscription.current) {
          locationSubscription.current.remove();
          locationSubscription.current = null;
        }
        if (updateInterval.current) {
          clearInterval(updateInterval.current);
          updateInterval.current = null;
        }
        if (heartbeatInterval.current) {
          clearInterval(heartbeatInterval.current);
          heartbeatInterval.current = null;
        }

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
      if (locationSubscription.current) {
        locationSubscription.current.remove();
      }
      if (updateInterval.current) {
        clearInterval(updateInterval.current);
      }
      if (heartbeatInterval.current) {
        clearInterval(heartbeatInterval.current);
      }
    };
  }, []);

  // ── Best-effort session end when app closes / goes to background ──
  // Web: beforeunload + pagehide → sendBeacon (survives tab close)
  // Native: AppState → attempt async end when backgrounded
  useEffect(() => {
    if (Platform.OS === 'web') {
      const handleUnload = () => {
        if (state.isTracking) {
          liveApi.endSync('cancelled');
        }
      };

      // pagehide fires more reliably on mobile Safari than beforeunload
      window.addEventListener('beforeunload', handleUnload);
      window.addEventListener('pagehide', handleUnload);

      return () => {
        window.removeEventListener('beforeunload', handleUnload);
        window.removeEventListener('pagehide', handleUnload);
      };
    } else {
      // Native: attempt to end session when app goes to background
      const sub = AppState.addEventListener('change', (nextState) => {
        if (nextState === 'background' && state.isTracking) {
          // Fire-and-forget — the backend staleness cleanup is the
          // real safety net; this is just a best-effort shortcut.
          liveApi.end('cancelled').catch(() => {});
        }
      });

      return () => sub.remove();
    }
  }, [state.isTracking]);

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

    const poll = async () => {
      try {
        const result = await liveApi.watchContact(userId);
        setState({
          active: result.active,
          data: result,
          isLoading: false,
          error: null,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to watch';
        setState((s) => ({ ...s, isLoading: false, error: msg }));
      }
    };

    // Initial fetch
    poll();

    // Poll every 5 seconds
    intervalRef.current = setInterval(poll, 5000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [userId]);

  return state;
}

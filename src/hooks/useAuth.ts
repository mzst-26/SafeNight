/**
 * useAuth.ts — Authentication hook.
 *
 * Manages magic link login flow, session state, and profile sync.
 * Tracks app version on every login/profile load.
 *
 * Session handling:
 * - Listens for session events (expired / refreshed) from userApi
 * - Proactively refreshes tokens before expiry
 * - Revalidates session on app foreground (phone) / tab focus (web)
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import {
  authApi,
  contactsApi,
  getTokenExpiresAt,
  onSessionChange,
  refreshIfNeeded,
  usageApi,
} from '../services/userApi';

// Read app version from app.json (bundled at build time via expo-constants)
let APP_VERSION = '1.0.0';
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Constants = require('expo-constants');
  APP_VERSION = Constants.default?.expoConfig?.version ?? '1.0.0';
} catch {
  // Fallback
}

/** Detect network vs server errors and return a friendly message */
function isNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const m = err.message.toLowerCase();
  return (
    m.includes('network request failed') ||
    m.includes('failed to fetch') ||
    m.includes('econnrefused') ||
    m.includes('networkerror') ||
    m.includes('load failed') ||
    m.includes('timeout')
  );
}

function friendlyError(err: unknown, action: 'send' | 'verify'): string {
  if (isNetworkError(err)) return 'Server is down. Try again in a bit.';
  // Pass through rate limit errors with the seconds so the UI can show a countdown
  if (err instanceof Error && err.message.startsWith('RATE_LIMIT:')) return err.message;
  if (action === 'verify') return 'Invalid or expired code. Try again.';
  return 'Something went wrong. Give it another go.';
}

interface AuthState {
  isLoggedIn: boolean;
  isLoading: boolean;
  profileFetchFailed: boolean; // true when session is valid but profile can't be loaded
  user: {
    id: string;
    email: string;
    name: string;
    username: string | null;
    platform: string;
    app_version: string;
    disclaimer_accepted_at: string | null;
    subscription: string; // free, pro
    routeDistanceKm: number; // DB-driven max route distance
    isGift: boolean; // whether subscription is a gift
    giftEndDate: string | null; // ISO date when gift expires
    subscriptionEndsAt: string | null; // ISO date when subscription ends (gift or paid)
  } | null;
  error: string | null;
}

// ─── Shared session loader (prevents duplicate network calls) ────────────────
// Multiple useAuth() instances mount concurrently. Without de-duplication each
// one fires /refresh + /me + /update-profile, burning through the rate limit.
let _sharedLoadPromise: Promise<AuthState> | null = null;
let _sharedLoadTs = 0;
const DEDUP_WINDOW_MS = 3_000; // collapse requests within 3 s

async function _loadSessionOnce(
  scheduleRefresh: () => Promise<void>,
): Promise<AuthState> {
  const loggedIn = await authApi.isLoggedIn();
  if (!loggedIn) {
    return { isLoggedIn: false, isLoading: false, profileFetchFailed: false, user: null, error: null };
  }

  const tokenOk = await refreshIfNeeded();
  if (!tokenOk) {
    return { isLoggedIn: false, isLoading: false, profileFetchFailed: false, user: null, error: null };
  }

  const profile = await authApi.getProfile();
  if (!profile) {
    // Profile fetch failed — flag it so the UI shows a message and auto-logouts
    console.warn('[auth] Profile fetch failed with valid session — will auto-logout');
    return {
      isLoggedIn: true,
      isLoading: false,
      profileFetchFailed: true,
      user: null,
      error: null,
    };
  }

  // Sync version + platform (fire-and-forget)
  const platform = Platform.OS;
  if (profile.app_version !== APP_VERSION || profile.platform !== platform) {
    authApi.updateProfile({ app_version: APP_VERSION, platform });
  }

  // Track app open (fire-and-forget)
  usageApi.track('app_open', null, APP_VERSION);

  scheduleRefresh();

  return {
    isLoggedIn: true,
    isLoading: false,
    profileFetchFailed: false,
    user: {
      id: profile.id,
      email: profile.email,
      name: profile.name,
      username: profile.username ?? null,
      platform: profile.platform,
      app_version: profile.app_version,
      disclaimer_accepted_at: profile.disclaimer_accepted_at ?? null,
      subscription: profile.subscription_details?.tier ?? profile.subscription ?? 'free',
      routeDistanceKm: profile.route_distance_km ?? 1, // DB-driven, fallback to free tier
      isGift: profile.is_gift ?? false,
      giftEndDate: profile.gift_end_date ?? null,
      subscriptionEndsAt: profile.subscription_ends_at ?? null,
    },
    error: null,
  };
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    isLoggedIn: false,
    isLoading: true,
    profileFetchFailed: false,
    user: null,
    error: null,
  });

  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── Schedule proactive token refresh ──────────────────────────────────────

  const scheduleRefresh = useCallback(async () => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);

    const expiresAt = await getTokenExpiresAt();
    if (!expiresAt) return;

    // Refresh 2 minutes before expiry, minimum 10s from now
    const refreshIn = Math.max(expiresAt - Date.now() - 2 * 60 * 1000, 10_000);

    refreshTimerRef.current = setTimeout(async () => {
      const ok = await refreshIfNeeded();
      if (ok) {
        scheduleRefresh(); // re-schedule after successful refresh
      }
      // If not ok, the session event listener below handles logout
    }, refreshIn);
  }, []);

  // ─── Load session (de-duplicated across all instances) ─────────────────────

  const loadSession = useCallback(async () => {
    try {
      const now = Date.now();
      // Re-use the in-flight promise if still fresh
      if (_sharedLoadPromise && now - _sharedLoadTs < DEDUP_WINDOW_MS) {
        const result = await _sharedLoadPromise;
        setState(result);
        return;
      }

      _sharedLoadTs = now;
      _sharedLoadPromise = _loadSessionOnce(scheduleRefresh);

      const result = await _sharedLoadPromise;
      setState(result);
    } catch {
      setState((s) => ({ ...s, isLoading: false }));
    }
  }, [scheduleRefresh]);

  useEffect(() => {
    loadSession();
  }, [loadSession]);

  // ─── Auto-logout when profile fetch fails ──────────────────────────────────
  // If the session is valid but we can't load profile data, give the user
  // 3 seconds to read the message then force a logout. No user interaction.

  useEffect(() => {
    if (!state.profileFetchFailed) return;

    const timer = setTimeout(async () => {
      console.warn('[auth] Auto-logout triggered — profile could not be loaded');
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      await authApi.logout();
      setState({
        isLoggedIn: false,
        isLoading: false,
        profileFetchFailed: false,
        user: null,
        error: null,
      });
    }, 3_000);

    return () => clearTimeout(timer);
  }, [state.profileFetchFailed]);

  // ─── Listen for session events from userApi ────────────────────────────────

  useEffect(() => {
    const unsub = onSessionChange((event) => {
      if (event === 'expired' || event === 'logged_out') {
        if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
        setState({ isLoggedIn: false, isLoading: false, profileFetchFailed: false, user: null, error: null });
      } else if (event === 'refreshed') {
        // Token was auto-refreshed — re-schedule next refresh
        scheduleRefresh();
      } else if (event === 'logged_in') {
        // Another useAuth instance (e.g. _layout) completed login —
        // re-load session from storage so this instance syncs up
        loadSession();
      }
    });
    return unsub;
  }, [scheduleRefresh, loadSession]);

  // ─── Revalidate on app foreground (phone) / tab focus (web) ────────────────

  useEffect(() => {
    if (Platform.OS === 'web') {
      // Web: listen for tab visibility changes
      const handleVisibility = () => {
        if (document.visibilityState === 'visible') {
          refreshIfNeeded().then((ok) => {
            if (!ok) {
              // Session expired while tab was hidden — handled by event
            } else {
              scheduleRefresh();
            }
          });
        }
      };
      document.addEventListener('visibilitychange', handleVisibility);
      return () => document.removeEventListener('visibilitychange', handleVisibility);
    } else {
      // Native: listen for app coming to foreground
      const sub = AppState.addEventListener('change', (nextState) => {
        if (nextState === 'active') {
          refreshIfNeeded().then((ok) => {
            if (ok) scheduleRefresh();
          });
        }
      });
      return () => sub.remove();
    }
  }, [scheduleRefresh]);

  // ─── Cleanup ───────────────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, []);

  // ─── Auth actions ──────────────────────────────────────────────────────────

  const sendMagicLink = useCallback(async (email: string, name: string) => {
    setState((s) => ({ ...s, error: null, isLoading: true }));
    try {
      await authApi.sendMagicLink(email, name);
      setState((s) => ({ ...s, isLoading: false }));
      return true;
    } catch (err: unknown) {
      const msg = friendlyError(err, 'send');
      setState((s) => ({ ...s, error: msg, isLoading: false }));
      return false;
    }
  }, []);

  const verify = useCallback(async (email: string, token: string) => {
    setState((s) => ({ ...s, error: null, isLoading: true }));
    try {
      const data = await authApi.verify(email, token);

      // Fetch full profile
      const profile = await authApi.getProfile();

      setState({
        isLoggedIn: true,
        isLoading: false,
        profileFetchFailed: false,
        user: profile
          ? {
              id: profile.id,
              email: profile.email,
              name: profile.name,
              username: profile.username ?? null,
              platform: profile.platform,
              app_version: profile.app_version,
              disclaimer_accepted_at: profile.disclaimer_accepted_at ?? null,
              subscription: profile.subscription_details?.tier ?? profile.subscription ?? 'free',
              routeDistanceKm: profile.route_distance_km ?? 1,
              isGift: profile.is_gift ?? false,
              giftEndDate: profile.gift_end_date ?? null,
              subscriptionEndsAt: profile.subscription_ends_at ?? null,
            }
          : {
              id: data.user.id,
              email: data.user.email,
              name: '',
              username: null,
              platform: Platform.OS,
              app_version: APP_VERSION,
              disclaimer_accepted_at: null,
              subscription: 'free',
              routeDistanceKm: 1,
              isGift: false,
              giftEndDate: null,
              subscriptionEndsAt: null,
            },
        error: null,
      });

      // Sync version + platform
      authApi.updateProfile({
        app_version: APP_VERSION,
        platform: Platform.OS,
      });

      // Track app open
      usageApi.track('app_open', null, APP_VERSION);

      // Schedule proactive token refresh
      scheduleRefresh();

      return true;
    } catch (err: unknown) {
      const msg = friendlyError(err, 'verify');
      setState((s) => ({ ...s, error: msg, isLoading: false }));
      return false;
    }
  }, [scheduleRefresh]);

  const logout = useCallback(async () => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    await authApi.logout();
    setState({
      isLoggedIn: false,
      isLoading: false,
      profileFetchFailed: false,
      user: null,
      error: null,
    });
  }, []);

  const updateName = useCallback(async (name: string): Promise<boolean> => {
    try {
      await authApi.updateProfile({ name });
      setState((s) =>
        s.user ? { ...s, user: { ...s.user, name } } : s,
      );
      return true;
    } catch (err) {
      console.error('[auth] updateName error:', err);
      return false;
    }
  }, []);

  const updateUsername = useCallback(async (username: string) => {
    try {
      await contactsApi.setUsername(username);
      setState((s) =>
        s.user ? { ...s, user: { ...s.user, username } } : s,
      );
      return true;
    } catch {
      return false;
    }
  }, []);

  const acceptDisclaimer = useCallback(async () => {
    try {
      const result = await authApi.acceptDisclaimer();
      setState((s) =>
        s.user
          ? { ...s, user: { ...s.user, disclaimer_accepted_at: result.accepted_at } }
          : s,
      );
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to accept disclaimer';
      setState((s) => ({ ...s, error: msg }));
      console.error('[auth] Disclaimer accept error:', err);
      throw err;
    }
  }, []);

  /** Re-fetch the profile from the server and update local state.
   *  Call this after profile mutations (name, username) to ensure
   *  all hooks see the latest DB data. */
  const refreshProfile = useCallback(async () => {
    try {
      const profile = await authApi.getProfile();
      if (!profile) return;
      setState((s) => ({
        ...s,
        isLoggedIn: true,
        user: {
          id: profile.id,
          email: profile.email,
          name: profile.name,
          username: profile.username ?? null,
          platform: profile.platform,
          app_version: profile.app_version,
          disclaimer_accepted_at: profile.disclaimer_accepted_at ?? null,
          subscription: profile.subscription_details?.tier ?? profile.subscription ?? 'free',
          routeDistanceKm: profile.route_distance_km ?? 1,
          isGift: profile.is_gift ?? false,
          giftEndDate: profile.gift_end_date ?? null,
          subscriptionEndsAt: profile.subscription_ends_at ?? null,
        },
      }));
    } catch {
      // Silent fail — optimistic state is still fine
    }
  }, []);

  return {
    ...state,
    sendMagicLink,
    verify,
    logout,
    updateName,
    updateUsername,
    acceptDisclaimer,
    refreshProfile,
  };
}

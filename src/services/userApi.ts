/**
 * userApi.ts — Frontend client for the User Data Service.
 *
 * All Supabase keys stay server-side. The app talks to our
 * Express user-service which proxies to Supabase.
 *
 * Auth tokens are stored in AsyncStorage and attached to every request.
 * Includes a session event system so hooks can react to expiry/refresh.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { env } from '../config/env';
import { emitLimitReached, LimitError, parseLimitResponse } from '../types/limitError';

const BASE = env.userApiUrl;

const AUTH_KEYS = {
  accessToken: 'safenight_access_token',
  refreshToken: 'safenight_refresh_token',
  userId: 'safenight_user_id',
  userEmail: 'safenight_user_email',
  expiresAt: 'safenight_expires_at',
};

// ─── Session event system ────────────────────────────────────────────────────

export type SessionEvent = 'expired' | 'refreshed' | 'logged_in' | 'logged_out';
type SessionListener = (event: SessionEvent) => void;
const sessionListeners = new Set<SessionListener>();

/** Subscribe to session lifecycle events. Returns unsubscribe fn. */
export function onSessionChange(listener: SessionListener): () => void {
  sessionListeners.add(listener);
  return () => { sessionListeners.delete(listener); };
}

function emitSessionEvent(event: SessionEvent) {
  sessionListeners.forEach((fn) => fn(event));
}

// ─── Token management ────────────────────────────────────────────────────────

async function getAccessToken(): Promise<string | null> {
  const token = await AsyncStorage.getItem(AUTH_KEYS.accessToken);
  // Cache for sendBeacon (synchronous unload handler)
  if (token) (globalThis as any).__safenight_access_token = token;
  return token;
}

async function storeSession(session: {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  user?: { id: string; email: string };
}): Promise<void> {
  const pairs: [string, string][] = [
    [AUTH_KEYS.accessToken, session.access_token],
    [AUTH_KEYS.refreshToken, session.refresh_token],
  ];

  // Store expiry time so we can proactively refresh
  if (session.expires_in) {
    const expiresAt = Date.now() + session.expires_in * 1000;
    pairs.push([AUTH_KEYS.expiresAt, String(expiresAt)]);
  }

  if (session.user) {
    pairs.push(
      [AUTH_KEYS.userId, session.user.id],
      [AUTH_KEYS.userEmail, session.user.email],
    );
  }

  await AsyncStorage.multiSet(pairs);
}

async function clearSession(): Promise<void> {
  await AsyncStorage.multiRemove(Object.values(AUTH_KEYS));
}

/** Returns epoch ms when the current access token expires, or null */
export async function getTokenExpiresAt(): Promise<number | null> {
  const v = await AsyncStorage.getItem(AUTH_KEYS.expiresAt);
  return v ? Number(v) : null;
}

// ─── Proactive refresh helper ────────────────────────────────────────────────

/** Refresh the token if it expires within `bufferMs` (default 2 min). */
export async function refreshIfNeeded(bufferMs = 2 * 60 * 1000): Promise<boolean> {
  const expiresAt = await getTokenExpiresAt();
  const token = await getAccessToken();

  // No token at all — not logged in
  if (!token) return false;

  // No stored expiry but we have a token — assume still valid
  // (can happen if session was stored before expiry tracking was added)
  if (!expiresAt) return true;

  if (Date.now() + bufferMs < expiresAt) return true;  // still fresh

  const refreshToken = await AsyncStorage.getItem(AUTH_KEYS.refreshToken);
  if (!refreshToken) {
    // No refresh token — check if access token is actually expired
    if (Date.now() < expiresAt) return true; // token still valid, just can't refresh
    await clearSession();
    emitSessionEvent('expired');
    return false;
  }

  try {
    const res = await fetch(`${BASE}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });

    if (res.ok) {
      const data = await res.json();
      await storeSession(data);
      emitSessionEvent('refreshed');
      return true;
    }
  } catch {
    // Network error — if the token hasn't actually expired yet, stay logged in
    if (Date.now() < expiresAt) return true;
    return false;
  }

  // Refresh failed with a 4xx — check if access token is still usable
  if (Date.now() < expiresAt) return true;

  // Token is truly expired and refresh failed — session is dead
  await clearSession();
  emitSessionEvent('expired');
  return false;
}

// ─── HTTP helpers ────────────────────────────────────────────────────────────

// React Native (OkHttp on Android) has NO default response timeout.
// Render.com free-tier cold starts can take 30-60s.
// Without this, fetch() can hang forever on Android.
const DEFAULT_TIMEOUT_MS = 20_000; // 20 seconds

function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeout?: number } = {},
): Promise<Response> {
  const { timeout = DEFAULT_TIMEOUT_MS, ...fetchOptions } = options;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort('Request timed out'), timeout);

  return fetch(url, { ...fetchOptions, signal: controller.signal }).finally(() =>
    clearTimeout(timeoutId),
  );
}

async function authFetch(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const token = await getAccessToken();

  const res = await fetchWithTimeout(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });

  // If 401, try refreshing the token once
  if (res.status === 401 && token) {
    const refreshToken = await AsyncStorage.getItem(AUTH_KEYS.refreshToken);
    if (refreshToken) {
      const refreshRes = await fetchWithTimeout(`${BASE}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });

      if (refreshRes.ok) {
        const data = await refreshRes.json();
        await storeSession(data);
        emitSessionEvent('refreshed');

        // Retry original request with new token
        return fetchWithTimeout(`${BASE}${path}`, {
          ...options,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${data.access_token}`,
            ...(options.headers || {}),
          },
        });
      } else {
        // Refresh failed — clear session and notify listeners
        await clearSession();
        emitSessionEvent('expired');
      }
    } else {
      // No refresh token — session is dead
      await clearSession();
      emitSessionEvent('expired');
    }
  }

  return res;
}

// ─── Auth API ────────────────────────────────────────────────────────────────

export const authApi = {
  /** Check whether email has an existing account and available auth methods */
  async getAuthOptions(email: string): Promise<{
    email: string;
    exists: boolean;
    methods: Array<'otp' | 'password'>;
    default_method: 'otp';
  }> {
    const res = await fetchWithTimeout(`${BASE}/api/auth/options`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
      timeout: 8_000, // short timeout — we fall back to OTP if this is slow
    });
    if (!res.ok) {
      if (res.status === 429) {
        const body = await res.json().catch(() => ({ retry_after: 900 }));
        throw new Error(`RATE_LIMIT:${body.retry_after || 900}`);
      }
      const err = await res.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(err.error || 'Failed to check account');
    }
    return res.json();
  },

  /** Send magic link email */
  async sendMagicLink(email: string, name: string): Promise<{ message: string }> {
    const res = await fetchWithTimeout(`${BASE}/api/auth/magic-link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, name }),
    });
    if (!res.ok) {
      if (res.status === 429) {
        const body = await res.json().catch(() => ({ retry_after: 900 }));
        throw new Error(`RATE_LIMIT:${body.retry_after || 900}`);
      }
      const err = await res.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(err.error || 'Failed to send magic link');
    }
    return res.json();
  },

  /** Sign in with email + password (existing users only) */
  async signInWithPassword(
    email: string,
    password: string,
  ): Promise<{ access_token: string; user: { id: string; email: string } }> {
    const res = await fetchWithTimeout(`${BASE}/api/auth/password-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      if (res.status === 429) {
        const body = await res.json().catch(() => ({ retry_after: 900 }));
        if (body.locked_out) throw new Error('LOCKED_OUT');
        throw new Error(`RATE_LIMIT:${body.retry_after || 900}`);
      }
      const err = await res.json().catch(() => ({ error: 'Login failed' }));
      if (err.locked_out) throw new Error('LOCKED_OUT');
      throw new Error(err.error || 'Invalid email or password');
    }
    const data = await res.json();
    await storeSession(data);
    emitSessionEvent('logged_in');
    return data;
  },

  /** Send forgot-password email (Supabase built-in email template) */
  async forgotPassword(email: string): Promise<{ message: string }> {
    const res = await fetchWithTimeout(`${BASE}/api/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    if (!res.ok) {
      if (res.status === 429) {
        const body = await res.json().catch(() => ({ retry_after: 900 }));
        throw new Error(`RATE_LIMIT:${body.retry_after || 900}`);
      }
      const err = await res.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(err.error || 'Failed to send password reset email');
    }
    return res.json();
  },

  /**
   * Update the current user's password.
   * Requires a valid session JWT (either normal login or recovery token from email).
   * The JWT is attached automatically by authFetch — never sent from the UI.
   */
  async updatePassword(newPassword: string): Promise<{ message: string }> {
    const res = await authFetch('/api/auth/update-password', {
      method: 'POST',
      body: JSON.stringify({ password: newPassword }),
    });
    if (!res.ok) {
      if (res.status === 429) {
        const body = await res.json().catch(() => ({ retry_after: 900 }));
        throw new Error(`RATE_LIMIT:${body.retry_after || 900}`);
      }
      const err = await res.json().catch(() => ({ error: 'Failed to update password' }));
      throw new Error(err.error || 'Failed to update password');
    }
    return res.json();
  },

  /**
   * Store a Supabase recovery session received from the password-reset email
   * deep link. This makes the access token available to authFetch so that
   * updatePassword() can be called without requiring a separate login.
   */
  async storeRecoverySession(
    accessToken: string,
    refreshToken: string,
    expiresIn?: number,
  ): Promise<void> {
    await storeSession({
      access_token: accessToken,
      refresh_token: refreshToken,
      ...(expiresIn ? { expires_in: expiresIn } : {}),
    });
    emitSessionEvent('logged_in');
  },

  /** Verify OTP token from magic link */
  async verify(
    email: string,
    token: string,
  ): Promise<{ access_token: string; user: { id: string; email: string } }> {
    const res = await fetchWithTimeout(`${BASE}/api/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, token }),
    });
    if (!res.ok) {
      if (res.status === 429) {
        const body = await res.json().catch(() => ({ retry_after: 900 }));
        throw new Error(`RATE_LIMIT:${body.retry_after || 900}`);
      }
      const err = await res.json().catch(() => ({ error: 'Verification failed' }));
      throw new Error(err.error || 'Invalid or expired token');
    }
    const data = await res.json();
    await storeSession(data);
    emitSessionEvent('logged_in');
    return data;
  },

  /** Get current user profile (retries once on network error) */
  async getProfile(): Promise<{
    id: string;
    name: string;
    username: string | null;
    email: string;
    platform: string;
    app_version: string;
    disclaimer_accepted_at: string | null;
    subscription: string;
    subscription_details?: { tier: string; status: string };
    route_distance_km?: number;
    is_gift?: boolean;
    gift_end_date?: string | null;
    subscription_ends_at?: string | null;
    is_family_pack?: boolean;
    family_pack_id?: string | null;
    created_at: string;
    last_seen_at: string;
  } | null> {
    const token = await getAccessToken();
    if (!token) return null;

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await authFetch('/api/auth/me');
        if (res.ok) return res.json();
        if (res.status === 401) return null; // genuinely unauthorized
        // Server error (5xx) — retry once
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, 1500));
          continue;
        }
      } catch {
        // Network error — retry once
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, 1500));
          continue;
        }
      }
    }
    return null;
  },

  /** Update profile (name, username, platform, app_version, push_token) */
  async updateProfile(updates: {
    name?: string;
    username?: string;
    platform?: string;
    app_version?: string;
    push_token?: string;
  }): Promise<void> {
    await authFetch('/api/auth/update-profile', {
      method: 'POST',
      body: JSON.stringify(updates),
    });
  },

  /** Accept safety disclaimer */
  async acceptDisclaimer(): Promise<{ accepted_at: string }> {
    const res = await authFetch('/api/auth/accept-disclaimer', {
      method: 'POST',
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(err.error || 'Failed to accept disclaimer');
    }
    return res.json();
  },

  /** Log out */
  async logout(): Promise<void> {
    try {
      await authFetch('/api/auth/logout', { method: 'POST' });
    } finally {
      await clearSession();
      emitSessionEvent('logged_out');
    }
  },

  /** Permanently delete account and all data (Google Play compliance) */
  async deleteAccount(): Promise<void> {
    const res = await authFetch('/api/auth/account', { method: 'DELETE' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Delete failed' }));
      throw new Error(err.error || 'Failed to delete account');
    }
    await clearSession();
    emitSessionEvent('logged_out');
  },

  /** Check if user is logged in (has stored token) */
  async isLoggedIn(): Promise<boolean> {
    const token = await getAccessToken();
    return !!token;
  },

  /** Get stored user info without a network call */
  async getStoredUser(): Promise<{ id: string; email: string } | null> {
    const [id, email] = await AsyncStorage.multiGet([
      AUTH_KEYS.userId,
      AUTH_KEYS.userEmail,
    ]);
    if (id[1] && email[1]) return { id: id[1], email: email[1] };
    return null;
  },
};

// ─── Usage API ───────────────────────────────────────────────────────────────

export const usageApi = {
  /** Track a usage event */
  async track(
    event_type: string,
    value_num?: number | null,
    value_text?: string | null,
  ): Promise<void> {
    try {
      await authFetch('/api/usage/track', {
        method: 'POST',
        body: JSON.stringify({ event_type, value_num, value_text }),
      });
    } catch {
      // Silently fail — usage tracking should never block the user
    }
  },

  /** Get aggregated stats */
  async getStats(): Promise<{
    total_app_opens: number;
    total_route_searches: number;
    total_navigations_started: number;
    total_navigations_completed: number;
    total_navigations_abandoned: number;
    total_distance_km: number;
    completion_rate: number;
  }> {
    const res = await authFetch('/api/usage/stats');
    if (!res.ok) throw new Error('Failed to fetch stats');
    return res.json();
  },

  /** Get recent event history */
  async getHistory(): Promise<
    Array<{
      id: string;
      event_type: string;
      value_num: number | null;
      value_text: string | null;
      created_at: string;
    }>
  > {
    const res = await authFetch('/api/usage/history');
    if (!res.ok) throw new Error('Failed to fetch history');
    return res.json();
  },
};

// ─── Reports API ─────────────────────────────────────────────────────────────

export type ReportCategory =
  | 'poor_lighting'
  | 'unsafe_area'
  | 'obstruction'
  | 'harassment'
  | 'suspicious_activity'
  | 'cctv'
  | 'street_light'
  | 'bus_stop'
  | 'safe_space'
  | 'dead_end'
  | 'other';

export interface SafetyReport {
  id: string;
  lat: number;
  lng: number;
  category: ReportCategory;
  description: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
  resolved_at?: string;
}

export const reportsApi = {
  /** Submit a safety report */
  async submit(report: {
    lat: number;
    lng: number;
    category: ReportCategory;
    description: string;
    metadata?: Record<string, unknown> | null;
  }): Promise<SafetyReport> {
    const res = await authFetch('/api/reports', {
      method: 'POST',
      body: JSON.stringify(report),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Submit failed' }));
      // Check for subscription limit error
      if (res.status === 403) {
        const limitInfo = parseLimitResponse(err);
        if (limitInfo) {
          emitLimitReached(limitInfo);
          throw new LimitError(limitInfo);
        }
      }
      throw new Error(err.error || 'Failed to submit report');
    }
    return res.json();
  },

  /** Get all unresolved reports (public, no auth needed) */
  async getAll(): Promise<SafetyReport[]> {
    const res = await fetch(`${BASE}/api/reports`);
    if (!res.ok) throw new Error('Failed to fetch reports');
    return res.json();
  },

  /** Get reports near a location */
  async getNearby(
    lat: number,
    lng: number,
    radiusKm = 1,
  ): Promise<SafetyReport[]> {
    const res = await fetch(
      `${BASE}/api/reports/nearby?lat=${lat}&lng=${lng}&radius_km=${radiusKm}`,
    );
    if (!res.ok) throw new Error('Failed to fetch nearby reports');
    return res.json();
  },

  /** Get current user's reports */
  async getMine(): Promise<SafetyReport[]> {
    const res = await authFetch('/api/reports/mine');
    if (!res.ok) throw new Error('Failed to fetch your reports');
    return res.json();
  },

  /** Delete own report */
  async delete(id: string): Promise<void> {
    const res = await authFetch(`/api/reports/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Delete failed' }));
      throw new Error(err.error || 'Failed to delete report');
    }
  },
};

// ─── Reviews API ─────────────────────────────────────────────────────────────

export interface Review {
  id: string;
  rating: number;
  comment: string;
  created_at: string;
  user_name?: string;
}

export const reviewsApi = {
  /** Submit a review */
  async submit(rating: number, comment: string): Promise<Review> {
    const res = await authFetch('/api/reviews', {
      method: 'POST',
      body: JSON.stringify({ rating, comment }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Submit failed' }));
      throw new Error(err.error || 'Failed to submit review');
    }
    return res.json();
  },

  /** Get all reviews (public) */
  async getAll(): Promise<Review[]> {
    const res = await fetch(`${BASE}/api/reviews`);
    if (!res.ok) throw new Error('Failed to fetch reviews');
    return res.json();
  },

  /** Get review summary (avg + count) */
  async getSummary(): Promise<{ average_rating: number; total_reviews: number }> {
    const res = await fetch(`${BASE}/api/reviews/summary`);
    if (!res.ok) throw new Error('Failed to fetch summary');
    return res.json();
  },

  /** Get current user's review */
  async getMine(): Promise<Review | null> {
    const res = await authFetch('/api/reviews/mine');
    if (!res.ok) return null;
    return res.json();
  },

  /** Update own review */
  async update(
    id: string,
    updates: { rating?: number; comment?: string },
  ): Promise<Review> {
    const res = await authFetch(`/api/reviews/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Update failed' }));
      throw new Error(err.error || 'Failed to update review');
    }
    return res.json();
  },

  /** Delete own review */
  async delete(id: string): Promise<void> {
    const res = await authFetch(`/api/reviews/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete review');
  },
};

// ─── Contacts API ────────────────────────────────────────────────────────────

export interface Contact {
  id: string;
  nickname: string;
  user: { id: string; name: string; username: string | null };
  is_live: boolean;
  live_session: {
    id: string;
    current_lat: number;
    current_lng: number;
    destination_name: string | null;
    started_at: string;
    last_update_at: string;
    path?: Array<{ lat: number; lng: number; t: number }>;
    /** Full planned route polyline shared when the session started */
    route_path?: Array<{ lat: number; lng: number }> | null;
  } | null;
}

export interface PendingContact {
  id: string;
  from: { id: string; name: string; username: string | null };
  created_at: string;
}

export const contactsApi = {
  /** Set or update my unique username (shown in QR code) */
  async setUsername(username: string): Promise<{ username: string }> {
    const res = await authFetch('/api/contacts/username', {
      method: 'POST',
      body: JSON.stringify({ username }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed' }));
      throw new Error(err.error || 'Failed to set username');
    }
    return res.json();
  },

  /** Look up a user by username (from QR scan) */
  async lookupUser(
    username: string,
  ): Promise<{ id: string; name: string; username: string }> {
    const res = await authFetch(`/api/contacts/lookup/${encodeURIComponent(username)}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Not found' }));
      throw new Error(err.error || 'User not found');
    }
    return res.json();
  },

  /** Send a contact request (after scanning QR) */
  async invite(contactId: string, nickname?: string): Promise<void> {
    const res = await authFetch('/api/contacts/invite', {
      method: 'POST',
      body: JSON.stringify({ contact_id: contactId, nickname: nickname || '' }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed' }));
      // Check for subscription limit error
      if (res.status === 403) {
        const limitInfo = parseLimitResponse(err);
        if (limitInfo) {
          emitLimitReached(limitInfo);
          throw new LimitError(limitInfo);
        }
      }
      throw new Error(err.error || 'Failed to send request');
    }
  },

  /** Respond to a pending contact request */
  async respond(
    contactRequestId: string,
    response: 'accepted' | 'rejected' | 'blocked',
  ): Promise<void> {
    const res = await authFetch('/api/contacts/respond', {
      method: 'POST',
      body: JSON.stringify({ contact_request_id: contactRequestId, response }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed' }));
      throw new Error(err.error || 'Failed to respond');
    }
  },

  /** Get all accepted contacts */
  async getAll(): Promise<Contact[]> {
    const res = await authFetch('/api/contacts');
    if (!res.ok) throw new Error('Failed to fetch contacts');
    return res.json();
  },

  /** Get pending incoming requests */
  async getPending(): Promise<PendingContact[]> {
    const res = await authFetch('/api/contacts/pending');
    if (!res.ok) throw new Error('Failed to fetch pending requests');
    return res.json();
  },

  /** Remove a contact */
  async remove(id: string): Promise<void> {
    const res = await authFetch(`/api/contacts/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to remove contact');
  },
};

// ─── Live Tracking API ───────────────────────────────────────────────────────

export interface LiveSession {
  id: string;
  user_id: string;
  status: 'active' | 'completed' | 'cancelled';
  current_lat: number;
  current_lng: number;
  destination_lat?: number;
  destination_lng?: number;
  destination_name?: string;
  started_at: string;
  last_update_at: string;
  ended_at?: string;
}

export interface WatchResult {
  active: boolean;
  stale?: boolean;
  user?: { name: string; username: string | null };
  session?: {
    id: string;
    current_lat: number;
    current_lng: number;
    destination_lat?: number;
    destination_lng?: number;
    destination_name?: string;
    started_at: string;
    last_update_at: string;
    path?: Array<{ lat: number; lng: number; t: number }>;
  };
}

export const liveApi = {
  /** Start a live session — notifies all contacts */
  async start(params: {
    current_lat: number;
    current_lng: number;
    destination_lat?: number;
    destination_lng?: number;
    destination_name?: string;
    /** Planned route polyline — shown to contacts on the map */
    route_path?: Array<{ lat: number; lng: number }>;
  }): Promise<LiveSession> {
    const res = await authFetch('/api/live/start', {
      method: 'POST',
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed' }));
      // Check for subscription limit error
      if (res.status === 403) {
        const limitInfo = parseLimitResponse(err);
        if (limitInfo) {
          emitLimitReached(limitInfo);
          throw new LimitError(limitInfo);
        }
      }
      throw new Error(err.error || 'Failed to start live session');
    }
    return res.json();
  },

  /** Update location during active session */
  async updateLocation(lat: number, lng: number): Promise<void> {
    try {
      await authFetch('/api/live/update', {
        method: 'POST',
        body: JSON.stringify({ current_lat: lat, current_lng: lng }),
      });
    } catch {
      // Silently fail — location updates should not block the user
    }
  },

  /** End the live session */
  async end(status: 'completed' | 'cancelled' = 'completed'): Promise<void> {
    await authFetch('/api/live/end', {
      method: 'POST',
      body: JSON.stringify({ status }),
    });
  },

  /** Get my active session (if any) */
  async getMySession(): Promise<LiveSession | null> {
    const res = await authFetch('/api/live/my-session');
    if (!res.ok) return null;
    return res.json();
  },

  /** Watch a contact's live location (poll every 5s) */
  async watchContact(userId: string): Promise<WatchResult> {
    const res = await authFetch(`/api/live/watch/${userId}`);
    if (!res.ok) throw new Error('Failed to watch contact');
    return res.json();
  },

  /** Send heartbeat to keep session alive */
  async heartbeat(): Promise<void> {
    try {
      await authFetch('/api/live/heartbeat', { method: 'POST' });
    } catch {
      // Silently fail — heartbeats are best-effort
    }
  },

  /** Best-effort session end (for app close / background) */
  endSync(status: 'completed' | 'cancelled' = 'cancelled'): void {
    // On web, use sendBeacon for reliability during page unload
    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
      try {
        const token = (globalThis as any).__safenight_access_token;
        const url = `${env.userApiUrl}/api/live/end`;
        const blob = new Blob(
          [JSON.stringify({ status })],
          { type: 'application/json' },
        );
        // sendBeacon doesn't support custom headers, so we use a query param
        navigator.sendBeacon(`${url}?token=${encodeURIComponent(token || '')}`, blob);
      } catch {
        // Best effort
      }
    }
  },

  /** Register Expo push token with the server */
  async registerPushToken(pushToken: string): Promise<void> {
    try {
      await authFetch('/api/auth/update-profile', {
        method: 'POST',
        body: JSON.stringify({ push_token: pushToken }),
      });
    } catch {
      // Silently fail
    }
  },
};

// ─── Subscription / Feature Check API ────────────────────────────────────────

export interface FeatureCheckResult {
  feature: string;
  tier: string;
  allowed: boolean;
  limit: number;
  used: number;
  remaining: number;
  unlimited?: boolean;
  per?: string | null;
  resets_at?: string | null;
  reason?: string;
  description?: string;
}

export const subscriptionApi = {
  /**
   * Check whether a specific feature action is allowed before performing it.
   * Returns the limit status. Throws on network/auth errors.
   */
  async checkFeature(feature: string): Promise<FeatureCheckResult> {
    const res = await authFetch(`/api/subscriptions/check/${encodeURIComponent(feature)}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Check failed' }));
      throw new Error(err.error || 'Failed to check feature limit');
    }
    return res.json();
  },
};

// ─── Family Pack API ─────────────────────────────────────────────────────────

export interface FamilyPackMember {
  id: string;
  email: string;
  name: string | null;
  role: 'owner' | 'member';
  status: 'pending' | 'active' | 'removed';
  joined_at: string | null;
  user_id: string | null;
  invite_sent?: boolean | null;
}

export interface FamilyPack {
  id: string;
  name: string;
  status: 'active' | 'pending' | 'cancelling' | 'cancelled' | 'expired';
  maxMembers: number;
  pricePerUser: number;
  totalMonthly: number;
  createdAt: string;
  expiresAt: string | null;
  cancelAt: string | null;
  stripeSubscriptionId: string | null;
  owner: { name: string; email: string };
}

export interface FamilyPackResult {
  pack: FamilyPack | null;
  members: FamilyPackMember[];
  role: 'owner' | 'member' | null;
  stats: { active: number; pending: number; total: number; vacantSlots: number };
}

export const familyApi = {
  /** Get current user's family pack (as owner or member) */
  async getMyPack(): Promise<FamilyPackResult> {
    const res = await authFetch('/api/family/my-pack');
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to fetch pack' }));
      throw new Error(err.error || 'Failed to fetch family pack');
    }
    return res.json();
  },

  /** Create a new family pack */
  async create(members: { email: string; name?: string }[], name?: string): Promise<{ pack: { id: string; totalMembers: number; totalMonthly: number }; message: string }> {
    const res = await authFetch('/api/family/create', {
      method: 'POST',
      body: JSON.stringify({ members, name }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to create pack' }));
      throw new Error(err.error || 'Failed to create family pack');
    }
    return res.json();
  },

  /** Add a member to the pack */
  async addMember(email: string, name?: string): Promise<{ message: string; newTotal: number; newMonthly: number }> {
    const res = await authFetch('/api/family/add-member', {
      method: 'POST',
      body: JSON.stringify({ email, name }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to add member' }));
      throw new Error(err.error || 'Failed to add member');
    }
    return res.json();
  },

  /** Remove a member from the pack */
  async removeMember(email: string): Promise<{ message: string; remainingMembers: number; newMonthly: number }> {
    const res = await authFetch('/api/family/remove-member', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to remove member' }));
      throw new Error(err.error || 'Failed to remove member');
    }
    return res.json();
  },

  /** Activate pending membership (called on login) */
  async activate(): Promise<{ activated: boolean; message: string }> {
    const res = await authFetch('/api/family/activate', {
      method: 'POST',
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Activation failed' }));
      throw new Error(err.error || 'Failed to activate membership');
    }
    return res.json();
  },

  /** Cancel the family pack (owner only) */
  async cancel(): Promise<{ message: string; refunded?: boolean; cancelAt?: string }> {
    const res = await authFetch('/api/family/cancel', {
      method: 'POST',
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Cancel failed' }));
      throw new Error(err.error || 'Failed to cancel family pack');
    }
    return res.json();
  },

  /** Update a pending member's email and resend the invitation */
  async updateMemberEmail(memberId: string, newEmail: string): Promise<{ message: string; emailSent?: boolean }> {
    const res = await authFetch('/api/family/update-member-email', {
      method: 'POST',
      body: JSON.stringify({ member_id: memberId, new_email: newEmail }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Update failed' }));
      throw new Error(err.error || 'Failed to update member email');
    }
    return res.json();
  },

  /** Resend invitation email to a pending member */
  async resendInvite(memberId: string): Promise<{ message: string; emailSent: boolean }> {
    const res = await authFetch('/api/family/resend-invite', {
      method: 'POST',
      body: JSON.stringify({ member_id: memberId }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Resend failed' }));
      throw new Error(err.error || 'Failed to resend invitation');
    }
    return res.json();
  },

  /** Get checkout info for paying for the family pack */
  async checkout(packId: string, returnUrl?: string): Promise<{ checkoutUrl: string; packId: string; totalMembers: number; totalMonthly: number }> {
    const res = await authFetch('/api/family/checkout', {
      method: 'POST',
      body: JSON.stringify({
        pack_id: packId,
        return_url: returnUrl || window?.location?.origin || 'http://localhost:8083',
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Checkout failed' }));
      throw new Error(err.error || 'Failed to create checkout');
    }
    return res.json();
  },
};

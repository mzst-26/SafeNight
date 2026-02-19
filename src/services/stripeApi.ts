/**
 * stripeApi.ts — Frontend client for the Subscription Service (Stripe).
 *
 * Talks to the separate subscription microservice (port 3004) for:
 *   - Creating Stripe Checkout sessions (upgrade)
 *   - Creating Customer Portal sessions (manage/cancel)
 *   - Fetching subscription status
 *   - Fetching available plans
 *
 * Auth tokens are shared with the user service (same Supabase JWT).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { env } from '../config/env';

const BASE = env.subscriptionApiUrl;

// Log the resolved base URL once at import time for debugging
// console.log('[stripeApi] BASE URL:', BASE);
// console.log('[stripeApi] Platform:', Platform.OS);

// ─── Fetch with timeout ─────────────────────────────────────────────────────
// React Native (OkHttp on Android) has NO default response timeout.
// Render.com free-tier cold starts can take 30-60s.
// Without this, fetch() can hang forever and the UI spinner never stops.

const DEFAULT_TIMEOUT_MS = 20_000; // 20 seconds

function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeout?: number } = {},
): Promise<Response> {
  const { timeout = DEFAULT_TIMEOUT_MS, ...fetchOptions } = options;
  const controller = new AbortController();

  console.log(`[stripeApi][fetch] START ${fetchOptions.method ?? 'GET'} ${url} (timeout: ${timeout}ms)`);

  // Merge any external signal (e.g. from modal cleanup) with our timeout signal
  if (fetchOptions.signal) {
    const externalSignal = fetchOptions.signal;
    if (externalSignal.aborted) {
      console.log('[stripeApi][fetch] External signal already aborted');
      controller.abort(externalSignal.reason);
    } else {
      externalSignal.addEventListener('abort', () => {
        console.log('[stripeApi][fetch] External signal aborted');
        controller.abort(externalSignal.reason);
      });
    }
  }

  const timeoutId = setTimeout(() => {
    console.log(`[stripeApi][fetch] TIMEOUT after ${timeout}ms: ${url}`);
    controller.abort('Request timed out');
  }, timeout);

  const startTime = Date.now();
  return fetch(url, { ...fetchOptions, signal: controller.signal })
    .then((res) => {
      console.log(`[stripeApi][fetch] RESPONSE ${res.status} ${res.statusText} from ${url} (${Date.now() - startTime}ms)`);
      return res;
    })
    .catch((err) => {
      console.error(`[stripeApi][fetch] ERROR from ${url} (${Date.now() - startTime}ms):`, err?.message ?? err, '| name:', err?.name);
      throw err;
    })
    .finally(() => clearTimeout(timeoutId));
}

// ─── Auth helper ─────────────────────────────────────────────────────────────

async function getAccessToken(): Promise<string | null> {
  const token = await AsyncStorage.getItem('safenight_access_token');
  console.log(`[stripeApi][auth] Token ${token ? `found (${token.substring(0, 20)}...)` : 'NOT FOUND'}`);
  return token;
}

async function authFetch(
  path: string,
  options: RequestInit & { timeout?: number } = {},
): Promise<Response> {
  const token = await getAccessToken();

  return fetchWithTimeout(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface StripePlan {
  tier: string;
  name: string;
  description: string;
  priceGBP: number;
  available: boolean;
}

export interface CheckoutResult {
  url: string;
  sessionId?: string;
  type: 'checkout' | 'portal';
  message?: string;
}

export interface PortalResult {
  url: string;
}

export interface SubscriptionStatus {
  tier: string;
  hasStripeCustomer: boolean;
  stripeSubscription: {
    id: string;
    status: string;
    currentPeriodEnd: string;
    cancelAtPeriodEnd: boolean;
    cancelAt: string | null;
    plan: {
      amount: number;
      currency: string;
      interval: string;
    };
  } | null;
}

// ─── API ─────────────────────────────────────────────────────────────────────

export const stripeApi = {
  /**
   * Get available subscription plans.
   */
  async getPlans(): Promise<StripePlan[]> {
    console.log('[stripeApi] getPlans() called');
    try {
      const res = await fetchWithTimeout(`${BASE}/api/stripe/plans`);
      if (!res.ok) {
        const body = await res.text().catch(() => '(no body)');
        console.error(`[stripeApi] getPlans FAILED: ${res.status} ${res.statusText}`, body);
        throw new Error('Failed to fetch plans');
      }
      const data = await res.json();
      console.log('[stripeApi] getPlans OK:', JSON.stringify(data).substring(0, 200));
      return data.plans;
    } catch (err: any) {
      console.error('[stripeApi] getPlans EXCEPTION:', err?.message ?? err);
      throw err;
    }
  },

  /**
   * Create a Stripe Checkout session to upgrade to a plan.
   * Returns a URL to redirect the user to.
   */
  async createCheckout(
    tier: 'pro',
    returnUrl?: string,
  ): Promise<CheckoutResult> {
    const effectiveReturnUrl = returnUrl || (Platform.OS === 'web' ? window?.location?.origin : undefined) || 'http://localhost:8083';
    console.log('[stripeApi] createCheckout() tier:', tier, 'returnUrl:', effectiveReturnUrl);
    try {
      const res = await authFetch('/api/stripe/create-checkout', {
        method: 'POST',
        body: JSON.stringify({
          tier,
          return_url: effectiveReturnUrl,
        }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '(no body)');
        console.error(`[stripeApi] createCheckout FAILED: ${res.status}`, body);
        const err = (() => { try { return JSON.parse(body); } catch { return { error: 'Checkout failed' }; } })();
        throw new Error(err.error || 'Failed to create checkout session');
      }

      const data = await res.json();
      console.log('[stripeApi] createCheckout OK:', JSON.stringify(data).substring(0, 200));
      return data;
    } catch (err: any) {
      console.error('[stripeApi] createCheckout EXCEPTION:', err?.message ?? err);
      throw err;
    }
  },

  /**
   * Create a Stripe Checkout session for a Family Pack.
   * Uses quantity-based pricing (family price × member count).
   */
  async createFamilyCheckout(
    packId: string,
    returnUrl?: string,
  ): Promise<CheckoutResult> {
    const res = await authFetch('/api/stripe/create-family-checkout', {
      method: 'POST',
      body: JSON.stringify({
        pack_id: packId,
        return_url: returnUrl || window?.location?.origin || 'http://localhost:8083',
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Checkout failed' }));
      throw new Error(err.error || 'Failed to create family checkout session');
    }

    return res.json();
  },

  /**
   * Create a Stripe Customer Portal session to manage/cancel subscription.
   * Returns a URL to redirect the user to.
   */
  async createPortal(returnUrl?: string): Promise<PortalResult> {
    const effectiveReturnUrl = returnUrl || (Platform.OS === 'web' ? window?.location?.origin : undefined) || 'http://localhost:8083';
    console.log('[stripeApi] createPortal() returnUrl:', effectiveReturnUrl);
    try {
      const res = await authFetch('/api/stripe/create-portal', {
        method: 'POST',
        body: JSON.stringify({
          return_url: effectiveReturnUrl,
        }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '(no body)');
        console.error(`[stripeApi] createPortal FAILED: ${res.status}`, body);
        const err = (() => { try { return JSON.parse(body); } catch { return { error: 'Portal failed' }; } })();
        throw new Error(err.error || 'Failed to create portal session');
      }

      const data = await res.json();
      console.log('[stripeApi] createPortal OK:', JSON.stringify(data).substring(0, 200));
      return data;
    } catch (err: any) {
      console.error('[stripeApi] createPortal EXCEPTION:', err?.message ?? err);
      throw err;
    }
  },

  /**
   * Get the user's current Stripe subscription status.
   */
  async getStatus(signal?: AbortSignal): Promise<SubscriptionStatus> {
    console.log('[stripeApi] getStatus() called');
    try {
      const res = await authFetch('/api/stripe/status', signal ? { signal } : {});

      if (!res.ok) {
        const body = await res.text().catch(() => '(no body)');
        console.error(`[stripeApi] getStatus FAILED: ${res.status} ${res.statusText}`, body);
        const err = (() => { try { return JSON.parse(body); } catch { return { error: 'Status check failed' }; } })();
        throw new Error(err.error || 'Failed to get subscription status');
      }

      const data = await res.json();
      console.log('[stripeApi] getStatus OK:', JSON.stringify(data).substring(0, 300));
      return data;
    } catch (err: any) {
      console.error('[stripeApi] getStatus EXCEPTION:', err?.message ?? err, '| name:', err?.name);
      throw err;
    }
  },

  /**
   * Cancel the user's individual subscription.
   * 14-day cooling-off: within 14 days → full refund, after → access until period end.
   */
  async cancelSubscription(): Promise<{ message: string; refunded?: boolean; cancelAt?: string }> {
    console.log('[stripeApi] cancelSubscription() called');
    try {
      const res = await authFetch('/api/stripe/cancel', {
        method: 'POST',
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '(no body)');
        console.error(`[stripeApi] cancelSubscription FAILED: ${res.status}`, body);
        const err = (() => { try { return JSON.parse(body); } catch { return { error: 'Cancel failed' }; } })();
        throw new Error(err.error || 'Failed to cancel subscription');
      }

      const data = await res.json();
      console.log('[stripeApi] cancelSubscription OK:', JSON.stringify(data));
      return data;
    } catch (err: any) {
      console.error('[stripeApi] cancelSubscription EXCEPTION:', err?.message ?? err);
      throw err;
    }
  },
};

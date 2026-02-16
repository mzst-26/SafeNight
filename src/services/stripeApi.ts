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
import { env } from '../config/env';

const BASE = env.subscriptionApiUrl;

// ─── Auth helper ─────────────────────────────────────────────────────────────

async function getAccessToken(): Promise<string | null> {
  return AsyncStorage.getItem('safenight_access_token');
}

async function authFetch(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const token = await getAccessToken();

  return fetch(`${BASE}${path}`, {
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
    const res = await fetch(`${BASE}/api/stripe/plans`);
    if (!res.ok) throw new Error('Failed to fetch plans');
    const data = await res.json();
    return data.plans;
  },

  /**
   * Create a Stripe Checkout session to upgrade to a plan.
   * Returns a URL to redirect the user to.
   */
  async createCheckout(
    tier: 'pro',
    returnUrl?: string,
  ): Promise<CheckoutResult> {
    const res = await authFetch('/api/stripe/create-checkout', {
      method: 'POST',
      body: JSON.stringify({
        tier,
        return_url: returnUrl || window?.location?.origin || 'http://localhost:8083',
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Checkout failed' }));
      throw new Error(err.error || 'Failed to create checkout session');
    }

    return res.json();
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
    const res = await authFetch('/api/stripe/create-portal', {
      method: 'POST',
      body: JSON.stringify({
        return_url: returnUrl || window?.location?.origin || 'http://localhost:8083',
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Portal failed' }));
      throw new Error(err.error || 'Failed to create portal session');
    }

    return res.json();
  },

  /**
   * Get the user's current Stripe subscription status.
   */
  async getStatus(): Promise<SubscriptionStatus> {
    const res = await authFetch('/api/stripe/status');

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Status check failed' }));
      throw new Error(err.error || 'Failed to get subscription status');
    }

    return res.json();
  },
};

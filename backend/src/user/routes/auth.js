/**
 * auth.js — Authentication routes (magic link / passwordless).
 *
 * POST   /api/auth/magic-link     — Send magic link email
 * POST   /api/auth/verify         — Exchange OTP token for session
 * POST   /api/auth/refresh        — Refresh expired access token
 * GET    /api/auth/me             — Get current user profile
 * POST   /api/auth/update-profile — Update user name/platform/version
 * POST   /api/auth/logout         — Sign out (invalidate token)
 * DELETE /api/auth/account        — Permanently delete account & data
 */

const express = require('express');
const { supabase, supabaseAuth } = require('../lib/supabase');
const { requireAuth } = require('../middleware/authMiddleware');

const router = express.Router();

// ─── Ensure all required DB records exist for a user ─────────────────────────
// Idempotent — safe to call on every login. Creates profile, default
// subscription, and first usage event if they don't already exist.
async function ensureUserRecords(userId, email, name) {
  try {
    // 1. Profile — upsert (create if missing, otherwise just update last_seen + email)
    const { data: existingProfile } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', userId)
      .maybeSingle();

    if (!existingProfile) {
      await supabase.from('profiles').insert({
        id: userId,
        email: email || null,
        name: name || '',
        created_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
      });
    } else {
      // Only update last_seen and fill in email if it was missing
      await supabase
        .from('profiles')
        .update({
          last_seen_at: new Date().toISOString(),
          ...(email ? { email } : {}),
        })
        .eq('id', userId);
    }

    // 2. Default free subscription (only if none exists)
    const { data: existingSub } = await supabase
      .from('subscriptions')
      .select('id')
      .eq('user_id', userId)
      .limit(1)
      .maybeSingle();

    if (!existingSub) {
      await supabase.from('subscriptions').insert({
        user_id: userId,
        tier: 'free',
        status: 'active',
      });
    }

    // 3. Log account_created event (only if never logged)
    const { data: existingEvent } = await supabase
      .from('usage_events')
      .select('id')
      .eq('user_id', userId)
      .eq('event_type', 'account_created')
      .limit(1)
      .maybeSingle();

    if (!existingEvent) {
      await supabase.from('usage_events').insert({
        user_id: userId,
        event_type: 'account_created',
        value_text: 'signup',
      });
    }

    console.log(`[auth] ensureUserRecords OK for ${userId}`);
  } catch (err) {
    // Non-fatal — log but don't block login
    console.error('[auth] ensureUserRecords error:', err.message);
  }
}

// ─── Strict rate limit for sensitive auth endpoints ──────────────────────────
// magic-link + verify only — prevents brute-force OTP guessing & email spam.
// Uses ipOnly because there's no JWT yet at sign-in time.
const authSensitiveLimit = require('../../shared/middleware/rateLimiter').createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,         // 20 per IP per 15 min (plenty for real users, blocks abuse)
  ipOnly: true,
});

// ─── Validation helpers ──────────────────────────────────────────────────────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_NAME = 100;
const VALID_PLATFORMS = ['android', 'ios', 'web'];

function validateEmail(email) {
  if (!email || typeof email !== 'string') return false;
  return EMAIL_RE.test(email.trim().toLowerCase());
}

// ─── POST /api/auth/magic-link ───────────────────────────────────────────────
// Send a passwordless magic link to the user's email.
// If the user doesn't exist, Supabase creates them automatically.
router.post('/magic-link', authSensitiveLimit, async (req, res, next) => {
  try {
    const { email, name } = req.body;

    if (!validateEmail(email)) {
      return res.status(400).json({ error: 'Valid email is required' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanName = typeof name === 'string' ? name.trim().slice(0, MAX_NAME) : '';

    const { error } = await supabaseAuth.auth.signInWithOtp({
      email: cleanEmail,
      options: {
        data: { name: cleanName },
        shouldCreateUser: true,
      },
    });

    if (error) {
      console.error('[auth] Magic link error:', error.message, error.status, JSON.stringify(error));
      return res.status(400).json({ error: error.message || 'Failed to send magic link' });
    }

    res.json({ message: 'Magic link sent — check your email' });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/auth/verify ──────────────────────────────────────────────────
// Exchange OTP token (from magic link URL) for a session.
router.post('/verify', authSensitiveLimit, async (req, res, next) => {
  try {
    const { token, email } = req.body;

    if (!token || typeof token !== 'string') {
      return res.status(400).json({ error: 'Token is required' });
    }
    if (!validateEmail(email)) {
      return res.status(400).json({ error: 'Valid email is required' });
    }

    const cleanEmail = email.trim().toLowerCase();

    const { data, error } = await supabaseAuth.auth.verifyOtp({
      email: cleanEmail,
      token,
      type: 'email',
    });

    if (error || !data.session) {
      console.error('[auth] Verify OTP error:', error?.message);
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // ── Ensure all required DB records exist (safety net) ─────────
    // The DB trigger handles this on first signup, but if the schema
    // was recreated or the trigger failed, this catches it.
    await ensureUserRecords(data.user.id, data.user.email, data.user.user_metadata?.name);

    // Update last_seen
    await supabase
      .from('profiles')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('id', data.user.id);

    res.json({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_in: data.session.expires_in,
      user: {
        id: data.user.id,
        email: data.user.email,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/auth/refresh ─────────────────────────────────────────────────
// Refresh an expired access token using a refresh token.
router.post('/refresh', async (req, res, next) => {
  try {
    const { refresh_token } = req.body;

    if (!refresh_token || typeof refresh_token !== 'string') {
      return res.status(400).json({ error: 'Refresh token is required' });
    }

    const { data, error } = await supabaseAuth.auth.refreshSession({
      refresh_token,
    });

    if (error || !data.session) {
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }

    res.json({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_in: data.session.expires_in,
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/auth/me ────────────────────────────────────────────────────────
// Get the current user's profile (requires auth).
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    // Ensure records exist (covers edge case: schema recreated after signup)
    await ensureUserRecords(req.user.id, req.user.email);

    const { data, error } = await supabase
      .from('profiles')
      .select('id, email, name, username, push_token, platform, app_version, subscription, onboarded, disclaimer_accepted_at, created_at, last_seen_at')
      .eq('id', req.user.id)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    // Update last_seen
    await supabase
      .from('profiles')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('id', req.user.id);

    // Fetch active subscription details
    const { data: sub } = await supabase
      .from('subscriptions')
      .select('id, tier, status, started_at, expires_at, is_gift, gift_start_date, gift_end_date, is_family_pack, family_pack_id')
      .eq('user_id', req.user.id)
      .eq('status', 'active')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // Fetch contact counts
    const { count: contactCount } = await supabase
      .from('emergency_contacts')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'accepted')
      .or(`user_id.eq.${req.user.id},contact_id.eq.${req.user.id}`);

    // Fetch route_distance limit from DB (tier-aware)
    const effectiveTier = sub?.tier || data.subscription || 'free';
    const { data: distRow } = await supabase
      .from('feature_limits')
      .select('max_count')
      .eq('feature', 'route_distance')
      .eq('tier', effectiveTier)
      .maybeSingle();

    // Fallback: free=1, pro=10, premium=20
    const defaultDistances = { free: 1, pro: 10, premium: 20 };
    const routeDistanceKm = distRow?.max_count ?? defaultDistances[effectiveTier] ?? 1;

    res.json({
      ...data,
      email: data.email || req.user.email,
      subscription_details: sub || { tier: 'free', status: 'active' },
      is_gift: sub?.is_gift || false,
      gift_end_date: sub?.gift_end_date || null,
      subscription_ends_at: sub?.is_gift ? sub.gift_end_date : (sub?.expires_at || null),
      is_family_pack: sub?.is_family_pack || false,
      family_pack_id: sub?.family_pack_id || null,
      contact_count: contactCount || 0,
      route_distance_km: routeDistanceKm,
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/auth/accept-disclaimer ───────────────────────────────────────
// Record that the user has accepted the safety disclaimer.
// Idempotent — if already accepted, returns success without overwriting.
router.post('/accept-disclaimer', requireAuth, async (req, res, next) => {
  try {
    // Only set if not already accepted (preserve original acceptance time)
    const { data: profile } = await supabase
      .from('profiles')
      .select('disclaimer_accepted_at')
      .eq('id', req.user.id)
      .single();

    if (profile?.disclaimer_accepted_at) {
      return res.json({ message: 'Already accepted', accepted_at: profile.disclaimer_accepted_at });
    }

    const now = new Date().toISOString();
    const { error } = await supabase
      .from('profiles')
      .update({ disclaimer_accepted_at: now })
      .eq('id', req.user.id);

    if (error) {
      console.error('[auth] Disclaimer accept error:', error.message);
      return res.status(500).json({ error: 'Failed to save disclaimer acceptance' });
    }

    res.json({ message: 'Disclaimer accepted', accepted_at: now });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/auth/update-profile ──────────────────────────────────────────
// Update name, platform, app_version, push_token, onboarded.
router.post('/update-profile', requireAuth, async (req, res, next) => {
  try {
    const updates = {};
    const { name, platform, app_version, push_token, onboarded } = req.body;

    if (typeof name === 'string') {
      updates.name = name.trim().slice(0, MAX_NAME);
    }
    if (typeof platform === 'string' && VALID_PLATFORMS.includes(platform)) {
      updates.platform = platform;
    }
    if (typeof app_version === 'string' && app_version.length <= 20) {
      updates.app_version = app_version;
    }
    if (typeof push_token === 'string' && push_token.length <= 200) {
      updates.push_token = push_token;
    }
    if (typeof onboarded === 'boolean') {
      updates.onboarded = onboarded;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    updates.last_seen_at = new Date().toISOString();

    const { error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', req.user.id);

    if (error) {
      console.error('[auth] Profile update error:', error.message);
      return res.status(500).json({ error: 'Failed to update profile' });
    }

    res.json({ message: 'Profile updated' });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/auth/logout ──────────────────────────────────────────────────
router.post('/logout', requireAuth, async (req, res, next) => {
  try {
    // Server-side sign out — invalidates the user's session
    const { error } = await supabaseAuth.auth.admin.signOut(req.user.id);

    if (error) {
      console.error('[auth] Logout error:', error.message);
    }

    res.json({ message: 'Logged out' });
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /api/auth/account ───────────────────────────────────────────────
// Permanently deletes the user's account and all associated data.
// Required by Google Play Data Deletion policy.
router.delete('/account', requireAuth, async (req, res, next) => {
  try {
    const userId = req.user.id;
    console.log(`[auth] Account deletion requested for user ${userId}`);

    // 0. Cancel any active Stripe subscriptions before deleting data
    const { data: profile } = await supabase
      .from('profiles')
      .select('stripe_customer_id')
      .eq('id', userId)
      .single();

    if (profile?.stripe_customer_id) {
      try {
        const { getStripe } = require('../../subscription/lib/stripeClient');
        const stripe = getStripe();
        const subs = await stripe.subscriptions.list({
          customer: profile.stripe_customer_id,
          status: 'active',
          limit: 10,
        });
        for (const sub of subs.data) {
          console.log(`[auth] Cancelling Stripe subscription ${sub.id} for deleted user ${userId}`);
          await stripe.subscriptions.cancel(sub.id);
        }
        // Also cancel past_due subscriptions
        const pastDue = await stripe.subscriptions.list({
          customer: profile.stripe_customer_id,
          status: 'past_due',
          limit: 10,
        });
        for (const sub of pastDue.data) {
          console.log(`[auth] Cancelling past_due Stripe subscription ${sub.id}`);
          await stripe.subscriptions.cancel(sub.id);
        }
      } catch (stripeErr) {
        // Log but don't block account deletion if Stripe is unavailable
        console.error(`[auth] Stripe cancellation failed: ${stripeErr.message}`);
      }
    }

    // 1. Delete user's data from all tables (order matters for FK constraints)
    const tables = [
      'usage_events',
      'user_reports',
      'user_reviews',
      'contacts',
      'subscriptions',
      'family_pack_members',
      'profiles',
    ];

    for (const table of tables) {
      const { error } = await supabase
        .from(table)
        .delete()
        .eq('user_id', userId);
      if (error) {
        console.warn(`[auth] Delete from ${table} failed: ${error.message}`);
      }
    }

    // Also delete any contacts where user is the contact (not the owner)
    const { error: contactErr } = await supabase
      .from('contacts')
      .delete()
      .eq('contact_id', userId);
    if (contactErr) {
      console.warn(`[auth] Delete contacts (as contact) failed: ${contactErr.message}`);
    }

    // Also delete profiles row using id (not user_id)
    const { error: profileErr } = await supabase
      .from('profiles')
      .delete()
      .eq('id', userId);
    if (profileErr) {
      console.warn(`[auth] Delete profile by id failed: ${profileErr.message}`);
    }

    // 2. Delete the auth user from Supabase Auth
    const { error: authError } = await supabaseAuth.auth.admin.deleteUser(userId);
    if (authError) {
      console.error(`[auth] Failed to delete auth user: ${authError.message}`);
      return res.status(500).json({ error: 'Failed to delete authentication account' });
    }

    console.log(`[auth] Account deleted successfully for user ${userId}`);
    res.json({ message: 'Account deleted successfully' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

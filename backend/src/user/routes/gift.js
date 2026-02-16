/**
 * gift.js — Gift subscription routes (admin).
 *
 * POST /api/gift/send     — Gift a Guarded subscription to a user by email
 * GET  /api/gift/my-gift  — Check if current user has a gift subscription
 *
 * The /send endpoint is admin-only (requires ADMIN_SECRET header).
 * The /my-gift endpoint is user-facing (requires auth).
 */

const express = require('express');
const { supabase } = require('../lib/supabase');
const { requireAuth } = require('../middleware/authMiddleware');
const { sendGiftNotification } = require('../../shared/email');

const router = express.Router();

const ADMIN_SECRET = process.env.ADMIN_SECRET || 'change-me-in-production';

// ─── Admin auth middleware ───────────────────────────────────────────────────
function requireAdmin(req, res, next) {
  const key = req.headers['x-admin-key'];
  if (!key || key !== ADMIN_SECRET) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// ─── POST /api/gift/send ────────────────────────────────────────────────────
// Gift a Guarded subscription to a user. Creates/upgrades their subscription
// and sends them a notification email.
//
// Body: { email, duration_days?, message? }
// Headers: x-admin-key: <ADMIN_SECRET>
router.post('/send', requireAdmin, async (req, res, next) => {
  try {
    const { email, duration_days = 30 } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    if (duration_days < 1 || duration_days > 365) {
      return res.status(400).json({ error: 'duration_days must be between 1 and 365' });
    }

    // Find user by email
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id, email, name, subscription')
      .eq('email', email.trim().toLowerCase())
      .maybeSingle();

    if (profileError) {
      console.error('[gift] Profile lookup error:', profileError.message);
      return res.status(500).json({ error: 'Failed to look up user' });
    }

    if (!profile) {
      return res.status(404).json({ error: `No user found with email: ${email}` });
    }

    const now = new Date();
    const giftEndDate = new Date(now.getTime() + duration_days * 24 * 60 * 60 * 1000);

    // Cancel any existing active subscription (except free)
    await supabase
      .from('subscriptions')
      .update({ status: 'cancelled', cancelled_at: now.toISOString() })
      .eq('user_id', profile.id)
      .eq('status', 'active')
      .neq('tier', 'free');

    // Also mark existing free subs as replaced
    await supabase
      .from('subscriptions')
      .update({ status: 'replaced' })
      .eq('user_id', profile.id)
      .eq('status', 'active')
      .eq('tier', 'free');

    // Create new gift subscription
    const { data: newSub, error: subError } = await supabase
      .from('subscriptions')
      .insert({
        user_id: profile.id,
        tier: 'pro',
        status: 'active',
        started_at: now.toISOString(),
        expires_at: giftEndDate.toISOString(),
        is_gift: true,
        gift_start_date: now.toISOString(),
        gift_end_date: giftEndDate.toISOString(),
      })
      .select()
      .single();

    if (subError) {
      console.error('[gift] Subscription create error:', subError.message);
      return res.status(500).json({ error: 'Failed to create gift subscription' });
    }

    // Update denormalized tier on profile
    await supabase
      .from('profiles')
      .update({ subscription: 'pro' })
      .eq('id', profile.id);

    // Send notification email
    const emailResult = await sendGiftNotification({
      to: profile.email || email,
      name: profile.name,
      giftEndDate: giftEndDate.toISOString(),
    });

    console.log(`[gift] Gifted Guarded subscription to ${email} until ${giftEndDate.toISOString()}`);

    res.json({
      success: true,
      gift: {
        user_id: profile.id,
        email: profile.email || email,
        name: profile.name,
        tier: 'pro',
        gift_start_date: now.toISOString(),
        gift_end_date: giftEndDate.toISOString(),
        duration_days,
        subscription_id: newSub.id,
      },
      email_sent: emailResult.success,
      email_fallback: emailResult.fallback || false,
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/gift/send-bulk ───────────────────────────────────────────────
// Gift Guarded subscription to multiple users at once.
//
// Body: { emails: string[], duration_days?: number }
// Headers: x-admin-key: <ADMIN_SECRET>
router.post('/send-bulk', requireAdmin, async (req, res, next) => {
  try {
    const { emails, duration_days = 30 } = req.body;

    if (!Array.isArray(emails) || emails.length === 0) {
      return res.status(400).json({ error: 'emails array is required' });
    }

    if (emails.length > 50) {
      return res.status(400).json({ error: 'Max 50 emails per bulk gift' });
    }

    const results = [];
    for (const email of emails) {
      try {
        // Reuse the single gift logic
        const { data: profile } = await supabase
          .from('profiles')
          .select('id, email, name')
          .eq('email', email.trim().toLowerCase())
          .maybeSingle();

        if (!profile) {
          results.push({ email, success: false, error: 'User not found' });
          continue;
        }

        const now = new Date();
        const giftEndDate = new Date(now.getTime() + duration_days * 24 * 60 * 60 * 1000);

        // Cancel existing active subs
        await supabase
          .from('subscriptions')
          .update({ status: 'replaced' })
          .eq('user_id', profile.id)
          .eq('status', 'active');

        // Create gift subscription
        await supabase.from('subscriptions').insert({
          user_id: profile.id,
          tier: 'pro',
          status: 'active',
          started_at: now.toISOString(),
          expires_at: giftEndDate.toISOString(),
          is_gift: true,
          gift_start_date: now.toISOString(),
          gift_end_date: giftEndDate.toISOString(),
        });

        // Update profile
        await supabase
          .from('profiles')
          .update({ subscription: 'pro' })
          .eq('id', profile.id);

        // Send email
        const emailResult = await sendGiftNotification({
          to: profile.email || email,
          name: profile.name,
          giftEndDate: giftEndDate.toISOString(),
        });

        results.push({
          email,
          success: true,
          gift_end_date: giftEndDate.toISOString(),
          email_sent: emailResult.success,
        });
      } catch (err) {
        results.push({ email, success: false, error: err.message });
      }
    }

    const succeeded = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    console.log(`[gift] Bulk gift: ${succeeded} succeeded, ${failed} failed`);

    res.json({
      success: true,
      total: emails.length,
      succeeded,
      failed,
      results,
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/gift/my-gift ──────────────────────────────────────────────────
// Returns the current user's gift subscription status (if any).
router.get('/my-gift', requireAuth, async (req, res, next) => {
  try {
    const { data: gift } = await supabase
      .from('subscriptions')
      .select('id, tier, status, is_gift, gift_start_date, gift_end_date, started_at, expires_at')
      .eq('user_id', req.user.id)
      .eq('is_gift', true)
      .eq('status', 'active')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!gift) {
      return res.json({ has_gift: false });
    }

    const now = new Date();
    const isExpired = gift.gift_end_date && new Date(gift.gift_end_date) < now;

    res.json({
      has_gift: !isExpired,
      gift: isExpired ? null : gift,
      expired: isExpired,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

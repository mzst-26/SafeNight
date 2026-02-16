/**
 * stripe.js — Stripe-facing routes for the subscription service.
 *
 * POST /api/stripe/create-checkout    — Create a Checkout Session (upgrade)
 * POST /api/stripe/create-portal      — Create a Customer Portal session (manage/cancel)
 * GET  /api/stripe/status             — Get current subscription status
 * GET  /api/stripe/plans              — Get available plans with Stripe prices
 *
 * All user-facing routes require JWT auth via requireAuth middleware.
 * The webhook route is mounted separately in server.js (needs raw body).
 */

const express = require('express');
const { supabase } = require('../../user/lib/supabase');
const { requireAuth } = require('../../user/middleware/authMiddleware');
const { getStripe } = require('../lib/stripeClient');
const { getPlan, PLANS } = require('../lib/plans');

const router = express.Router();

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Get or create a Stripe Customer for the given user.
 * Stores stripe_customer_id in the profiles table for reuse.
 */
async function getOrCreateCustomer(userId, email, name) {
  // Check if user already has a Stripe customer ID
  const { data: profile } = await supabase
    .from('profiles')
    .select('stripe_customer_id')
    .eq('id', userId)
    .single();

  if (profile?.stripe_customer_id) {
    return profile.stripe_customer_id;
  }

  // Create a new Stripe customer
  const stripe = getStripe();
  const customer = await stripe.customers.create({
    email,
    name: name || undefined,
    metadata: {
      supabase_user_id: userId,
    },
  });

  // Store for future use
  await supabase
    .from('profiles')
    .update({ stripe_customer_id: customer.id })
    .eq('id', userId);

  return customer.id;
}

/**
 * Look up the Supabase user ID from a Stripe customer ID.
 */
async function getUserIdFromCustomerId(customerId) {
  const { data } = await supabase
    .from('profiles')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .single();

  return data?.id || null;
}

// ─── GET /api/stripe/plans ───────────────────────────────────────────────────
// Public — returns available plans for the pricing UI.
router.get('/plans', (_req, res) => {
  const plans = Object.entries(PLANS).map(([tier, plan]) => ({
    tier,
    name: plan.name,
    description: plan.description,
    priceGBP: plan.priceGBP,
    available: !!plan.stripePriceId,
  }));

  res.json({ plans });
});

// ─── POST /api/stripe/create-checkout ────────────────────────────────────────
// Creates a Stripe Checkout Session for upgrading to Guarded (pro).
// Returns the session URL for the frontend to redirect to.
router.post('/create-checkout', requireAuth, async (req, res, next) => {
  try {
    const { tier } = req.body;

    if (!tier || !['pro'].includes(tier)) {
      return res.status(400).json({
        error: 'Invalid tier. Must be "pro".',
      });
    }

    const plan = getPlan(tier);
    if (!plan?.stripePriceId) {
      return res.status(503).json({
        error: `Stripe Price ID not configured for "${tier}" plan. Contact support.`,
      });
    }

    // Get user profile for email/name
    const { data: profile } = await supabase
      .from('profiles')
      .select('email, name')
      .eq('id', req.user.id)
      .single();

    if (!profile) {
      return res.status(404).json({ error: 'User profile not found' });
    }

    const customerId = await getOrCreateCustomer(
      req.user.id,
      profile.email || req.user.email,
      profile.name,
    );

    const stripe = getStripe();

    // Check if user already has an active subscription — prevent double subscribe
    const existingSubs = await stripe.subscriptions.list({
      customer: customerId,
      status: 'active',
      limit: 1,
    });

    if (existingSubs.data.length > 0) {
      // User already has an active subscription — redirect to portal instead
      const portalSession = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: req.body.return_url || process.env.FRONTEND_URL || 'http://localhost:8083',
      });

      return res.json({
        url: portalSession.url,
        type: 'portal',
        message: 'You already have an active subscription. Redirecting to manage it.',
      });
    }

    // Determine success/cancel URLs
    const returnUrl = req.body.return_url || process.env.FRONTEND_URL || 'http://localhost:8083';

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          price: plan.stripePriceId,
          quantity: 1,
        },
      ],
      success_url: `${returnUrl}?subscription=success&tier=${tier}`,
      cancel_url: `${returnUrl}?subscription=cancelled`,
      subscription_data: {
        metadata: {
          supabase_user_id: req.user.id,
          tier,
        },
      },
      metadata: {
        supabase_user_id: req.user.id,
        tier,
      },
      // Allow promotion codes
      allow_promotion_codes: true,
    });

    res.json({
      url: session.url,
      sessionId: session.id,
      type: 'checkout',
    });
  } catch (err) {
    console.error('[stripe] Checkout error:', err.message);
    next(err);
  }
});

// ─── POST /api/stripe/create-family-checkout ─────────────────────────────────
// Creates a Stripe Checkout Session for a Family Pack.
// Uses quantity-based pricing: family price × member count.
// Body: { pack_id, return_url? }
router.post('/create-family-checkout', requireAuth, async (req, res, next) => {
  try {
    const { pack_id } = req.body;

    if (!pack_id) {
      return res.status(400).json({ error: 'pack_id is required' });
    }

    const familyPlan = getPlan('family');
    if (!familyPlan?.stripePriceId) {
      return res.status(503).json({
        error: 'Family Pack pricing not configured. Contact support.',
      });
    }

    // Verify the pack exists and belongs to this user
    const { data: pack, error: packError } = await supabase
      .from('family_packs')
      .select('id, owner_id, max_members, status')
      .eq('id', pack_id)
      .single();

    if (packError || !pack) {
      return res.status(404).json({ error: 'Pack not found' });
    }

    if (pack.owner_id !== req.user.id) {
      return res.status(403).json({ error: 'Only the pack owner can purchase' });
    }

    if (pack.status === 'active') {
      return res.status(400).json({
        error: 'Pack is already active.',
      });
    }

    // Get user profile for Stripe customer
    const { data: profile } = await supabase
      .from('profiles')
      .select('email, name')
      .eq('id', req.user.id)
      .single();

    if (!profile) {
      return res.status(404).json({ error: 'User profile not found' });
    }

    const customerId = await getOrCreateCustomer(
      req.user.id,
      profile.email || req.user.email,
      profile.name,
    );

    const stripe = getStripe();
    const returnUrl = req.body.return_url || process.env.FRONTEND_URL || 'http://localhost:8083';

    // ── Cancel existing Guarded subscription with proration ──────────────
    // If the user already pays for Guarded (pro), cancel it now so they get
    // a pro-rated credit on their Stripe balance.  The credit is automatically
    // applied to the Family Pack's first invoice — no double-charging.
    let creditApplied = false;
    const existingSubs = await stripe.subscriptions.list({
      customer: customerId,
      status: 'active',
      limit: 5,
    });

    for (const sub of existingSubs.data) {
      const subTier = sub.metadata?.tier;
      // Only cancel individual (pro) subscriptions, not other family packs
      if (subTier === 'family') continue;

      console.log(`[stripe] Cancelling existing sub ${sub.id} (tier=${subTier}) with proration credit`);
      await stripe.subscriptions.cancel(sub.id, {
        prorate: true,           // generates credit for unused time
        invoice_now: true,       // finalise the last invoice immediately
      });
      creditApplied = true;

      // Also expire it in our DB
      await supabase
        .from('subscriptions')
        .update({ status: 'expired', cancelled_at: new Date().toISOString() })
        .eq('user_id', req.user.id)
        .eq('status', 'active');
    }

    if (creditApplied) {
      console.log('[stripe] Pro-rated credit applied to customer balance for family upgrade');
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          price: familyPlan.stripePriceId,
          quantity: pack.max_members,
        },
      ],
      success_url: `${returnUrl}?subscription=success&tier=family`,
      cancel_url: `${returnUrl}?subscription=cancelled`,
      subscription_data: {
        metadata: {
          supabase_user_id: req.user.id,
          tier: 'family',
          pack_id: pack.id,
        },
      },
      metadata: {
        supabase_user_id: req.user.id,
        tier: 'family',
        pack_id: pack.id,
      },
      allow_promotion_codes: true,
    });

    res.json({
      url: session.url,
      sessionId: session.id,
      type: 'checkout',
    });
  } catch (err) {
    console.error('[stripe] Family checkout error:', err.message);
    next(err);
  }
});

// ─── POST /api/stripe/create-portal ──────────────────────────────────────────
// Creates a Stripe Customer Portal session for managing/cancelling subscriptions.
// Returns the portal URL for the frontend to open.
router.post('/create-portal', requireAuth, async (req, res, next) => {
  try {
    // Get Stripe customer ID from profile
    const { data: profile } = await supabase
      .from('profiles')
      .select('stripe_customer_id, email, name')
      .eq('id', req.user.id)
      .single();

    if (!profile?.stripe_customer_id) {
      return res.status(400).json({
        error: 'No subscription found. You need to subscribe first.',
      });
    }

    const stripe = getStripe();
    const returnUrl = req.body.return_url || process.env.FRONTEND_URL || 'http://localhost:8083';

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: returnUrl,
    });

    res.json({ url: portalSession.url });
  } catch (err) {
    console.error('[stripe] Portal error:', err.message);
    next(err);
  }
});

// ─── GET /api/stripe/status ──────────────────────────────────────────────────
// Returns the user's current Stripe subscription status.
// Useful for the frontend to show current plan details.
router.get('/status', requireAuth, async (req, res, next) => {
  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('subscription, stripe_customer_id')
      .eq('id', req.user.id)
      .single();

    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    const result = {
      tier: profile.subscription || 'free',
      hasStripeCustomer: !!profile.stripe_customer_id,
      stripeSubscription: null,
    };

    // If they have a Stripe customer, fetch subscription details
    if (profile.stripe_customer_id) {
      try {
        const stripe = getStripe();
        const subs = await stripe.subscriptions.list({
          customer: profile.stripe_customer_id,
          status: 'all',
          limit: 1,
          expand: ['data.default_payment_method'],
        });

        if (subs.data.length > 0) {
          const sub = subs.data[0];
          result.stripeSubscription = {
            id: sub.id,
            status: sub.status,
            currentPeriodEnd: new Date(sub.current_period_end * 1000).toISOString(),
            cancelAtPeriodEnd: sub.cancel_at_period_end,
            cancelAt: sub.cancel_at
              ? new Date(sub.cancel_at * 1000).toISOString()
              : null,
            plan: {
              amount: sub.items.data[0]?.price?.unit_amount,
              currency: sub.items.data[0]?.price?.currency,
              interval: sub.items.data[0]?.price?.recurring?.interval,
            },
          };
        }
      } catch (stripeErr) {
        console.warn('[stripe] Failed to fetch Stripe subscription:', stripeErr.message);
        // Don't fail the whole request — still return tier from DB
      }
    }

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Export helpers for webhook use
module.exports = router;
module.exports.getOrCreateCustomer = getOrCreateCustomer;
module.exports.getUserIdFromCustomerId = getUserIdFromCustomerId;

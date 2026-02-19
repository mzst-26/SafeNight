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
 * Returns { id: string, refundIneligible: boolean }.
 */
async function getOrCreateCustomer(userId, email, name) {
  // Check if user already has a Stripe customer ID
  const { data: profile } = await supabase
    .from('profiles')
    .select('stripe_customer_id, refund_ineligible')
    .eq('id', userId)
    .single();

  if (profile?.stripe_customer_id) {
    // Verify the customer still exists in Stripe (guards against test→live migration
    // or manual Stripe dashboard deletions)
    const stripe = getStripe();
    try {
      await stripe.customers.retrieve(profile.stripe_customer_id);
      return { id: profile.stripe_customer_id, refundIneligible: profile.refund_ineligible === true };
    } catch (err) {
      if (err?.code === 'resource_missing') {
        // Stale ID — clear it and fall through to create a new one below
        console.warn(
          `[stripe] Customer ${profile.stripe_customer_id} not found in Stripe (stale ID). Creating new customer.`,
        );
        await supabase
          .from('profiles')
          .update({ stripe_customer_id: null })
          .eq('id', userId);
      } else {
        throw err;
      }
    }
  }

  // ── Anti-abuse: search Stripe by email before creating a new customer ──────
  // If this email previously had a Stripe customer (from a deleted account),
  // reuse that customer and mark the profile as refund_ineligible so the
  // 14-day cooling-off refund cannot be claimed again.
  const stripe = getStripe();

  if (email) {
    try {
      const existingCustomers = await stripe.customers.list({
        email: email.trim().toLowerCase(),
        limit: 5,
      });

      for (const candidate of existingCustomers.data) {
        // Check if this customer has ANY subscription history (all statuses)
        const priorSubs = await stripe.subscriptions.list({
          customer: candidate.id,
          status: 'all',
          limit: 1,
        });

        const hasPriorSubs = priorSubs.data.length > 0;

        // Reuse the existing customer — link it to this new profile
        await supabase
          .from('profiles')
          .update({
            stripe_customer_id: candidate.id,
            ...(hasPriorSubs ? { refund_ineligible: true } : {}),
          })
          .eq('id', userId);

        if (hasPriorSubs) {
          console.warn(
            `[stripe] ⚠️  Reused Stripe customer ${candidate.id} for user ${userId} ` +
            `(email: ${email}) — prior subscription history detected. Marked refund_ineligible.`,
          );
        } else {
          console.log(
            `[stripe] Reused existing Stripe customer ${candidate.id} for user ${userId} ` +
            `(no prior subscriptions).`,
          );
        }

        return { id: candidate.id, refundIneligible: hasPriorSubs };
      }
    } catch (searchErr) {
      // Non-fatal — log and fall through to creating a new customer
      console.warn('[stripe] Email customer search failed, creating new customer:', searchErr.message);
    }
  }

  // No existing customer found for this email — create a fresh one
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

  return { id: customer.id, refundIneligible: false };
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

    const { id: customerId, refundIneligible: checkoutRefundIneligible } = await getOrCreateCustomer(
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

    // ── Anti-abuse: prevent re-subscribing too soon after a cooling-off refund ──
    const { data: recentRefund } = await supabase
      .from('subscriptions')
      .select('cooling_off_refunded_at')
      .eq('user_id', req.user.id)
      .eq('cooling_off_used', true)
      .order('cooling_off_refunded_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (recentRefund?.cooling_off_refunded_at) {
      const refundedAt = new Date(recentRefund.cooling_off_refunded_at).getTime();
      const daysSinceRefund = (Date.now() - refundedAt) / (1000 * 60 * 60 * 24);
      const RESUBSCRIBE_COOLDOWN_DAYS = 30;

      if (daysSinceRefund < RESUBSCRIBE_COOLDOWN_DAYS) {
        const daysRemaining = Math.ceil(RESUBSCRIBE_COOLDOWN_DAYS - daysSinceRefund);
        return res.status(403).json({
          error: `You recently used the 14-day cooling-off refund. You can re-subscribe in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}. This cooldown prevents abuse of the refund policy.`,
          cooldownEnds: new Date(refundedAt + RESUBSCRIBE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000).toISOString(),
        });
      }
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
      // Inform the frontend if this user is not eligible for the cooling-off refund
      // (prior subscription detected on a re-created account with the same email)
      coolingOffEligible: !checkoutRefundIneligible,
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

    const { id: customerId } = await getOrCreateCustomer(
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
      // Check if user is on a family pack (they won't have their own Stripe customer)
      const { data: memberRecord } = await supabase
        .from('family_pack_members')
        .select('pack_id')
        .eq('user_id', req.user.id)
        .limit(1)
        .maybeSingle();

      if (memberRecord) {
        return res.status(403).json({
          error: 'Your subscription is managed by your Family Pack owner. Please ask them to manage or cancel the subscription.',
          isFamilyMember: true,
        });
      }

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

// ─── POST /api/stripe/cancel ─────────────────────────────────────────────────
// Cancel the user's individual (Guarded) subscription.
//
// 14-day cooling-off policy (FIRST SUBSCRIPTION ONLY):
//   • Within 14 days of the current billing period start AND this is the
//     user's first-ever paid subscription → immediate cancel with full refund.
//   • Otherwise (repeat subscriber or past 14 days) → no refund; access
//     continues until the end of the current billing period.
//
// This prevents the subscribe → cancel → refund → re-subscribe abuse loop.
//
const COOLING_OFF_DAYS = 14;
const RESUBSCRIBE_COOLDOWN_DAYS = 30; // days after a cooling-off refund before re-subscribing

router.post('/cancel', requireAuth, async (req, res, next) => {
  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('stripe_customer_id, refund_ineligible')
      .eq('id', req.user.id)
      .single();

    if (!profile?.stripe_customer_id) {
      return res.status(400).json({ error: 'No subscription found.' });
    }

    const stripe = getStripe();

    // Find the active subscription
    const subs = await stripe.subscriptions.list({
      customer: profile.stripe_customer_id,
      status: 'active',
      limit: 1,
    });

    const sub = subs.data[0];
    if (!sub) {
      return res.status(404).json({ error: 'No active subscription found.' });
    }

    // Already scheduled to cancel?
    if (sub.cancel_at_period_end) {
      return res.status(400).json({
        error: 'Your subscription is already scheduled to cancel at the end of the current billing period.',
      });
    }

    const periodStart = sub.current_period_start * 1000; // ms
    const daysSincePeriodStart = (Date.now() - periodStart) / (1000 * 60 * 60 * 24);
    const withinTimeWindow = daysSincePeriodStart <= COOLING_OFF_DAYS;
    const periodEnd = new Date(sub.current_period_end * 1000).toISOString();

    // ── Check if user has ever had a previous cancelled/refunded subscription ──
    // If they have, they are NOT eligible for the cooling-off refund.
    const { data: previousSubs } = await supabase
      .from('subscriptions')
      .select('id, status, cooling_off_used')
      .eq('user_id', req.user.id)
      .neq('tier', 'free')
      .in('status', ['cancelled', 'expired'])
      .limit(1);

    const hasUsedCoolingOff = (previousSubs || []).some(s => s.cooling_off_used === true);
    const hasPreviousPaidSub = (previousSubs || []).length > 0;
    // refund_ineligible is true when a prior Stripe customer was detected on account re-creation
    // (same email, deleted account), preventing re-run of the cooling-off refund cycle.
    const isRefundIneligible = profile.refund_ineligible === true;
    const eligibleForCoolingOff = withinTimeWindow && !hasUsedCoolingOff && !hasPreviousPaidSub && !isRefundIneligible;

    console.log(
      `[stripe] Cancel request: user=${req.user.id}, ` +
      `${daysSincePeriodStart.toFixed(1)} days into period, ` +
      `withinTimeWindow=${withinTimeWindow}, hasPreviousPaidSub=${hasPreviousPaidSub}, ` +
      `hasUsedCoolingOff=${hasUsedCoolingOff}, isRefundIneligible=${isRefundIneligible}, ` +
      `eligibleForCoolingOff=${eligibleForCoolingOff}`
    );

    if (eligibleForCoolingOff) {
      // ── IMMEDIATE CANCEL + FULL REFUND (first subscription only) ────
      await stripe.subscriptions.cancel(sub.id, { prorate: true });

      // Refund ALL paid invoices for this subscription
      try {
        const invoices = await stripe.invoices.list({
          subscription: sub.id,
          status: 'paid',
          limit: 20,
        });

        for (const invoice of invoices.data) {
          if (!invoice.payment_intent || invoice.amount_paid <= 0) continue;
          try {
            const piId = typeof invoice.payment_intent === 'string'
              ? invoice.payment_intent
              : invoice.payment_intent.id;
            await stripe.refunds.create({
              payment_intent: piId,
              reason: 'requested_by_customer',
            });
            console.log(`[stripe] Refunded invoice ${invoice.id} (£${(invoice.amount_paid / 100).toFixed(2)}) for user ${req.user.id}`);
          } catch (refundErr) {
            console.error(`[stripe] Refund for invoice ${invoice.id} failed: ${refundErr.message}`);
          }
        }
      } catch (listErr) {
        console.error(`[stripe] Failed to list invoices for refund: ${listErr.message}`);
      }

      // Mark this subscription as having used the cooling-off refund
      await supabase
        .from('subscriptions')
        .update({ cooling_off_used: true, cooling_off_refunded_at: new Date().toISOString() })
        .eq('user_id', req.user.id)
        .eq('status', 'active');

      // The webhook (subscription.deleted) will handle reverting to free tier
      return res.json({
        message: 'Subscription cancelled and refunded under the 14-day cooling-off period. You have been reverted to the free plan.',
        refunded: true,
      });
    } else {
      // ── END-OF-PERIOD CANCEL (no refund) ────────────────────────────
      // Either past 14 days OR this is a repeat subscription (no refund).
      await stripe.subscriptions.update(sub.id, {
        cancel_at_period_end: true,
      });

      console.log(`[stripe] Subscription ${sub.id} set to cancel at period end (${periodEnd})`);

      const reason = !withinTimeWindow
        ? 'You are past the 14-day cooling-off window.'
        : isRefundIneligible
          ? 'A prior subscription was found on this account. The 14-day cooling-off refund applies to first-time subscribers only.'
          : 'The 14-day cooling-off refund is available on your first subscription only.';

      return res.json({
        message: `Your Guarded subscription will remain active until the end of your billing period. No further charges will be made. ${reason}`,
        cancelAt: periodEnd,
        refunded: false,
      });
    }
  } catch (err) {
    console.error('[stripe] Cancel error:', err.message);
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

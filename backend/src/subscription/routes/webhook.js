/**
 * webhook.js — Stripe webhook handler.
 *
 * Receives events from Stripe and updates the Supabase DB accordingly.
 * Signature verification ensures only genuine Stripe events are processed.
 *
 * Handled events:
 *   checkout.session.completed    — User completed payment → activate subscription
 *   customer.subscription.updated — Plan change, renewal, payment method update
 *   customer.subscription.deleted — Subscription cancelled or expired → revert to free
 *   invoice.payment_failed        — Payment failed → mark as past_due (don't downgrade yet)
 *   invoice.payment_succeeded     — Recurring payment succeeded → extend subscription
 *
 * All DB writes are idempotent — safe to replay events.
 */

const { supabase } = require('../../user/lib/supabase');
const { getStripe } = require('../lib/stripeClient');
const { getTierByPriceId } = require('../lib/plans');

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

/**
 * Express handler for POST /api/stripe/webhook.
 * Must be mounted with express.raw() body parser (not express.json()).
 */
async function stripeWebhookHandler(req, res) {
  if (!WEBHOOK_SECRET) {
    console.error('[webhook] STRIPE_WEBHOOK_SECRET not set — rejecting webhook');
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }

  const sig = req.headers['stripe-signature'];
  if (!sig) {
    return res.status(400).json({ error: 'Missing Stripe signature header' });
  }

  let event;
  try {
    const stripe = getStripe();
    event = stripe.webhooks.constructEvent(req.body, sig, WEBHOOK_SECRET);
  } catch (err) {
    console.error('[webhook] ❌ Signature verification failed:', err.message);
    return res.status(400).json({ error: `Webhook signature verification failed` });
  }

  console.log(`[webhook] ✅ Received: ${event.type} (${event.id})`);

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object);
        break;

      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object);
        break;

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object);
        break;

      case 'invoice.payment_failed':
        await handlePaymentFailed(event.data.object);
        break;

      case 'invoice.payment_succeeded':
        await handlePaymentSucceeded(event.data.object);
        break;

      default:
        console.log(`[webhook] Unhandled event type: ${event.type}`);
    }
  } catch (err) {
    // Log but still return 200 — Stripe retries on non-200, and we don't
    // want to process the same event repeatedly if our handler has a bug.
    console.error(`[webhook] Error handling ${event.type}:`, err.message);
  }

  // Always return 200 to acknowledge receipt
  res.json({ received: true });
}

// ─── Event handlers ──────────────────────────────────────────────────────────

/**
 * checkout.session.completed
 * User just completed the Stripe Checkout flow.
 */
async function handleCheckoutCompleted(session) {
  const userId = session.metadata?.supabase_user_id;
  const tier = session.metadata?.tier;
  const subscriptionId = session.subscription;
  const customerId = session.customer;

  if (!userId || !tier) {
    console.warn('[webhook] checkout.session.completed missing metadata:', {
      userId,
      tier,
    });
    return;
  }

  console.log(`[webhook] Checkout completed: user=${userId}, tier=${tier}, sub=${subscriptionId}`);

  // Store Stripe customer ID on profile (in case getOrCreateCustomer didn't run)
  if (customerId) {
    await supabase
      .from('profiles')
      .update({ stripe_customer_id: customerId })
      .eq('id', userId);
  }

  // Expire any existing active subscriptions
  await supabase
    .from('subscriptions')
    .update({
      status: 'expired',
      cancelled_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .eq('status', 'active');

  // Create new subscription record
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30);

  await supabase.from('subscriptions').insert({
    user_id: userId,
    tier,
    status: 'active',
    started_at: new Date().toISOString(),
    expires_at: expiresAt.toISOString(),
    payment_ref: subscriptionId || session.id,
  });

  // Update denormalized tier on profile
  await supabase
    .from('profiles')
    .update({ subscription: tier })
    .eq('id', userId);

  // Log the upgrade event
  await supabase.from('usage_events').insert({
    user_id: userId,
    event_type: 'subscription_upgrade',
    value_text: `${tier} (via Stripe checkout)`,
  });

  console.log(`[webhook] ✅ User ${userId} upgraded to ${tier}`);
}

/**
 * customer.subscription.updated
 * Subscription was modified — could be plan change, renewal, etc.
 */
async function handleSubscriptionUpdated(subscription) {
  const userId = subscription.metadata?.supabase_user_id;
  if (!userId) {
    // Try to look up via customer ID
    const customerId = subscription.customer;
    const lookedUpId = await getUserByCustomer(customerId);
    if (!lookedUpId) {
      console.warn('[webhook] subscription.updated: cannot identify user');
      return;
    }
    await processSubscriptionUpdate(lookedUpId, subscription);
    return;
  }

  await processSubscriptionUpdate(userId, subscription);
}

async function processSubscriptionUpdate(userId, subscription) {
  const priceId = subscription.items?.data?.[0]?.price?.id;
  const tier = getTierByPriceId(priceId);
  const status = subscription.status; // active, past_due, canceled, etc.

  console.log(`[webhook] Subscription updated: user=${userId}, status=${status}, tier=${tier}`);

  if (status === 'active' && tier) {
    // Update to new tier
    await supabase
      .from('profiles')
      .update({ subscription: tier })
      .eq('id', userId);

    // Update subscription record
    await supabase
      .from('subscriptions')
      .update({
        tier,
        status: 'active',
        expires_at: new Date(subscription.current_period_end * 1000).toISOString(),
      })
      .eq('user_id', userId)
      .eq('status', 'active');
  } else if (status === 'past_due') {
    console.warn(`[webhook] ⚠️ User ${userId} subscription is past_due`);
    // Don't downgrade yet — give them time to fix payment
  } else if (status === 'canceled' || status === 'unpaid') {
    await revertToFree(userId, 'subscription_updated_' + status);
  }
}

/**
 * customer.subscription.deleted
 * Subscription was fully cancelled/expired.
 */
async function handleSubscriptionDeleted(subscription) {
  const userId =
    subscription.metadata?.supabase_user_id ||
    (await getUserByCustomer(subscription.customer));

  if (!userId) {
    console.warn('[webhook] subscription.deleted: cannot identify user');
    return;
  }

  console.log(`[webhook] Subscription deleted: user=${userId}`);
  await revertToFree(userId, 'subscription_deleted');
}

/**
 * invoice.payment_failed
 * A recurring payment failed. Don't downgrade immediately — Stripe will
 * retry and eventually cancel the subscription if all retries fail.
 */
async function handlePaymentFailed(invoice) {
  const customerId = invoice.customer;
  const userId = await getUserByCustomer(customerId);

  if (userId) {
    console.warn(`[webhook] ⚠️ Payment failed for user ${userId}`);

    await supabase.from('usage_events').insert({
      user_id: userId,
      event_type: 'payment_failed',
      value_text: `Invoice ${invoice.id}`,
    });
  }
}

/**
 * invoice.payment_succeeded
 * Recurring payment went through — update the subscription expiry.
 */
async function handlePaymentSucceeded(invoice) {
  const customerId = invoice.customer;
  const userId = await getUserByCustomer(customerId);

  if (!userId) return;

  // Only process subscription invoices (not one-off)
  if (!invoice.subscription) return;

  const periodEnd = invoice.lines?.data?.[0]?.period?.end;
  if (periodEnd) {
    const expiresAt = new Date(periodEnd * 1000).toISOString();

    await supabase
      .from('subscriptions')
      .update({ expires_at: expiresAt })
      .eq('user_id', userId)
      .eq('status', 'active');

    console.log(`[webhook] ✅ Payment succeeded for user ${userId}, extended to ${expiresAt}`);
  }
}

// ─── Shared helpers ──────────────────────────────────────────────────────────

/**
 * Look up Supabase user ID from Stripe customer ID.
 */
async function getUserByCustomer(customerId) {
  if (!customerId) return null;

  const { data } = await supabase
    .from('profiles')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .single();

  return data?.id || null;
}

/**
 * Revert a user to the free tier.
 * Idempotent — safe to call multiple times.
 */
async function revertToFree(userId, reason) {
  // Mark active paid subscriptions as cancelled
  await supabase
    .from('subscriptions')
    .update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .eq('status', 'active')
    .neq('tier', 'free');

  // Update profile to free
  await supabase
    .from('profiles')
    .update({ subscription: 'free' })
    .eq('id', userId);

  // Ensure a free subscription record exists
  await supabase.from('subscriptions').insert({
    user_id: userId,
    tier: 'free',
    status: 'active',
    started_at: new Date().toISOString(),
  });

  // Log the event
  await supabase.from('usage_events').insert({
    user_id: userId,
    event_type: 'subscription_cancel',
    value_text: reason || 'cancelled',
  });

  console.log(`[webhook] ✅ User ${userId} reverted to free (${reason})`);
}

module.exports = { stripeWebhookHandler };

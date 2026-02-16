/**
 * plans.js — Stripe price/product mapping.
 *
 * Maps internal tier names to Stripe Price IDs.
 * Set these env vars to your actual Stripe Price IDs:
 *
 *   STRIPE_PRICE_PRO=price_xxx
 *   STRIPE_PRICE_PREMIUM=price_yyy
 *
 * Each plan also carries metadata for fallback display.
 */

const PLANS = {
  pro: {
    name: 'Pro',
    description: 'Full safety suite for regular walkers',
    priceGBP: 4.99,
    stripePriceId: process.env.STRIPE_PRICE_PRO || null,
  },
  premium: {
    name: 'Premium',
    description: 'Everything — unlimited, priority, early access',
    priceGBP: 9.99,
    stripePriceId: process.env.STRIPE_PRICE_PREMIUM || null,
  },
};

/**
 * Look up a plan by tier name.
 * @param {string} tier - 'pro' or 'premium'
 * @returns {{ name: string, priceGBP: number, stripePriceId: string | null } | null}
 */
function getPlan(tier) {
  return PLANS[tier] || null;
}

/**
 * Look up a tier name by Stripe Price ID.
 * Used when processing webhooks.
 * @param {string} priceId
 * @returns {string | null}
 */
function getTierByPriceId(priceId) {
  for (const [tier, plan] of Object.entries(PLANS)) {
    if (plan.stripePriceId === priceId) return tier;
  }
  return null;
}

module.exports = { PLANS, getPlan, getTierByPriceId };

/**
 * plans.js — Stripe price/product mapping.
 *
 * Maps internal tier names to Stripe Price IDs.
 * Set this env var to your actual Stripe Price ID:
 *
 *   STRIPE_PRICE_PRO=price_xxx
 *
 * Each plan also carries metadata for fallback display.
 */

const PLANS = {
  pro: {
    name: 'Guarded',
    description: 'Full safety suite for regular walkers',
    priceGBP: 4.99,
    stripePriceId: process.env.STRIPE_PRICE_PRO || null,
  },
  family: {
    name: 'Family & Friends Pack',
    description: 'Guarded for 3+ people at £3/user/month',
    priceGBP: 3.00,
    stripePriceId: process.env.STRIPE_PRICE_FAMILY || null,
  },
};

/**
 * Look up a plan by tier name.
 * @param {string} tier - 'pro'
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

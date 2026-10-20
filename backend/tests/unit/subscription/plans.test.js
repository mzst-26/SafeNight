/**
 * Unit tests for subscription/lib/plans.js (Stripe price mapping).
 *
 * The module reads STRIPE_PRICE_* at require time, so each scenario loads
 * a fresh copy with its own environment. No network, no Stripe calls.
 */

const FAKE_PRO_PRICE = 'price_fake_pro';
const FAKE_FAMILY_PRICE = 'price_fake_family';

function loadPlans(env = {}) {
  const saved = { PRO: process.env.STRIPE_PRICE_PRO, FAMILY: process.env.STRIPE_PRICE_FAMILY };
  try {
    if (env.PRO === undefined) delete process.env.STRIPE_PRICE_PRO;
    else process.env.STRIPE_PRICE_PRO = env.PRO;
    if (env.FAMILY === undefined) delete process.env.STRIPE_PRICE_FAMILY;
    else process.env.STRIPE_PRICE_FAMILY = env.FAMILY;

    let mod;
    jest.isolateModules(() => {
      mod = require('../../../src/subscription/lib/plans');
    });
    return mod;
  } finally {
    if (saved.PRO === undefined) delete process.env.STRIPE_PRICE_PRO;
    else process.env.STRIPE_PRICE_PRO = saved.PRO;
    if (saved.FAMILY === undefined) delete process.env.STRIPE_PRICE_FAMILY;
    else process.env.STRIPE_PRICE_FAMILY = saved.FAMILY;
  }
}

describe('PLANS catalogue', () => {
  test('defines exactly the pro and family plans', () => {
    const { PLANS } = loadPlans({ PRO: FAKE_PRO_PRICE, FAMILY: FAKE_FAMILY_PRICE });
    expect(Object.keys(PLANS)).toEqual(['pro', 'family']);
  });

  test('pro plan has the Guarded name and GBP 4.99 price', () => {
    const { PLANS } = loadPlans({ PRO: FAKE_PRO_PRICE, FAMILY: FAKE_FAMILY_PRICE });
    expect(PLANS.pro.name).toBe('Guarded');
    expect(PLANS.pro.priceGBP).toBe(4.99);
    expect(PLANS.pro.description).toBe('Full safety suite for regular walkers');
  });

  test('family plan is GBP 3.00 per user', () => {
    const { PLANS } = loadPlans({ PRO: FAKE_PRO_PRICE, FAMILY: FAKE_FAMILY_PRICE });
    expect(PLANS.family.name).toBe('Family & Friends Pack');
    expect(PLANS.family.priceGBP).toBe(3.0);
    expect(PLANS.family.description).toBe('Guarded for 3+ people at £3/user/month');
  });

  test('stripePriceId is read from the environment for each plan', () => {
    const { PLANS } = loadPlans({ PRO: FAKE_PRO_PRICE, FAMILY: FAKE_FAMILY_PRICE });
    expect(PLANS.pro.stripePriceId).toBe(FAKE_PRO_PRICE);
    expect(PLANS.family.stripePriceId).toBe(FAKE_FAMILY_PRICE);
  });

  test('stripePriceId is null when the env vars are unset', () => {
    const { PLANS } = loadPlans({});
    expect(PLANS.pro.stripePriceId).toBeNull();
    expect(PLANS.family.stripePriceId).toBeNull();
  });
});

describe('getPlan', () => {
  const mod = loadPlans({ PRO: FAKE_PRO_PRICE, FAMILY: FAKE_FAMILY_PRICE });

  test('returns the pro plan with its Stripe price id', () => {
    expect(mod.getPlan('pro')).toEqual({
      name: 'Guarded',
      description: 'Full safety suite for regular walkers',
      priceGBP: 4.99,
      stripePriceId: FAKE_PRO_PRICE,
    });
  });

  test('returns the family plan', () => {
    expect(mod.getPlan('family').priceGBP).toBe(3.0);
  });

  test('returns null for the free tier (no Stripe plan)', () => {
    expect(mod.getPlan('free')).toBeNull();
  });

  test('returns null for an unknown tier such as premium', () => {
    expect(mod.getPlan('premium')).toBeNull();
  });

  test('returns null for an empty or undefined tier', () => {
    expect(mod.getPlan('')).toBeNull();
    expect(mod.getPlan(undefined)).toBeNull();
  });

  test('returns null for inherited Object.prototype keys, not a plan', () => {
    // Expected: only own plan keys resolve. Known defect candidate: PLANS[tier] || null
    // returns Object.prototype members such as 'constructor' instead of null.
    expect(mod.getPlan('constructor')).toBeNull();
    expect(mod.getPlan('__proto__')).toBeNull();
  });
});

describe('getTierByPriceId', () => {
  const mod = loadPlans({ PRO: FAKE_PRO_PRICE, FAMILY: FAKE_FAMILY_PRICE });

  test('maps the pro price id to the pro tier', () => {
    expect(mod.getTierByPriceId(FAKE_PRO_PRICE)).toBe('pro');
  });

  test('maps the family price id to the family tier', () => {
    expect(mod.getTierByPriceId(FAKE_FAMILY_PRICE)).toBe('family');
  });

  test('returns null for an unrecognised price id', () => {
    expect(mod.getTierByPriceId('price_fake_unknown')).toBeNull();
  });

  test('returns null when the webhook price id is null', () => {
    expect(mod.getTierByPriceId(null)).toBeNull();
  });

  test('returns null for null price id when no price env vars are configured', () => {
    // Expected: no plan has a price id, so a null price id must not match any tier.
    // Known defect candidate: plan.stripePriceId === null is true for unset env vars,
    // so getTierByPriceId(null) returns 'pro'.
    const unconfigured = loadPlans({});
    expect(unconfigured.getTierByPriceId(null)).toBeNull();
    expect(unconfigured.getTierByPriceId(undefined)).toBeNull();
  });
});

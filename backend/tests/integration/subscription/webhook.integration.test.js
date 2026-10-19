/**
 * Stripe webhook — signature verification and replay safety.
 *
 * Uses a webhook secret generated in this test (never a real one) and the
 * Stripe SDK's offline signature helper. Supabase and the Stripe API are
 * mocked; nothing leaves the process.
 */

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const Stripe = require('stripe');
const { createFakeSupabase, hasFilter } = require('./helpers/fakeSupabase');

const TEST_WEBHOOK_SECRET = `whsec_test_${crypto.randomBytes(16).toString('hex')}`;
process.env.STRIPE_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;
process.env.STRIPE_PRICE_PRO = 'price_test_pro';
process.env.STRIPE_PRICE_FAMILY = 'price_test_family';

// Offline Stripe instance — used only for webhook signing/verification helpers.
const mockOfflineStripe = new Stripe('sk_test_offline_dummy_key');

let mockResolve = () => ({ data: null, error: null });
let mockFake = createFakeSupabase((q) => mockResolve(q));
const mockSubscriptionsRetrieve = jest.fn();

jest.mock('../../../src/user/lib/supabase', () => ({
  supabase: { from: (...args) => mockFake.supabase.from(...args) },
}));

jest.mock('../../../src/subscription/lib/stripeClient', () => ({
  getStripe: () => ({
    webhooks: mockOfflineStripe.webhooks,
    subscriptions: { retrieve: (...args) => mockSubscriptionsRetrieve(...args) },
  }),
}));

jest.mock('../../../src/shared/familyContacts', () => ({
  syncFamilyPackContacts: jest.fn(async () => {}),
}));

jest.mock('../../../src/user/routes/family', () => ({
  revokeFamilyPack: jest.fn(async () => {}),
}));

const webhookModule = require('../../../src/subscription/routes/webhook');
const { stripeWebhookHandler } = webhookModule;

function createApp() {
  const app = express();
  app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), stripeWebhookHandler);
  return app;
}

let eventCounter = 0;
function makeEvent(type, object, id) {
  eventCounter += 1;
  return { id: id || `evt_test_${eventCounter}_${Date.now()}`, object: 'event', type, data: { object } };
}

function signedPost(app, event, { secret = TEST_WEBHOOK_SECRET, timestamp } = {}) {
  const payload = JSON.stringify(event);
  const header = mockOfflineStripe.webhooks.generateTestHeaderString({ payload, secret, timestamp });
  return request(app)
    .post('/api/stripe/webhook')
    .set('Content-Type', 'application/json')
    .set('Stripe-Signature', header)
    .send(payload);
}

function writes(table, op) {
  return mockFake.calls.filter((q) => q.table === table && q.op === op);
}

beforeEach(() => {
  mockResolve = () => ({ data: null, error: null });
  mockFake = createFakeSupabase((q) => mockResolve(q));
  mockSubscriptionsRetrieve.mockReset();
  if (typeof webhookModule._resetProcessedEvents === 'function') webhookModule._resetProcessedEvents();
});

describe('Stripe webhook signature verification', () => {
  test('rejects a request with no Stripe-Signature header', async () => {
    const res = await request(createApp())
      .post('/api/stripe/webhook')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(makeEvent('invoice.payment_failed', { customer: 'cus_x' })));
    expect(res.status).toBe(400);
    expect(mockFake.calls).toHaveLength(0);
  });

  test('rejects a request signed with the wrong secret', async () => {
    const res = await signedPost(createApp(), makeEvent('invoice.payment_failed', { customer: 'cus_x' }), {
      secret: `whsec_test_${crypto.randomBytes(16).toString('hex')}`,
    });
    expect(res.status).toBe(400);
    expect(mockFake.calls).toHaveLength(0);
  });

  test('rejects a body that was altered after signing', async () => {
    const event = makeEvent('invoice.payment_failed', { customer: 'cus_x' });
    const payload = JSON.stringify(event);
    const header = mockOfflineStripe.webhooks.generateTestHeaderString({ payload, secret: TEST_WEBHOOK_SECRET });
    const tampered = payload.replace('cus_x', 'cus_y');
    const res = await request(createApp())
      .post('/api/stripe/webhook')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', header)
      .send(tampered);
    expect(res.status).toBe(400);
    expect(mockFake.calls).toHaveLength(0);
  });

  test('rejects a validly signed event whose timestamp is outside the tolerance (old replay)', async () => {
    const res = await signedPost(createApp(), makeEvent('invoice.payment_failed', { customer: 'cus_x' }), {
      timestamp: Math.floor(Date.now() / 1000) - 60 * 60,
    });
    expect(res.status).toBe(400);
    expect(mockFake.calls).toHaveLength(0);
  });

  test('accepts a correctly signed event', async () => {
    const res = await signedPost(createApp(), makeEvent('customer.created', { id: 'cus_x' }));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });
  });
});

describe('Stripe webhook replay safety', () => {
  const checkoutSession = {
    id: 'cs_test_1',
    object: 'checkout.session',
    mode: 'subscription',
    status: 'complete',
    payment_status: 'paid',
    customer: 'cus_a',
    subscription: 'sub_a',
    metadata: { supabase_user_id: 'user-a', tier: 'pro' },
  };

  test('the same event id delivered twice is processed only once', async () => {
    mockSubscriptionsRetrieve.mockResolvedValue({ id: 'sub_a', status: 'active' });
    const app = createApp();
    const event = makeEvent('checkout.session.completed', checkoutSession, 'evt_dup_1');

    await signedPost(app, event);
    const insertsAfterFirst = writes('subscriptions', 'insert').length;
    expect(insertsAfterFirst).toBe(1);

    const second = await signedPost(app, event);
    expect(second.status).toBe(200);
    expect(writes('subscriptions', 'insert').length).toBe(insertsAfterFirst);
  });

  test('a replayed checkout.session.completed (new event id) does not re-grant an already recorded subscription', async () => {
    mockSubscriptionsRetrieve.mockResolvedValue({ id: 'sub_a', status: 'active' });
    // A subscriptions row for sub_a already exists (it was later cancelled).
    mockResolve = (q) => {
      if (q.table === 'subscriptions' && q.op === 'select' && hasFilter(q, 'eq', 'payment_ref', 'sub_a')) {
        return { data: { id: 'row-1', status: 'cancelled' } };
      }
      return { data: null };
    };

    const res = await signedPost(createApp(), makeEvent('checkout.session.completed', checkoutSession));
    expect(res.status).toBe(200);
    expect(writes('subscriptions', 'insert')).toHaveLength(0);
    expect(writes('profiles', 'update').filter((q) => q.payload.subscription)).toHaveLength(0);
  });

  test('checkout.session.completed is not honoured when Stripe says the subscription is no longer active', async () => {
    mockSubscriptionsRetrieve.mockResolvedValue({ id: 'sub_a', status: 'canceled' });
    const res = await signedPost(createApp(), makeEvent('checkout.session.completed', checkoutSession));
    expect(res.status).toBe(200);
    expect(writes('subscriptions', 'insert')).toHaveLength(0);
  });

  test('a stale customer.subscription.updated (status active) does not turn the free row back into pro after cancellation', async () => {
    // Stripe's live view: the subscription is cancelled.
    mockSubscriptionsRetrieve.mockResolvedValue({
      id: 'sub_a',
      status: 'canceled',
      items: { data: [{ price: { id: 'price_test_pro' } }] },
      current_period_end: Math.floor(Date.now() / 1000) + 86400 * 20,
    });
    const staleObject = {
      id: 'sub_a',
      object: 'subscription',
      status: 'active',
      customer: 'cus_a',
      metadata: { supabase_user_id: 'user-a', tier: 'pro' },
      items: { data: [{ price: { id: 'price_test_pro' } }] },
      current_period_end: Math.floor(Date.now() / 1000) + 86400 * 20,
    };

    await signedPost(createApp(), makeEvent('customer.subscription.updated', staleObject));

    const proGrants = mockFake.calls.filter(
      (q) => q.op === 'update' && q.payload && (q.payload.tier === 'pro' || q.payload.subscription === 'pro'),
    );
    expect(proGrants).toHaveLength(0);
  });

  test('customer.subscription.updated only updates the local row for that Stripe subscription', async () => {
    mockSubscriptionsRetrieve.mockResolvedValue({
      id: 'sub_a',
      status: 'active',
      items: { data: [{ price: { id: 'price_test_pro' } }] },
      current_period_end: Math.floor(Date.now() / 1000) + 86400 * 30,
    });
    mockResolve = (q) => {
      if (q.table === 'subscriptions' && q.op === 'select' && hasFilter(q, 'eq', 'payment_ref', 'sub_a')) {
        return { data: [{ id: 'row-a' }] };
      }
      return { data: null };
    };

    await signedPost(
      createApp(),
      makeEvent('customer.subscription.updated', {
        id: 'sub_a',
        status: 'active',
        customer: 'cus_a',
        metadata: { supabase_user_id: 'user-a' },
      }),
    );

    const subUpdates = writes('subscriptions', 'update');
    expect(subUpdates.length).toBeGreaterThan(0);
    for (const q of subUpdates) {
      expect(hasFilter(q, 'eq', 'payment_ref', 'sub_a')).toBe(true);
    }
  });

  test('a family-pack price on subscription.updated keeps the owner on the pro entitlement', async () => {
    mockSubscriptionsRetrieve.mockResolvedValue({
      id: 'sub_fam',
      status: 'active',
      items: { data: [{ price: { id: 'price_test_family' } }] },
      current_period_end: Math.floor(Date.now() / 1000) + 86400 * 30,
    });
    mockResolve = (q) => {
      if (q.table === 'subscriptions' && q.op === 'select' && hasFilter(q, 'eq', 'payment_ref', 'sub_fam')) {
        return { data: [{ id: 'row-f' }] };
      }
      return { data: null };
    };

    await signedPost(
      createApp(),
      makeEvent('customer.subscription.updated', {
        id: 'sub_fam',
        status: 'active',
        customer: 'cus_a',
        metadata: { supabase_user_id: 'user-a', tier: 'family' },
      }),
    );

    const tierWrites = mockFake.calls.filter((q) => q.op === 'update' && q.payload && (q.payload.tier || q.payload.subscription));
    expect(tierWrites.length).toBeGreaterThan(0);
    for (const q of tierWrites) {
      expect([q.payload.tier, q.payload.subscription].filter(Boolean)).toEqual(expect.arrayContaining(['pro']));
      expect(q.payload.tier === 'family' || q.payload.subscription === 'family').toBe(false);
    }
  });

  test('a replayed customer.subscription.deleted for an old subscription does not cancel the user\'s newer subscription', async () => {
    // The user's only active paid row belongs to sub_new, not sub_old.
    mockResolve = (q) => {
      if (q.table === 'subscriptions' && q.op === 'update' && hasFilter(q, 'eq', 'payment_ref', 'sub_old')) {
        return { data: [] }; // nothing matched — old sub already cancelled
      }
      if (q.table === 'subscriptions' && q.op === 'select' && hasFilter(q, 'neq', 'tier', 'free')) {
        return { data: [{ id: 'row-new', tier: 'pro' }] };
      }
      return { data: null };
    };

    await signedPost(
      createApp(),
      makeEvent('customer.subscription.deleted', {
        id: 'sub_old',
        status: 'canceled',
        customer: 'cus_a',
        metadata: { supabase_user_id: 'user-a' },
      }),
    );

    const cancelWrites = writes('subscriptions', 'update').filter((q) => q.payload.status === 'cancelled');
    for (const q of cancelWrites) {
      expect(hasFilter(q, 'eq', 'payment_ref', 'sub_old')).toBe(true);
    }
    expect(writes('profiles', 'update').filter((q) => q.payload.subscription === 'free')).toHaveLength(0);
    expect(writes('subscriptions', 'insert')).toHaveLength(0);
  });

  test('customer.subscription.deleted for the current subscription reverts the user to free once', async () => {
    mockResolve = (q) => {
      if (q.table === 'family_packs') return { data: null };
      if (q.table === 'subscriptions' && q.op === 'update' && hasFilter(q, 'eq', 'payment_ref', 'sub_a')) {
        return { data: [{ id: 'row-a' }] };
      }
      return { data: null };
    };

    await signedPost(
      createApp(),
      makeEvent('customer.subscription.deleted', {
        id: 'sub_a',
        status: 'canceled',
        customer: 'cus_a',
        metadata: { supabase_user_id: 'user-a' },
      }),
    );

    expect(writes('profiles', 'update').filter((q) => q.payload.subscription === 'free')).toHaveLength(1);
    expect(writes('subscriptions', 'insert').filter((q) => q.payload.tier === 'free')).toHaveLength(1);
  });
});

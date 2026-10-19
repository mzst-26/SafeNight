/**
 * Subscription service user-facing Stripe routes — authorization and
 * server-side trust checks. Stripe and Supabase are mocked.
 */

const express = require('express');
const request = require('supertest');
const { createFakeSupabase, hasFilter } = require('./helpers/fakeSupabase');

process.env.STRIPE_PRICE_PRO = 'price_test_pro';
process.env.STRIPE_PRICE_FAMILY = 'price_test_family';
process.env.FRONTEND_URL = 'https://app.safenight.test';
process.env.ALLOWED_ORIGINS = 'https://app.safenight.test,https://www.safenight.test';

jest.mock('../../../src/user/middleware/authMiddleware', () => ({
  requireAuth: (req, res, next) => {
    req.user = { id: 'user-a', email: 'a@example.test' };
    next();
  },
}));

let mockResolve = () => ({ data: null, error: null });
let mockFake = createFakeSupabase((q) => mockResolve(q));
jest.mock('../../../src/user/lib/supabase', () => ({
  supabase: { from: (...args) => mockFake.supabase.from(...args) },
}));

const mockStripe = {
  customers: { retrieve: jest.fn(), list: jest.fn(), create: jest.fn() },
  subscriptions: { list: jest.fn(), cancel: jest.fn(), update: jest.fn() },
  checkout: { sessions: { create: jest.fn() } },
  billingPortal: { sessions: { create: jest.fn() } },
  invoices: { list: jest.fn() },
  refunds: { create: jest.fn() },
};
jest.mock('../../../src/subscription/lib/stripeClient', () => ({
  getStripe: () => mockStripe,
}));

const stripeRoutes = require('../../../src/subscription/routes/stripe');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/stripe', stripeRoutes);
  app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));
  return app;
}

const DAY = 24 * 60 * 60;

beforeEach(() => {
  mockFake = createFakeSupabase((q) => mockResolve(q));
  for (const group of Object.values(mockStripe)) {
    for (const fn of Object.values(group)) {
      if (typeof fn === 'function') fn.mockReset();
      else for (const inner of Object.values(fn)) inner.mockReset();
    }
  }
  mockStripe.customers.retrieve.mockResolvedValue({ id: 'cus_a' });
  mockStripe.subscriptions.list.mockResolvedValue({ data: [] });
  mockStripe.checkout.sessions.create.mockResolvedValue({ id: 'cs_1', url: 'https://checkout.stripe.test/cs_1' });
  mockStripe.billingPortal.sessions.create.mockResolvedValue({ url: 'https://billing.stripe.test/p' });
  mockResolve = (q) => {
    if (q.table === 'profiles' && q.op === 'select') {
      return { data: { email: 'a@example.test', name: 'A', stripe_customer_id: 'cus_a', refund_ineligible: false } };
    }
    return { data: null };
  };
});

describe('return_url handling (open redirect)', () => {
  test('create-checkout ignores an attacker-controlled return_url', async () => {
    const res = await request(createApp())
      .post('/api/stripe/create-checkout')
      .send({ tier: 'pro', return_url: 'https://evil.example/phish' });

    expect(res.status).toBe(200);
    const args = mockStripe.checkout.sessions.create.mock.calls[0][0];
    expect(args.success_url.startsWith('https://app.safenight.test')).toBe(true);
    expect(args.cancel_url.startsWith('https://app.safenight.test')).toBe(true);
    expect(JSON.stringify(args)).not.toContain('evil.example');
  });

  test('create-checkout keeps an allowed return_url', async () => {
    await request(createApp())
      .post('/api/stripe/create-checkout')
      .send({ tier: 'pro', return_url: 'https://www.safenight.test/account' });

    const args = mockStripe.checkout.sessions.create.mock.calls[0][0];
    expect(args.success_url.startsWith('https://www.safenight.test/account?')).toBe(true);
  });

  test('create-checkout rejects a javascript: return_url', async () => {
    await request(createApp())
      .post('/api/stripe/create-checkout')
      .send({ tier: 'pro', return_url: 'javascript:alert(1)' });

    const args = mockStripe.checkout.sessions.create.mock.calls[0][0];
    expect(args.success_url.startsWith('https://app.safenight.test')).toBe(true);
  });

  test('create-portal ignores an attacker-controlled return_url', async () => {
    const res = await request(createApp())
      .post('/api/stripe/create-portal')
      .send({ return_url: 'https://evil.example/' });

    expect(res.status).toBe(200);
    const args = mockStripe.billingPortal.sessions.create.mock.calls[0][0];
    expect(args.customer).toBe('cus_a');
    expect(args.return_url).toBe('https://app.safenight.test');
  });

  test('create-family-checkout ignores an attacker-controlled return_url', async () => {
    mockResolve = (q) => {
      if (q.table === 'family_packs') return { data: { id: 'pack-1', owner_id: 'user-a', max_members: 3, status: 'pending' } };
      if (q.table === 'profiles') return { data: { email: 'a@example.test', name: 'A', stripe_customer_id: 'cus_a' } };
      return { data: null };
    };
    await request(createApp())
      .post('/api/stripe/create-family-checkout')
      .send({ pack_id: 'pack-1', return_url: 'https://evil.example/' });

    const args = mockStripe.checkout.sessions.create.mock.calls[0][0];
    expect(JSON.stringify(args)).not.toContain('evil.example');
  });
});

describe('checkout price and identity come from the server', () => {
  test('client-sent price fields are ignored and metadata uses the token user', async () => {
    await request(createApp())
      .post('/api/stripe/create-checkout')
      .send({ tier: 'pro', price: 'price_attacker', supabase_user_id: 'user-b', quantity: 0 });

    const args = mockStripe.checkout.sessions.create.mock.calls[0][0];
    expect(args.line_items).toEqual([{ price: 'price_test_pro', quantity: 1 }]);
    expect(args.metadata.supabase_user_id).toBe('user-a');
    expect(args.subscription_data.metadata.supabase_user_id).toBe('user-a');
  });

  test('a tier other than pro is refused', async () => {
    const res = await request(createApp()).post('/api/stripe/create-checkout').send({ tier: 'family' });
    expect(res.status).toBe(400);
    expect(mockStripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  test('family checkout for a pack owned by another user is refused', async () => {
    mockResolve = (q) => {
      if (q.table === 'family_packs') return { data: { id: 'pack-b', owner_id: 'user-b', max_members: 3, status: 'pending' } };
      return { data: null };
    };
    const res = await request(createApp()).post('/api/stripe/create-family-checkout').send({ pack_id: 'pack-b' });
    expect(res.status).toBe(403);
    expect(mockStripe.checkout.sessions.create).not.toHaveBeenCalled();
  });
});

describe('cooling-off refund window', () => {
  test('a long-running first subscription is not fully refunded just after a renewal', async () => {
    const now = Math.floor(Date.now() / 1000);
    mockStripe.subscriptions.list.mockResolvedValue({
      data: [{
        id: 'sub_a',
        cancel_at_period_end: false,
        start_date: now - 200 * DAY,           // subscribed ~6.5 months ago
        current_period_start: now - 2 * DAY,   // renewed 2 days ago
        current_period_end: now + 28 * DAY,
      }],
    });
    mockStripe.invoices.list.mockResolvedValue({
      data: Array.from({ length: 7 }, (_, i) => ({ id: `in_${i}`, payment_intent: `pi_${i}`, amount_paid: 499 })),
    });

    const res = await request(createApp()).post('/api/stripe/cancel').send({});

    expect(res.status).toBe(200);
    expect(res.body.refunded).toBe(false);
    expect(mockStripe.refunds.create).not.toHaveBeenCalled();
    expect(mockStripe.subscriptions.update).toHaveBeenCalledWith('sub_a', { cancel_at_period_end: true });
  });

  test('a first subscription cancelled within 14 days of starting is refunded', async () => {
    const now = Math.floor(Date.now() / 1000);
    mockStripe.subscriptions.list.mockResolvedValue({
      data: [{
        id: 'sub_a',
        cancel_at_period_end: false,
        start_date: now - 3 * DAY,
        current_period_start: now - 3 * DAY,
        current_period_end: now + 27 * DAY,
      }],
    });
    mockStripe.invoices.list.mockResolvedValue({ data: [{ id: 'in_1', payment_intent: 'pi_1', amount_paid: 499 }] });
    mockResolve = (q) => {
      if (q.table === 'profiles') return { data: { stripe_customer_id: 'cus_a', refund_ineligible: false } };
      if (q.table === 'subscriptions' && q.op === 'select') return { data: [] };
      return { data: null };
    };

    const res = await request(createApp()).post('/api/stripe/cancel').send({});
    expect(res.body.refunded).toBe(true);
    expect(mockStripe.refunds.create).toHaveBeenCalledTimes(1);
  });
});

describe('Stripe customer reuse by email', () => {
  test('does not link a Stripe customer that already belongs to another live profile', async () => {
    mockResolve = (q) => {
      if (q.table === 'profiles' && q.op === 'select' && hasFilter(q, 'eq', 'id', 'user-a')) {
        // New user: no customer yet
        return { data: { email: 'a@example.test', name: 'A', stripe_customer_id: null, refund_ineligible: false } };
      }
      if (q.table === 'profiles' && q.op === 'select' && hasFilter(q, 'eq', 'stripe_customer_id', 'cus_other')) {
        return { data: { id: 'user-b' } };
      }
      return { data: null };
    };
    mockStripe.customers.list.mockResolvedValue({ data: [{ id: 'cus_other' }] });
    mockStripe.subscriptions.list.mockResolvedValue({ data: [] });
    mockStripe.customers.create.mockResolvedValue({ id: 'cus_new' });

    await request(createApp()).post('/api/stripe/create-checkout').send({ tier: 'pro' });

    const linkedOther = mockFake.calls.filter(
      (q) => q.table === 'profiles' && q.op === 'update' && q.payload.stripe_customer_id === 'cus_other',
    );
    expect(linkedOther).toHaveLength(0);
    expect(mockStripe.checkout.sessions.create.mock.calls[0][0].customer).toBe('cus_new');
  });
});

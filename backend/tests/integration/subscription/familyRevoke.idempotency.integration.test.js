/**
 * Account deletion revokes owned family packs (revokeFamilyPack) and then
 * cancels the Stripe subscription, which fires customer.subscription.deleted.
 * The webhook must not revoke again or add duplicate free rows.
 *
 * Uses the real revokeFamilyPack and webhook handler against an in-memory
 * Supabase fake. The webhook secret is generated in the test.
 */

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const Stripe = require('stripe');
const { createMemorySupabase } = require('./helpers/memorySupabase');

const TEST_WEBHOOK_SECRET = `whsec_test_${crypto.randomBytes(16).toString('hex')}`;
process.env.STRIPE_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;
process.env.STRIPE_PRICE_FAMILY = 'price_test_family';

const mockOfflineStripe = new Stripe('sk_test_offline_dummy_key');
let mockDb;

jest.mock('../../../src/user/lib/supabase', () => ({
  supabase: { from: (...args) => mockDb.supabase.from(...args) },
}));
jest.mock('../../../src/user/middleware/authMiddleware', () => ({
  requireAuth: (_req, _res, next) => next(),
}));
jest.mock('../../../src/shared/familyContacts', () => ({
  syncFamilyPackContacts: jest.fn(async () => {}),
  removeFamilyPackContacts: jest.fn(async () => {}),
}));
jest.mock('../../../src/subscription/lib/stripeClient', () => ({
  getStripe: () => ({
    webhooks: mockOfflineStripe.webhooks,
    subscriptions: { retrieve: jest.fn() },
  }),
}));

const { revokeFamilyPack } = require('../../../src/user/routes/family');
const webhookModule = require('../../../src/subscription/routes/webhook');

function createApp() {
  const app = express();
  app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), webhookModule.stripeWebhookHandler);
  return app;
}

function signedPost(app, event) {
  const payload = JSON.stringify(event);
  const header = mockOfflineStripe.webhooks.generateTestHeaderString({ payload, secret: TEST_WEBHOOK_SECRET });
  return request(app)
    .post('/api/stripe/webhook')
    .set('Content-Type', 'application/json')
    .set('Stripe-Signature', header)
    .send(payload);
}

function seed() {
  const familyRow = (user_id) => ({
    user_id, tier: 'pro', status: 'active', is_family_pack: true, family_pack_id: 'pack-1', payment_ref: 'sub_fam',
  });
  return createMemorySupabase({
    family_packs: [{ id: 'pack-1', owner_id: 'owner', status: 'active', stripe_subscription_id: 'sub_fam' }],
    family_pack_members: [
      { id: 'm0', pack_id: 'pack-1', user_id: 'owner', status: 'active' },
      { id: 'm1', pack_id: 'pack-1', user_id: 'member-1', status: 'active' },
      { id: 'm2', pack_id: 'pack-1', user_id: 'member-2', status: 'active' },
    ],
    subscriptions: [familyRow('owner'), familyRow('member-1'), familyRow('member-2')],
    profiles: [
      { id: 'owner', subscription: 'pro', stripe_customer_id: 'cus_owner' },
      { id: 'member-1', subscription: 'pro' },
      { id: 'member-2', subscription: 'pro' },
    ],
    emergency_contacts: [],
    usage_events: [],
  });
}

const freeRowsFor = (userId) =>
  mockDb.table('subscriptions').filter((r) => r.user_id === userId && r.tier === 'free' && r.status === 'active');

beforeEach(() => {
  mockDb = seed();
  webhookModule._resetProcessedEvents();
});

test('revokeFamilyPack then customer.subscription.deleted leaves exactly one free row per member', async () => {
  // Step 1: account deletion revokes the owned pack.
  await revokeFamilyPack('pack-1');

  for (const id of ['owner', 'member-1', 'member-2']) expect(freeRowsFor(id)).toHaveLength(1);
  const snapshot = JSON.stringify(mockDb.tables);

  // Step 2: Stripe cancel fires customer.subscription.deleted for the pack subscription.
  const res = await signedPost(createApp(), {
    id: 'evt_fam_deleted',
    object: 'event',
    type: 'customer.subscription.deleted',
    data: { object: { id: 'sub_fam', status: 'canceled', customer: 'cus_owner', metadata: { supabase_user_id: 'owner', tier: 'family', pack_id: 'pack-1' } } },
  });

  expect(res.status).toBe(200);
  for (const id of ['owner', 'member-1', 'member-2']) expect(freeRowsFor(id)).toHaveLength(1);
  expect(mockDb.table('usage_events')).toHaveLength(0); // no second revocation / cancel log
  expect(JSON.stringify(mockDb.tables)).toBe(snapshot); // nothing changed at all
});

test('calling revokeFamilyPack twice does not add duplicate free rows', async () => {
  await revokeFamilyPack('pack-1');
  await revokeFamilyPack('pack-1');
  for (const id of ['owner', 'member-1', 'member-2']) expect(freeRowsFor(id)).toHaveLength(1);
  expect(mockDb.table('family_packs')[0].status).toBe('cancelled');
});

test('customer.subscription.deleted alone (pack still active) revokes the pack once', async () => {
  const app = createApp();
  const event = {
    id: 'evt_fam_deleted_only',
    object: 'event',
    type: 'customer.subscription.deleted',
    data: { object: { id: 'sub_fam', status: 'canceled', customer: 'cus_owner', metadata: { supabase_user_id: 'owner' } } },
  };
  await signedPost(app, event);
  await signedPost(app, { ...event, id: 'evt_fam_deleted_redelivered' });

  expect(mockDb.table('family_packs')[0].status).toBe('cancelled');
  for (const id of ['owner', 'member-1', 'member-2']) expect(freeRowsFor(id)).toHaveLength(1);
});

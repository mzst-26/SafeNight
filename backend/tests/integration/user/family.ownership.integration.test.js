const express = require('express');
const request = require('supertest');
const { createSupabaseMock, opOf } = require('../../helpers/supabaseMock');

const OWNER = 'owner-1';
let mockResolver = () => ({ data: null, error: null });
const mockDb = createSupabaseMock((q) => mockResolver(q));
mockDb.supabase.auth = { admin: { inviteUserByEmail: jest.fn(async () => ({ data: {}, error: null })) } };

jest.mock('../../../src/user/lib/supabase', () => ({ supabase: mockDb.supabase }));
jest.mock('../../../src/user/middleware/authMiddleware', () => ({
  requireAuth: (req, _res, next) => {
    req.user = { id: 'owner-1' };
    next();
  },
}));
const mockSync = jest.fn();
const mockRemoveContacts = jest.fn();
jest.mock('../../../src/shared/familyContacts', () => ({
  syncFamilyPackContacts: (...a) => mockSync(...a),
  removeFamilyPackContacts: (...a) => mockRemoveContacts(...a),
}));

function createApp() {
  let router;
  jest.isolateModules(() => {
    router = require('../../../src/user/routes/family');
  });
  const app = express();
  app.use(express.json());
  app.use('/api/family', router);
  app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));
  return app;
}

const eqArg = (q, col) => q.ops.find((o) => o.op === 'eq' && o.args[0] === col)?.args[1];
const writes = (table, op) => mockDb.calls.filter((q) => q.table === table && opOf(q, op));

describe('family pack ownership', () => {
  beforeEach(() => {
    mockDb.calls.length = 0;
    mockSync.mockClear();
    mockRemoveContacts.mockClear();
  });

  test('remove-member: a user who owns no active pack gets 404 and nothing changes', async () => {
    mockResolver = () => ({ data: null, error: null });
    const res = await request(createApp()).post('/api/family/remove-member').send({ member_id: 'm-of-someone-else' });
    expect(res.status).toBe(404);
    expect(writes('family_pack_members', 'update')).toHaveLength(0);
  });

  test('remove-member: member lookup is scoped to the caller\'s own pack', async () => {
    mockResolver = (q) => {
      if (q.table === 'family_packs') return { data: { id: 'my-pack' }, error: null };
      return { data: null, error: null }; // member not in my pack
    };
    const res = await request(createApp()).post('/api/family/remove-member').send({ member_id: 'other-pack-member' });
    expect(res.status).toBe(404);
    const memberLookup = mockDb.calls.find((q) => q.table === 'family_pack_members');
    expect(eqArg(memberLookup, 'pack_id')).toBe('my-pack');
  });

  test('remove-member: requires email or member_id; refuses the owner and the minimum', async () => {
    mockResolver = (q) => (q.table === 'family_packs' ? { data: { id: 'my-pack' }, error: null } : { data: null, error: null });
    expect((await request(createApp()).post('/api/family/remove-member').send({})).status).toBe(400);

    mockResolver = (q) => {
      if (q.table === 'family_packs') return { data: { id: 'my-pack' }, error: null };
      return { data: { id: 'm0', role: 'owner', email: 'o@example.com' }, error: null };
    };
    expect((await request(createApp()).post('/api/family/remove-member').send({ member_id: 'm0' })).status).toBe(400);

    mockResolver = (q) => {
      if (q.table === 'family_packs') return { data: { id: 'my-pack' }, error: null };
      if (opOf(q, 'maybeSingle') || opOf(q, 'single')) return { data: { id: 'm1', role: 'member', email: 'm@example.com' }, error: null };
      return { data: null, count: 3, error: null };
    };
    expect((await request(createApp()).post('/api/family/remove-member').send({ email: 'm@example.com' })).status).toBe(400);
  });

  test('remove-member: owner removes a member of their own pack', async () => {
    mockResolver = (q) => {
      if (q.table === 'family_packs' && (opOf(q, 'single') || opOf(q, 'maybeSingle'))) {
        return { data: { id: 'my-pack', stripe_subscription_id: null }, error: null };
      }
      if (q.table === 'family_pack_members' && opOf(q, 'single')) {
        return { data: { id: 'm1', role: 'member', email: 'm@example.com', user_id: 'member-user' }, error: null };
      }
      return { data: null, count: 5, error: null };
    };
    const res = await request(createApp()).post('/api/family/remove-member').send({ member_id: 'm1' });
    expect(res.status).toBe(200);
    expect(mockRemoveContacts).toHaveBeenCalledWith('member-user', 'my-pack');
    const subUpdate = writes('subscriptions', 'update')[0];
    expect(eqArg(subUpdate, 'user_id')).toBe('member-user');
  });

  test('checkout: only the pack owner may check out', async () => {
    mockResolver = () => ({ data: { id: 'p', owner_id: 'someone-else', max_members: 3, status: 'pending' }, error: null });
    expect((await request(createApp()).post('/api/family/checkout').send({ pack_id: 'p' })).status).toBe(403);

    mockResolver = () => ({ data: null, error: null });
    expect((await request(createApp()).post('/api/family/checkout').send({ pack_id: 'p' })).status).toBe(404);

    mockResolver = () => ({ data: { id: 'p', owner_id: OWNER, max_members: 3, status: 'active' }, error: null });
    expect((await request(createApp()).post('/api/family/checkout').send({ pack_id: 'p' })).status).toBe(400);

    mockResolver = (q) => (q.table === 'family_packs'
      ? { data: { id: 'p', owner_id: OWNER, max_members: 3, status: 'pending' }, error: null }
      : { data: { email: 'o@example.com' }, error: null });
    const ok = await request(createApp()).post('/api/family/checkout').send({ pack_id: 'p' });
    expect(ok.status).toBe(200);
    expect(ok.body.totalMembers).toBe(3);
  });

  test.each(['update-member-email', 'resend-invite'])('%s: scoped to the caller\'s pack and pending non-owner members', async (route) => {
    const send = (b) => request(createApp()).post(`/api/family/${route}`).send(b);
    const body = { member_id: 'm1', new_email: 'new@example.com' };

    expect((await send({})).status).toBe(400);

    mockResolver = () => ({ data: null, error: null });
    expect((await send(body)).status).toBe(404); // no pack

    mockResolver = (q) => (q.table === 'family_packs' ? { data: { id: 'my-pack' }, error: null } : { data: null, error: null });
    expect((await send(body)).status).toBe(404); // member not in my pack
    const memberLookup = mockDb.calls.filter((q) => q.table === 'family_pack_members').pop();
    expect(eqArg(memberLookup, 'pack_id')).toBe('my-pack');

    mockResolver = (q) => (q.table === 'family_packs'
      ? { data: { id: 'my-pack' }, error: null }
      : { data: { id: 'm1', role: 'owner', status: 'active', email: 'o@example.com' }, error: null });
    expect((await send(body)).status).toBe(400);

    mockResolver = (q) => (q.table === 'family_packs'
      ? { data: { id: 'my-pack' }, error: null }
      : { data: { id: 'm1', role: 'member', status: 'active', email: 'm@example.com' }, error: null });
    expect((await send(body)).status).toBe(400);

    mockResolver = (q) => {
      if (q.table === 'family_packs') return { data: { id: 'my-pack' }, error: null };
      if (q.table === 'profiles') return { data: { name: 'Owner' }, error: null };
      if (q.table === 'family_pack_members' && opOf(q, 'maybeSingle')) return { data: null, error: null };
      return { data: { id: 'm1', role: 'member', status: 'pending', email: 'm@example.com' }, error: null };
    };
    const ok = await send(body);
    expect(ok.status).toBe(200);
    expect(ok.body.emailSent).toBe(true);
  });

  test('update-member-email rejects a bad email', async () => {
    const res = await request(createApp()).post('/api/family/update-member-email').send({ member_id: 'm1', new_email: 'nope' });
    expect(res.status).toBe(400);
  });

  test('my-pack: returns null when the user has no pack', async () => {
    mockResolver = () => ({ data: null, error: null });
    const res = await request(createApp()).get('/api/family/my-pack');
    expect(res.status).toBe(200);
    expect(res.body.pack).toBeNull();
  });

  test('my-pack: owner sees their pack and members', async () => {
    mockResolver = (q) => {
      if (q.table === 'family_packs') {
        return { data: { id: 'p', owner_id: OWNER, name: 'P', status: 'active', max_members: 3, price_per_user: '3.00' }, error: null };
      }
      if (q.table === 'family_pack_members') {
        return { data: [{ id: 'm', status: 'active' }, { id: 'n', status: 'pending' }], error: null };
      }
      return { data: { name: 'Owner', email: 'o@example.com' }, error: null };
    };
    const res = await request(createApp()).get('/api/family/my-pack');
    expect(res.body.role).toBe('owner');
    expect(res.body.stats).toEqual({ active: 1, pending: 1, total: 2, vacantSlots: 1 });
    const membersQuery = mockDb.calls.find((q) => q.table === 'family_pack_members');
    expect(eqArg(membersQuery, 'pack_id')).toBe('p');
  });

  test('my-pack: member sees the pack they belong to', async () => {
    mockResolver = (q) => {
      if (q.table === 'family_packs' && eqArg(q, 'owner_id')) return { data: null, error: null };
      if (q.table === 'family_packs') {
        return { data: { id: 'p2', owner_id: 'other', status: 'active', max_members: 3, price_per_user: '3' }, error: null };
      }
      if (q.table === 'family_pack_members' && opOf(q, 'maybeSingle')) {
        return { data: { pack_id: 'p2', role: 'member', status: 'active' }, error: null };
      }
      if (q.table === 'family_pack_members') return { data: [], error: null };
      return { data: { email: 'me@example.com', name: 'X' }, error: null };
    };
    const res = await request(createApp()).get('/api/family/my-pack');
    expect(res.body.role).toBe('member');
    expect(res.body.pack.id).toBe('p2');
  });

  test('activate: only activates the caller\'s own pending membership', async () => {
    mockResolver = () => ({ data: null, error: null });
    expect((await request(createApp()).post('/api/family/activate')).status).toBe(404);

    mockResolver = (q) => (q.table === 'profiles' ? { data: { email: 'me@example.com' }, error: null } : { data: null, error: null });
    expect((await request(createApp()).post('/api/family/activate')).body.activated).toBe(false);

    mockResolver = (q) => {
      if (q.table === 'profiles') return { data: { email: 'me@example.com' }, error: null };
      if (q.table === 'family_pack_members') return { data: { id: 'm', pack_id: 'p', status: 'pending' }, error: null };
      return { data: null, error: null };
    };
    expect((await request(createApp()).post('/api/family/activate')).body.activated).toBe(false);

    mockResolver = (q) => {
      if (q.table === 'profiles') return { data: { email: 'me@example.com' }, error: null };
      if (q.table === 'family_pack_members' && !opOf(q, 'update')) return { data: { id: 'm', pack_id: 'p', status: 'pending' }, error: null };
      if (q.table === 'family_packs') return { data: { id: 'p', status: 'active' }, error: null };
      return { data: null, error: null };
    };
    mockDb.calls.length = 0;
    const res = await request(createApp()).post('/api/family/activate');
    expect(res.body.activated).toBe(true);
    const memberLookup = mockDb.calls.find((q) => q.table === 'family_pack_members' && !opOf(q, 'update'));
    expect(eqArg(memberLookup, 'email')).toBe('me@example.com');
    const subInsert = writes('subscriptions', 'insert')[0];
    expect(opOf(subInsert, 'insert').args[0].user_id).toBe(OWNER);
  });

  test('cancel: no pack is 404, already cancelling is 400', async () => {
    mockResolver = () => ({ data: null, error: null });
    expect((await request(createApp()).post('/api/family/cancel')).status).toBe(404);
    mockResolver = (q) => (q.table === 'family_packs' ? { data: { id: 'p', status: 'cancelling' }, error: null } : { data: [], error: null });
    expect((await request(createApp()).post('/api/family/cancel')).status).toBe(400);
  });

  test('cancel: pack without a Stripe subscription is revoked for every member', async () => {
    mockResolver = (q) => {
      if (q.table === 'family_packs' && opOf(q, 'single')) return { data: { id: 'p', status: 'active', stripe_subscription_id: null }, error: null };
      if (q.table === 'family_pack_members' && !opOf(q, 'update')) {
        return { data: [{ user_id: 'u1' }, { user_id: 'u2' }, { user_id: null }], error: null };
      }
      return { data: [], error: null };
    };
    const res = await request(createApp()).post('/api/family/cancel');
    expect(res.status).toBe(200);
    expect(res.body.refunded).toBe(true);
    expect(writes('emergency_contacts', 'delete')).toHaveLength(1);
    expect(writes('profiles', 'update')).toHaveLength(2);
  });

  test('add-member: requires an active pack owned by the caller', async () => {
    mockResolver = () => ({ data: null, error: null });
    const res = await request(createApp()).post('/api/family/add-member').send({ email: 'n@example.com' });
    expect(res.status).toBe(404);
    expect(writes('family_pack_members', 'insert')).toHaveLength(0);
  });

  test('add-member: duplicate email in pack is 409', async () => {
    mockResolver = (q) => {
      if (q.table === 'family_packs') return { data: { id: 'p', max_members: 3, status: 'active' }, error: null };
      if (q.table === 'family_pack_members' && opOf(q, 'maybeSingle')) return { data: { id: 'x', status: 'active' }, error: null };
      return { data: null, count: 3, error: null };
    };
    expect((await request(createApp()).post('/api/family/add-member').send({ email: 'n@example.com' })).status).toBe(409);
  });

  test('add-member: new email is added as pending and invited', async () => {
    mockResolver = (q) => {
      if (q.table === 'family_packs') return { data: { id: 'p', max_members: 3, status: 'active' }, error: null };
      if (q.table === 'family_pack_members' && opOf(q, 'insert')) return { data: { id: 'new' }, error: null };
      if (q.table === 'profiles' && opOf(q, 'maybeSingle')) return { data: null, error: null };
      if (q.table === 'profiles') return { data: { name: 'Owner' }, error: null };
      return { data: null, count: 3, error: null };
    };
    const res = await request(createApp()).post('/api/family/add-member').send({ email: 'n@example.com' });
    expect(res.status).toBe(200);
    expect(res.body.activated).toBe(false);
    expect(res.body.newTotal).toBe(4);
  });

  test('create: rejects too few / too many members and a second active pack', async () => {
    expect((await request(createApp()).post('/api/family/create').send({ members: [{ email: 'a@example.com' }] })).status).toBe(400);
    const many = Array.from({ length: 25 }, (_, i) => ({ email: `m${i}@example.com` }));
    expect((await request(createApp()).post('/api/family/create').send({ members: many })).status).toBe(400);

    mockResolver = (q) => {
      if (q.table === 'profiles') return { data: { id: OWNER, email: 'o@example.com', name: 'O' }, error: null };
      if (q.table === 'family_packs') return { data: { id: 'existing' }, error: null };
      return { data: null, error: null };
    };
    const res = await request(createApp())
      .post('/api/family/create')
      .send({ members: [{ email: 'a@example.com' }, { email: 'b@example.com' }] });
    expect(res.status).toBe(409);
  });
});

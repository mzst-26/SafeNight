const express = require('express');
const request = require('supertest');
const { createSupabaseMock, opOf } = require('../../helpers/supabaseMock');

const ME = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TARGET = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

let mockResolver = () => ({ data: null, error: null });
const mockDb = createSupabaseMock((q) => mockResolver(q));

jest.mock('../../../src/user/lib/supabase', () => ({ supabase: mockDb.supabase }));
jest.mock('../../../src/user/middleware/authMiddleware', () => ({
  requireAuth: (req, _res, next) => {
    req.user = { id: ME };
    next();
  },
}));
jest.mock('../../../src/user/middleware/subscriptionMiddleware', () => ({
  checkFeatureLimit: () => (_req, _res, next) => next(),
}));
jest.mock('../../../src/user/lib/pushNotifications', () => ({ sendPush: jest.fn() }));

const contactsRouter = require('../../../src/user/routes/contacts');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/contacts', contactsRouter);
  app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));
  return app;
}

describe('contacts re-invite ownership', () => {
  beforeEach(() => {
    mockDb.calls.length = 0;
  });

  test('re-inviting after I rejected THEIR request makes me the requester, not the responder', async () => {
    // TARGET once invited ME (row user_id=TARGET, contact_id=ME) and I rejected it.
    mockResolver = (q) => {
      if (q.table === 'profiles') return { data: { id: TARGET, name: 'T' }, error: null };
      if (q.table === 'emergency_contacts' && opOf(q, 'update')) {
        return { data: { id: 'row-1', ...opOf(q, 'update').args[0] }, error: null };
      }
      if (q.table === 'emergency_contacts') {
        return { data: { id: 'row-1', status: 'rejected', user_id: TARGET, contact_id: ME }, error: null };
      }
      return { data: null, error: null };
    };

    const res = await request(createApp()).post('/api/contacts/invite').send({ contact_id: TARGET });
    expect(res.status).toBeLessThan(300);

    const update = mockDb.calls.find((q) => q.table === 'emergency_contacts' && opOf(q, 'update'));
    expect(update).toBeTruthy();
    const payload = opOf(update, 'update').args[0];
    // If the row kept contact_id=ME, I could POST /respond "accepted" to my own
    // invite and gain live-location access without TARGET's consent.
    expect(payload.user_id).toBe(ME);
    expect(payload.contact_id).toBe(TARGET);
    expect(payload.status).toBe('pending');
  });

  test('cannot respond to a request where I am the sender', async () => {
    mockResolver = (q) => {
      // respond looks up by id + contact_id=ME + pending; the row has user_id=ME, so nothing matches.
      if (q.table === 'emergency_contacts' && !opOf(q, 'update')) {
        const contactFilter = q.ops.find((o) => o.op === 'eq' && o.args[0] === 'contact_id');
        return { data: contactFilter && contactFilter.args[1] === ME ? null : { id: 'row-2' }, error: null };
      }
      return { data: null, error: null };
    };
    const res = await request(createApp())
      .post('/api/contacts/respond')
      .send({ contact_request_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', response: 'accepted' });
    expect(res.status).toBe(404);
  });
});

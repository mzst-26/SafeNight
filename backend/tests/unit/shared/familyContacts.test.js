const { createSupabaseMock, opOf } = require('../../helpers/supabaseMock');

let mockExistingStatus = null;
const mockDb = createSupabaseMock((q) => {
  if (q.table === 'family_pack_members') {
    return { data: [{ user_id: 'u1' }, { user_id: 'u2' }], error: null };
  }
  if (q.table === 'emergency_contacts' && opOf(q, 'maybeSingle')) {
    return { data: mockExistingStatus ? { id: 'row', status: mockExistingStatus } : null, error: null };
  }
  return { data: null, error: null };
});

jest.mock('../../../src/user/lib/supabase', () => ({ supabase: mockDb.supabase }));

const { syncFamilyPackContacts } = require('../../../src/shared/familyContacts');

const writes = () =>
  mockDb.calls.filter((q) => q.table === 'emergency_contacts' && (opOf(q, 'update') || opOf(q, 'insert')));

describe('syncFamilyPackContacts respects user decisions', () => {
  beforeEach(() => {
    mockDb.calls.length = 0;
  });

  test.each(['rejected', 'blocked'])('does not override a %s contact to accepted', async (status) => {
    mockExistingStatus = status;
    await syncFamilyPackContacts('pack-1');
    expect(writes()).toHaveLength(0);
  });

  test('still links members who have no relationship yet', async () => {
    mockExistingStatus = null;
    await syncFamilyPackContacts('pack-1');
    const inserts = writes().filter((q) => opOf(q, 'insert'));
    expect(inserts).toHaveLength(1);
  });
});

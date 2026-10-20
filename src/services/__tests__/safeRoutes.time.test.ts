import { cacheKey, createSearchId, fetchSafeRoutes, WALKING_SPEED_MPS } from '@/src/services/safeRoutes';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined) },
}));
jest.mock('@/src/services/userApi', () => ({
  subscriptionApi: {
    ensureFeatureAllowed: jest.fn(async () => undefined),
    consume: jest.fn(async () => undefined),
    syncFromLimitInfo: jest.fn(async () => undefined),
  },
}));

const O = { latitude: 51.5, longitude: -0.1 };
const D = { latitude: 51.52, longitude: -0.12 };
const LEAVE_1700 = { leave_at: '2026-10-21T17:00:00+01:00' };
const LEAVE_1710 = { leave_at: '2026-10-21T17:10:00+01:00' };
const LEAVE_1715 = { leave_at: '2026-10-21T17:15:00+01:00' };

describe('time in the client cache key and search id', () => {
  it('keeps the legacy key for "leave now"', () => {
    expect(cacheKey(O, D, null)).toBe('51.5000,-0.1000->51.5200,-0.1200');
    expect(cacheKey(O, D, null, {})).toBe(cacheKey(O, D, null));
  });
  it('differs by mode and by 15-minute bucket, not inside a bucket', () => {
    expect(cacheKey(O, D, null, LEAVE_1700)).toBe(cacheKey(O, D, null, LEAVE_1710));
    expect(cacheKey(O, D, null, LEAVE_1700)).not.toBe(cacheKey(O, D, null, LEAVE_1715));
    expect(cacheKey(O, D, null, LEAVE_1700)).not.toBe(cacheKey(O, D, null));
    expect(cacheKey(O, D, null, LEAVE_1700)).not.toBe(cacheKey(O, D, null, { arrive_by: LEAVE_1700.leave_at }));
  });
  it('createSearchId includes mode and bucket', () => {
    expect(createSearchId(O, D, 3, null, LEAVE_1700)).not.toBe(createSearchId(O, D, 3, null));
    expect(createSearchId(O, D, 3, null, LEAVE_1700)).toBe(createSearchId(O, D, 3, null, LEAVE_1710));
    expect(createSearchId(O, D, 3, null, LEAVE_1700)).not.toBe(createSearchId(O, D, 3, null, LEAVE_1715));
  });
});

describe('fetchSafeRoutes sends time params', () => {
  function mockBackend() {
    const fn = jest.fn(async (_url: string) => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ status: 'OK', routes: [{ routeIndex: 0, isSafest: true, overview_polyline: { points: '' }, legs: [], summary: '', safety: { breakdown: {} }, segments: [] }], meta: {} }),
    }));
    (global as any).fetch = fn;
    return fn;
  }

  it('adds nothing for leave now', async () => {
    const fn = mockBackend();
    await fetchSafeRoutes({ latitude: 52.1, longitude: -1 }, D, 'free', 3);
    const url = fn.mock.calls[0][0];
    expect(url).not.toContain('leave_at');
    expect(url).not.toContain('arrive_by');
  });
  it('adds an encoded leave_at, and arrive_by only when chosen', async () => {
    const fn = mockBackend();
    await fetchSafeRoutes({ latitude: 52.2, longitude: -1 }, D, 'free', 3, null, LEAVE_1700);
    expect(fn.mock.calls[0][0]).toContain('&leave_at=2026-10-21T17%3A00%3A00%2B01%3A00');
    expect(fn.mock.calls[0][0]).not.toContain('arrive_by');
    await fetchSafeRoutes({ latitude: 52.3, longitude: -1 }, D, 'free', 3, null, { arrive_by: LEAVE_1700.leave_at });
    expect(fn.mock.calls[1][0]).toContain('&arrive_by=');
    expect(fn.mock.calls[1][0]).not.toContain('leave_at');
  });
  it('does not serve a "now" cache entry for a timed search', async () => {
    const fn = mockBackend();
    const o = { latitude: 52.4, longitude: -1 };
    await fetchSafeRoutes(o, D, 'free', 3);
    await fetchSafeRoutes(o, D, 'free', 3, null, LEAVE_1700);
    await fetchSafeRoutes(o, D, 'free', 3, null, LEAVE_1710); // same bucket -> cached
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('walking speed', () => {
  it('is 1.35 m/s', () => {
    expect(WALKING_SPEED_MPS).toBe(1.35);
  });
});

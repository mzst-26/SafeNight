import { fetchSafeRoutes } from '@/src/services/safeRoutes';

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

const DEST = { latitude: 51.52, longitude: -0.12 };

function mockBackend() {
  const fn = jest.fn(async (_url: string) => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({
      status: 'OK',
      routes: [
        {
          routeIndex: 0,
          isSafest: true,
          overview_polyline: { points: '' },
          legs: [],
          summary: '',
          safety: { breakdown: {} },
          segments: [],
        },
      ],
      meta: {},
    }),
  }));
  (global as any).fetch = fn;
  return fn;
}

describe('fetchSafeRoutes cache key includes maxDistanceKm (T-23)', () => {
  it('does not serve a result fetched with one maxDistanceKm for a different maxDistanceKm', async () => {
    const fn = mockBackend();
    const origin = { latitude: 52.61, longitude: -1.01 };

    await fetchSafeRoutes(origin, DEST, 'free', 3);
    await fetchSafeRoutes(origin, DEST, 'free', 5);

    expect(fn).toHaveBeenCalledTimes(2);
    expect(String(fn.mock.calls[0][0])).toContain('max_distance=3');
    expect(String(fn.mock.calls[1][0])).toContain('max_distance=5');
  });

  it('still serves a repeat call with the same maxDistanceKm from cache', async () => {
    const fn = mockBackend();
    const origin = { latitude: 52.62, longitude: -1.02 };

    await fetchSafeRoutes(origin, DEST, 'free', 4);
    await fetchSafeRoutes(origin, DEST, 'free', 4);

    expect(fn).toHaveBeenCalledTimes(1);
  });
});

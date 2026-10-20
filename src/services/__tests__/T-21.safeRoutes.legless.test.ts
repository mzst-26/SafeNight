import { fetchSafeRoutes, WALKING_SPEED_MPS } from '@/src/services/safeRoutes';
import { decodePolyline, encodePolyline } from '@/src/utils/polyline';

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
const PATH = [
  { latitude: 51.5, longitude: -0.1 },
  { latitude: 51.503, longitude: -0.1 },
  { latitude: 51.503, longitude: -0.105 },
];

/** Same great-circle sum the service must use: haversine over consecutive points, R = 6371000 m. */
function pathLengthMeters(points: { latitude: number; longitude: number }[]): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const dLat = toRad(b.latitude - a.latitude);
    const dLng = toRad(b.longitude - a.longitude);
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
    total += 2 * 6371000 * Math.asin(Math.sqrt(h));
  }
  return total;
}

function mockBackend(route: Record<string, unknown>) {
  (global as any).fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({ status: 'OK', routes: [route], meta: {} }),
  }));
}

describe('fetchSafeRoutes distance when the backend sends no legs (T-21)', () => {
  it('derives distance from the decoded path length when legs are missing', async () => {
    const encoded = encodePolyline(PATH);
    const decoded = decodePolyline(encoded);
    const expected = pathLengthMeters(decoded);
    expect(expected).toBeGreaterThan(0);

    mockBackend({
      routeIndex: 0,
      isSafest: true,
      overview_polyline: { points: encoded },
      legs: [],
      summary: 'No legs',
      safety: { breakdown: {} },
      segments: [],
    });

    const result = await fetchSafeRoutes(
      { latitude: 51.5001, longitude: -0.1001 },
      DEST,
      'free',
      3,
    );
    const route = result.routes[0];

    expect(route.distanceMeters).toBeGreaterThan(0);
    expect(route.distanceMeters).toBeCloseTo(expected, 0);
    expect(route.durationSeconds).toBe(Math.round(expected / WALKING_SPEED_MPS));
  });
});

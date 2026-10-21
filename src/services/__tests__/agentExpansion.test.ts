import {
  expansionRingPoints,
  RING_RADIUS_M,
  runExpansionSearch,
  scoreExpandedRoutes,
  type ExpansionRouteFetch,
  type ExpansionScorer,
} from '@/src/services/agentExpansion';
import type { CandidatePoint } from '@/src/services/agentClient';
import type { SafeRoute } from '@/src/services/safeRoutes';
import type { LatLng } from '@/src/types/geo';

const centre: LatLng = { latitude: 51.5074, longitude: -0.1278 };

// Great-circle distance in metres, used to check the offsets independently of the implementation.
function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

describe('expansionRingPoints', () => {
  it('uses an 800 m radius', () => {
    expect(RING_RADIUS_M).toBe(800);
  });

  it('returns 8 ring points with ids r1..r8 and kind ring', () => {
    const points = expansionRingPoints(centre);
    expect(points.map((p) => p.id)).toEqual(['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8']);
    points.forEach((p) => expect(p.kind).toBe('ring'));
  });

  it('labels the points by compass direction, starting north and going clockwise', () => {
    const labels = expansionRingPoints(centre).map((p) => p.label);
    expect(labels).toEqual([
      'North area',
      'North-east area',
      'East area',
      'South-east area',
      'South area',
      'South-west area',
      'West area',
      'North-west area',
    ]);
  });

  it('places the north point about 800 m north of the centre (within 1%)', () => {
    const north = expansionRingPoints(centre)[0];
    expect(north.lat).toBeGreaterThan(centre.latitude);
    expect(Math.abs(north.lng - centre.longitude)).toBeLessThan(1e-9);
    const distance = haversineM({ lat: centre.latitude, lng: centre.longitude }, north);
    expect(Math.abs(distance - 800) / 800).toBeLessThan(0.01);
  });

  it('places every point about 800 m from the centre (within 1%)', () => {
    expansionRingPoints(centre).forEach((p) => {
      const distance = haversineM({ lat: centre.latitude, lng: centre.longitude }, p);
      expect(Math.abs(distance - 800) / 800).toBeLessThan(0.01);
    });
  });

  it('puts the east point east of the centre and the west point west of it', () => {
    const points = expansionRingPoints(centre);
    const east = points[2];
    const west = points[6];
    expect(east.lng).toBeGreaterThan(centre.longitude);
    expect(Math.abs(east.lat - centre.latitude)).toBeLessThan(1e-9);
    expect(west.lng).toBeLessThan(centre.longitude);
    expect(Math.abs(west.lat - centre.latitude)).toBeLessThan(1e-9);
  });
});

// ── runExpansionSearch (E1) ─────────────────────────────────────────────────

const ringCandidates: CandidatePoint[] = expansionRingPoints(centre);
const origin: LatLng = { latitude: 51.5, longitude: -0.13 };
const destination: LatLng = { latitude: 51.51, longitude: -0.12 };

const fakeRoute = (id: string, tag: string): SafeRoute =>
  ({
    id,
    distanceMeters: 1000,
    durationSeconds: 800,
    encodedPolyline: '',
    path: [{ latitude: 51.5, longitude: -0.13 }, { latitude: 51.51, longitude: -0.12 }],
    summary: tag,
    safety: { score: 70 },
  }) as unknown as SafeRoute;

const scoreAll: ExpansionScorer = (routes) =>
  Object.fromEntries(
    routes.map((r) => [
      r.id,
      { routeId: r.id, score: 70, pathfindingScore: 70, label: 'Safe', color: '#000', mainRoadRatio: 0.5, dataConfidence: 1, status: 'done' as const },
    ]),
  );

describe('runExpansionSearch', () => {
  test('fetches one route per ring point, labels them after the existing routes, and scores them', async () => {
    const fetchRoute = jest.fn<ReturnType<ExpansionRouteFetch>, Parameters<ExpansionRouteFetch>>(
      async (_o, _d, via) => fakeRoute('raw', `via ${via.latitude}`),
    );
    const scoreRoutes = jest.fn(scoreAll);
    const outcome = await runExpansionSearch({
      candidateIds: ['r1', 'r3'],
      candidates: ringCandidates,
      origin,
      destination,
      existingCount: 3,
      fetchRoute,
      scoreRoutes,
    });

    expect(fetchRoute).toHaveBeenCalledTimes(2);
    expect(fetchRoute.mock.calls[0][2]).toEqual({ latitude: ringCandidates[0].lat, longitude: ringCandidates[0].lng });
    expect(outcome.routes.map((r) => r.id)).toEqual(['expanded-route-4', 'expanded-route-5']);
    expect(Object.keys(outcome.scores).sort()).toEqual(['expanded-route-4', 'expanded-route-5']);
    expect(scoreRoutes).toHaveBeenCalledWith(outcome.routes);
    expect(outcome.results).toEqual([
      { type: 'expand_search', ok: true },
      { type: 'expand_search', ok: true },
    ]);
  });

  test('a failed route fetch gives ok false for that point and keeps the others', async () => {
    const fetchRoute: ExpansionRouteFetch = jest.fn(async (_o, _d, via) => {
      if (via.latitude === ringCandidates[1].lat) throw new Error('network');
      return fakeRoute('raw', 'ok');
    });
    const outcome = await runExpansionSearch({
      candidateIds: ['r1', 'r2', 'r3'],
      candidates: ringCandidates,
      origin,
      destination,
      existingCount: 1,
      fetchRoute,
      scoreRoutes: scoreAll,
    });
    expect(outcome.results).toEqual([
      { type: 'expand_search', ok: true },
      { type: 'expand_search', ok: false },
      { type: 'expand_search', ok: true },
    ]);
    expect(outcome.routes).toHaveLength(2);
  });

  test('a route fetch that returns nothing gives ok false', async () => {
    const outcome = await runExpansionSearch({
      candidateIds: ['r5'],
      candidates: ringCandidates,
      origin,
      destination,
      existingCount: 2,
      fetchRoute: async () => null,
      scoreRoutes: scoreAll,
    });
    expect(outcome.routes).toEqual([]);
    expect(outcome.results).toEqual([{ type: 'expand_search', ok: false }]);
  });

  test('ids that are not ring points of this search are not fetched and give ok false', async () => {
    const fetchRoute = jest.fn(async () => fakeRoute('raw', 'x'));
    const outcome = await runExpansionSearch({
      candidateIds: ['p1', 'r9', 'r2'],
      candidates: [...ringCandidates, { id: 'p1', label: 'Start', lat: 51.5, lng: -0.13, kind: 'route_start' }],
      origin,
      destination,
      existingCount: 1,
      fetchRoute,
      scoreRoutes: scoreAll,
    });
    expect(fetchRoute).toHaveBeenCalledTimes(1);
    expect(outcome.results.map((r) => r.ok)).toEqual([false, false, true]);
  });

  test('never takes more than 3 new routes, and never more than 6 routes in total', async () => {
    const fetchRoute = jest.fn(async () => fakeRoute('raw', 'x'));
    const four = await runExpansionSearch({
      candidateIds: ['r1', 'r2', 'r3', 'r4'],
      candidates: ringCandidates,
      origin,
      destination,
      existingCount: 1,
      fetchRoute,
      scoreRoutes: scoreAll,
    });
    expect(four.routes).toHaveLength(3);
    // Only 3 ids are used; the fourth is not fetched, so it reports ok false.
    expect(four.results.map((r) => r.ok)).toEqual([true, true, true, false]);

    const full = await runExpansionSearch({
      candidateIds: ['r1', 'r2', 'r3'],
      candidates: ringCandidates,
      origin,
      destination,
      existingCount: 4,
      fetchRoute,
      scoreRoutes: scoreAll,
    });
    expect(full.routes).toHaveLength(2);
    expect(full.routes.map((r) => r.id)).toEqual(['expanded-route-5', 'expanded-route-6']);
    expect(full.results.map((r) => r.ok)).toEqual([true, true, false]);
  });
});

describe('scoreExpandedRoutes', () => {
  test('gives each route its safety score and label, keyed by route id', () => {
    const route = {
      id: 'expanded-route-4',
      safety: { score: 74, label: 'Safe', color: '#0a0', mainRoadRatio: 40 },
    } as unknown as SafeRoute;
    expect(scoreExpandedRoutes([route])).toEqual({
      'expanded-route-4': {
        routeId: 'expanded-route-4',
        score: 74,
        pathfindingScore: 74,
        label: 'Safe',
        color: '#0a0',
        mainRoadRatio: 0.4,
        dataConfidence: 1,
        status: 'done',
      },
    });
  });
});

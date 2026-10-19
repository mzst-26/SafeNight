import {
  buildRouteLayerInput,
  fetchSafeRoutes,
  getRouteCrimeTotal,
  isV2SafeRoute,
  type SafeRoute,
} from '@/src/services/safeRoutes';
import { buildRouteLayers } from '@/src/components/maps/routeLayers';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
  },
}));

jest.mock('@/src/services/userApi', () => ({
  subscriptionApi: {
    ensureFeatureAllowed: jest.fn(async () => undefined),
    consume: jest.fn(async () => undefined),
    syncFromLimitInfo: jest.fn(async () => undefined),
  },
}));

// ── Fixtures ────────────────────────────────────────────────────────────────

const LEG = {
  distance: { text: '1.2 km', value: 1200 },
  duration: { text: '15 mins', value: 900 },
  start_location: { lat: 51.5, lng: -0.1 },
  end_location: { lat: 51.51, lng: -0.11 },
  steps: [],
};

const SAFETY_BREAKDOWN = {
  roadType: 50,
  lighting: 40,
  crime: 60,
  cctv: 10,
  openPlaces: 20,
  traffic: 30,
};

/** Backend v1 response: no certainty/reason/worstStretch/dataQuality, no segment risk. */
function v1Route(routeIndex = 0) {
  return {
    routeIndex,
    isSafest: routeIndex === 0,
    overview_polyline: { points: '' },
    legs: [LEG],
    summary: 'Route 1',
    safety: {
      score: 67,
      label: 'Safe',
      color: '#00AA00',
      breakdown: SAFETY_BREAKDOWN,
      roadTypes: { primary: 40 },
      mainRoadRatio: 40,
    },
    segments: [
      {
        start: { lat: 51.5, lng: -0.1 },
        end: { lat: 51.501, lng: -0.1 },
        safetyScore: 0.7,
        color: '#00AA00',
        highway: 'primary',
        roadName: 'High Street',
        lightScore: 0.8,
        crimeScore: 0.6,
        cctvScore: 0,
        placeScore: 0.2,
        trafficScore: 0.3,
        distance: 111,
      },
    ],
    routeStats: {
      deadEnds: 0,
      sidewalkPct: 80,
      unpavedPct: 0,
      transitStopsNearby: 2,
      cctvCamerasNearby: 0,
      estimatedDurationSec: 900,
      roadNameChanges: [],
    },
    routePOIs: {
      cctv: [],
      transit: [],
      deadEnds: [],
      lights: [{ lat: 51.5005, lng: -0.1 }],
      places: [{ lat: 51.5006, lng: -0.1001 }],
      crimes: [
        { lat: 51.5, lng: -0.1, category: 'Burglary' },
        { lat: 51.5001, lng: -0.1001, category: 'Theft' },
      ],
    },
  };
}

/** Backend v2 response: additive safety fields, per-segment risk and clustered crimes. */
function v2Route(routeIndex = 0) {
  return {
    ...v1Route(routeIndex),
    safety: {
      ...v1Route(routeIndex).safety,
      certainty: 0.62,
      reason: 'Darker than the alternative for 240 m',
      worstStretch: {
        start: { lat: 51.5002, lng: -0.1 },
        end: { lat: 51.5008, lng: -0.1 },
        lengthM: 240,
        cause: 'lighting',
      },
      dataQuality: { crime: 'ok', lighting: 'mixed' },
    },
    segments: [
      {
        start: { lat: 51.5, lng: -0.1 },
        end: { lat: 51.501, lng: -0.1 },
        safetyScore: 0.7,
        color: '#B9E3D9',
        highway: 'primary',
        roadName: 'High Street',
        lightScore: 0.8,
        crimeScore: 0.6,
        cctvScore: 0,
        placeScore: 0.2,
        trafficScore: 0.3,
        distance: 111,
        risk: 0.12,
        litEstimate: 'lit',
        certainty: 0.9,
        cause: null,
      },
      {
        start: { lat: 51.501, lng: -0.1 },
        end: { lat: 51.502, lng: -0.1 },
        safetyScore: 0.3,
        color: '#B5621E',
        highway: 'residential',
        roadName: 'Thurlestone Walk',
        lightScore: 0.1,
        crimeScore: 0.2,
        cctvScore: 0,
        placeScore: 0,
        trafficScore: 0,
        distance: 111,
        risk: 0.7,
        litEstimate: 'estimated_unlit',
        certainty: 0.2,
        cause: 'lighting',
      },
    ],
    routeStats: {
      ...v1Route(routeIndex).routeStats,
      crimeCount: 57,
    },
    routePOIs: {
      ...v1Route(routeIndex).routePOIs,
      crimes: [{ lat: 51.5, lng: -0.1, count: 40, maxSeverity: 0.8, kind: 'crime' }],
    },
  };
}

function apiPayload(routes: unknown[]) {
  return { status: 'OK', routes, meta: { routeCount: routes.length } };
}

function mockBackend(payload: unknown) {
  (global as any).fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => payload,
  }));
}

/** Each test uses its own origin so the module-level response cache never hits across tests. */
let originSeq = 0;
function freshOrigin() {
  originSeq += 1;
  return { latitude: 51.5 + originSeq * 0.001, longitude: -0.1 };
}

const DEST = { latitude: 51.52, longitude: -0.12 };

async function fetchFirst(payload: unknown): Promise<SafeRoute> {
  mockBackend(payload);
  const result = await fetchSafeRoutes(freshOrigin(), DEST, 'free', 3);
  return result.routes[0];
}

// ── fetchSafeRoutes mapping ──────────────────────────────────────────────────

describe('fetchSafeRoutes mapping of v1 backend payloads', () => {
  it('keeps the legacy fields and leaves every v2 field undefined', async () => {
    const route = await fetchFirst(apiPayload([v1Route()]));

    expect(route.safety.score).toBe(67);
    expect(route.safety.certainty).toBeUndefined();
    expect(route.safety.reason).toBeUndefined();
    expect(route.safety.worstStretch).toBeUndefined();
    expect(route.safety.dataQuality).toBeUndefined();
    expect(route.routeStats?.crimeCount).toBeUndefined();

    const seg = route.enrichedSegments?.[0];
    expect(seg?.safetyScore).toBe(0.7);
    expect(seg?.risk).toBeUndefined();
    expect(seg?.certainty).toBeUndefined();
    expect(seg?.litEstimate).toBeUndefined();
    expect(seg?.cause).toBeUndefined();

    expect(route.routePOIs?.crimes).toHaveLength(2);
    expect(route.routePOIs?.crimes[0]).toEqual({ lat: 51.5, lng: -0.1, category: 'Burglary' });
  });
});

describe('fetchSafeRoutes mapping of v2 backend payloads', () => {
  it('passes through the route-level v2 safety fields', async () => {
    const route = await fetchFirst(apiPayload([v2Route()]));

    expect(route.safety.certainty).toBe(0.62);
    expect(route.safety.reason).toBe('Darker than the alternative for 240 m');
    expect(route.safety.worstStretch).toEqual({
      start: { lat: 51.5002, lng: -0.1 },
      end: { lat: 51.5008, lng: -0.1 },
      lengthM: 240,
      cause: 'lighting',
    });
    expect(route.safety.dataQuality).toEqual({ crime: 'ok', lighting: 'mixed' });
  });

  it('carries per-segment risk, certainty, litEstimate and cause into enrichedSegments', async () => {
    const route = await fetchFirst(apiPayload([v2Route()]));

    expect(route.enrichedSegments?.[0]).toEqual(
      expect.objectContaining({ risk: 0.12, certainty: 0.9, litEstimate: 'lit', cause: null }),
    );
    expect(route.enrichedSegments?.[1]).toEqual(
      expect.objectContaining({
        risk: 0.7,
        certainty: 0.2,
        litEstimate: 'estimated_unlit',
        cause: 'lighting',
      }),
    );
  });

  it('passes through routeStats.crimeCount and clustered crime POIs', async () => {
    const route = await fetchFirst(apiPayload([v2Route()]));

    expect(route.routeStats?.crimeCount).toBe(57);
    expect(route.routePOIs?.crimes).toEqual([
      { lat: 51.5, lng: -0.1, count: 40, maxSeverity: 0.8, kind: 'crime' },
    ]);
  });
});

// ── Pure helpers ─────────────────────────────────────────────────────────────

describe('isV2SafeRoute', () => {
  it('is false for a v1 route', async () => {
    expect(isV2SafeRoute(await fetchFirst(apiPayload([v1Route()])))).toBe(false);
  });

  it('is true for a v2 route', async () => {
    expect(isV2SafeRoute(await fetchFirst(apiPayload([v2Route()])))).toBe(true);
  });

  it('is true when only a segment carries a finite risk', () => {
    const route = {
      safety: { score: 50 },
      enrichedSegments: [{ risk: 0.4 }],
    } as unknown as SafeRoute;
    expect(isV2SafeRoute(route)).toBe(true);
  });

  it('is true when worstStretch is explicitly null (v2 with no stretch to call out)', () => {
    const route = { safety: { score: 50, worstStretch: null } } as unknown as SafeRoute;
    expect(isV2SafeRoute(route)).toBe(true);
  });

  it('ignores a non-finite certainty and a risk that is not a number', () => {
    const route = {
      safety: { score: 50, certainty: Number.NaN },
      enrichedSegments: [{ risk: 'high' }],
    } as unknown as SafeRoute;
    expect(isV2SafeRoute(route)).toBe(false);
  });
});

describe('buildRouteLayerInput', () => {
  it('returns null for a v1 route so renderers fall back to legacy drawing', async () => {
    expect(buildRouteLayerInput(await fetchFirst(apiPayload([v1Route()])))).toBeNull();
  });

  it('maps a v2 route to the layer builder input', async () => {
    const input = buildRouteLayerInput(await fetchFirst(apiPayload([v2Route()])));

    expect(input?.segments).toEqual([
      expect.objectContaining({
        start: { lat: 51.5, lng: -0.1 },
        end: { lat: 51.501, lng: -0.1 },
        risk: 0.12,
        certainty: 0.9,
        litEstimate: 'lit',
      }),
      expect.objectContaining({
        start: { lat: 51.501, lng: -0.1 },
        end: { lat: 51.502, lng: -0.1 },
        risk: 0.7,
        certainty: 0.2,
        litEstimate: 'estimated_unlit',
      }),
    ]);
    expect(input?.worstStretch).toEqual({
      start: { lat: 51.5002, lng: -0.1 },
      end: { lat: 51.5008, lng: -0.1 },
      lengthM: 240,
      cause: 'lighting',
    });
    expect(input?.crimes).toEqual([{ lat: 51.5, lng: -0.1, count: 40, severity: 0.8 }]);
    expect(input?.lights).toEqual([{ lat: 51.5005, lng: -0.1 }]);
    expect(input?.places).toEqual([{ lat: 51.5006, lng: -0.1001 }]);
    expect(input?.cctv).toEqual([]);
  });

  it('maps a v2 route with worstStretch null to worstStretch null', () => {
    const route = {
      safety: { score: 90, worstStretch: null, certainty: 0.9 },
      enrichedSegments: [],
      routePOIs: { crimes: [], lights: [], cctv: [], places: [] },
    } as unknown as SafeRoute;
    expect(buildRouteLayerInput(route)?.worstStretch).toBeNull();
  });

  it('produces a renderable layer spec with coloured, dashed-when-estimated lines', async () => {
    const input = buildRouteLayerInput(await fetchFirst(apiPayload([v2Route()])));
    const spec = buildRouteLayers(input, { zoom: 17 });

    expect(spec.lines).toHaveLength(2);
    expect(spec.lines[0].dashed).toBe(false);
    expect(spec.lines[1].dashed).toBe(true);
    expect(spec.callouts[0].text).toBe('Unlit stretch · 240 m');
    expect(spec.crimeClusters).toEqual([
      expect.objectContaining({ count: 40, maxSeverity: 0.8 }),
    ]);
  });
});

describe('getRouteCrimeTotal', () => {
  it('uses the true total from routeStats.crimeCount over the cluster count', async () => {
    expect(getRouteCrimeTotal(await fetchFirst(apiPayload([v2Route()])))).toBe(57);
  });

  it('counts raw POIs for a v1 route', async () => {
    expect(getRouteCrimeTotal(await fetchFirst(apiPayload([v1Route()])))).toBe(2);
  });

  it('sums cluster counts when crimeCount is absent', () => {
    const route = {
      routePOIs: {
        crimes: [
          { lat: 51.5, lng: -0.1, count: 4, kind: 'crime' },
          { lat: 51.6, lng: -0.1, count: 3, kind: 'crime' },
        ],
      },
    } as unknown as SafeRoute;
    expect(getRouteCrimeTotal(route)).toBe(7);
  });

  it('is 0 for a route without POIs', () => {
    expect(getRouteCrimeTotal({} as SafeRoute)).toBe(0);
  });
});

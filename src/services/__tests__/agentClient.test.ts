import {
  AgentInsightsError,
  buildAgentContext,
  buildCandidatePoints,
  getAgentSessionNumber,
  postAgentInsights,
  type AgentInsightsRequest,
} from '@/src/services/agentClient';
import type { DirectionsRoute } from '@/src/types/geo';

jest.mock('@/src/config/env', () => ({ env: { apiBaseUrl: 'https://gateway.test' } }));

const body: AgentInsightsRequest = {
  sessionNumber: 4242,
  round: 1,
  results: [],
  bestRouteId: 'safe-route-0',
  routes: [
    {
      routeId: 'safe-route-0',
      distanceMeters: 900,
      durationSeconds: 700,
      score: 62,
      worstStretch: null,
      path: [],
    },
  ],
  trip: {},
  candidatePoints: [{ id: 'p1', label: 'Start of the walk', lat: 51.5, lng: -0.13, kind: 'route_start' }],
};

const okResponse = {
  analysis: { routes: [{ routeId: 'safe-route-0', findings: [] }] },
  decision: { kind: 'keep', routeId: 'safe-route-0', reasons: ['Nothing to change.'] },
  message: 'Your route is the best option.',
  actions: [],
};

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

const mockFetch = (status: number, json: unknown) => {
  const fn = jest.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => json,
    text: async () => JSON.stringify(json),
  }));
  global.fetch = fn as unknown as typeof fetch;
  return fn;
};

describe('postAgentInsights', () => {
  test('POSTs the body as JSON to /api/agent-insights on the gateway', async () => {
    const fetchMock = mockFetch(200, okResponse);
    await postAgentInsights(body);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://gateway.test/api/agent-insights');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify(body));
  });

  test('returns the parsed G1 response', async () => {
    mockFetch(200, okResponse);
    const result = await postAgentInsights(body);
    expect(result.decision).toEqual({ kind: 'keep', routeId: 'safe-route-0', reasons: ['Nothing to change.'] });
    expect(result.message).toBe('Your route is the best option.');
    expect(result.actions).toEqual([]);
  });

  test('throws a typed error carrying the status on a non-200 response', async () => {
    mockFetch(500, { error: 'boom' });
    const error = await postAgentInsights(body).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AgentInsightsError);
    expect((error as AgentInsightsError).kind).toBe('http');
    expect((error as AgentInsightsError).status).toBe(500);
  });

  test('throws a typed "invalid" error when the response has no decision', async () => {
    mockFetch(200, { message: 'hello' });
    const error = await postAgentInsights(body).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AgentInsightsError);
    expect((error as AgentInsightsError).kind).toBe('invalid');
  });

  test('throws a typed "network" error when fetch fails', async () => {
    global.fetch = jest.fn(async () => {
      throw new TypeError('Network request failed');
    }) as unknown as typeof fetch;
    const error = await postAgentInsights(body).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AgentInsightsError);
    expect((error as AgentInsightsError).kind).toBe('network');
  });

  test('sends no email or other identifier field', async () => {
    const fetchMock = mockFetch(200, okResponse);
    await postAgentInsights(body);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const sent = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(Object.keys(sent).sort()).toEqual(
      ['bestRouteId', 'candidatePoints', 'results', 'round', 'routes', 'sessionNumber', 'trip'].sort(),
    );
    expect(String(init.body)).not.toMatch(/email|userId|"uid"|"token"/i);
  });
});

describe('buildCandidatePoints', () => {
  const stretch = {
    start: { lat: 51.5, lng: -0.1 },
    end: { lat: 51.51, lng: -0.09 },
    lengthM: 240,
    cause: 'unlit',
  };

  test('uses the midpoint of each route worst stretch, plus route start and end', () => {
    const points = buildCandidatePoints([
      {
        id: 'safe-route-0',
        path: [
          { latitude: 51.49, longitude: -0.11 },
          { latitude: 51.53, longitude: -0.08 },
        ],
        worstStretch: stretch,
      },
    ]);
    expect(points.map((p) => p.kind)).toEqual(['stretch_midpoint', 'route_start', 'route_end']);
    expect(points[0]).toMatchObject({ id: 'p1' });
    expect(points[0].lat).toBeCloseTo(51.505, 9);
    expect(points[0].lng).toBeCloseTo(-0.095, 9);
    expect(points[1]).toMatchObject({ id: 'p2', lat: 51.49, lng: -0.11 });
    expect(points[2]).toMatchObject({ id: 'p3', lat: 51.53, lng: -0.08 });
  });

  test('gives ids p1..pN in order and never more than 12 points', () => {
    const many = [0, 1, 2].map((i) => ({
      id: `safe-route-${i}`,
      path: [
        { latitude: 51.5 + i * 0.01, longitude: -0.1 },
        { latitude: 51.6 + i * 0.01, longitude: -0.2 },
      ],
      worstStretch: { start: { lat: 51.5 + i, lng: -0.1 }, end: { lat: 51.55 + i, lng: -0.11 }, lengthM: 200, cause: null },
    }));
    const points = buildCandidatePoints(many);
    expect(points.length).toBeLessThanOrEqual(12);
    expect(points.map((p) => p.id)).toEqual(points.map((_, i) => `p${i + 1}`));
  });

  test('a point shared by two routes (same start) appears once', () => {
    const points = buildCandidatePoints([
      { id: 'a', path: [{ latitude: 51.5, longitude: -0.1 }, { latitude: 51.6, longitude: -0.2 }], worstStretch: null },
      { id: 'b', path: [{ latitude: 51.5, longitude: -0.1 }, { latitude: 51.7, longitude: -0.3 }], worstStretch: null },
    ]);
    const starts = points.filter((p) => p.kind === 'route_start');
    expect(starts).toHaveLength(1);
  });
});

describe('buildAgentContext', () => {
  test('keeps at most 3 routes and sends the trip time of the safest route', () => {
    const route = (id: string): DirectionsRoute => ({
      id,
      distanceMeters: 800,
      durationSeconds: 600,
      encodedPolyline: '',
      path: [
        { latitude: 51.5, longitude: -0.1 },
        { latitude: 51.52, longitude: -0.12 },
      ],
    });
    const safeRoutes = ['a', 'b', 'c', 'd'].map((id, i) => ({
      ...route(id),
      routeIndex: i,
      isSafest: id === 'b',
      safety: {
        score: 70,
        label: 'Safe',
        color: '#000',
        breakdown: {},
        roadTypes: {},
        mainRoadRatio: 50,
        timeline: { leaveAtIso: '2026-10-21T22:00:00.000Z' },
      },
      safetySegments: [],
    }));
    const context = buildAgentContext({
      routes: safeRoutes as unknown as DirectionsRoute[],
      safeRoutes: safeRoutes as never,
      scores: {},
      bestRouteId: 'b',
    });
    expect(context.body.routes).toHaveLength(3);
    expect(context.body.bestRouteId).toBe('b');
    expect(context.body.trip.leaveAtIso).toBe('2026-10-21T22:00:00.000Z');
    expect(context.routes.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('buildAgentContext privacy (contract v3)', () => {
  const path = [
    { latitude: 51.5, longitude: -0.1 },
    { latitude: 51.51, longitude: -0.112 },
  ];
  const safeRoutes = [
    {
      id: 'a',
      distanceMeters: 900,
      durationSeconds: 700,
      encodedPolyline: '',
      path,
      routeIndex: 0,
      isSafest: true,
      safety: {
        score: 60,
        label: 'Fair',
        color: '#000',
        breakdown: {},
        roadTypes: {},
        mainRoadRatio: 40,
        timeline: { leaveAtIso: '2026-10-21T22:00:00.000Z' },
      },
      safetySegments: [],
    },
  ];

  test('route entries carry no start or end; path points are sent for the corridor check only', () => {
    const context = buildAgentContext({
      routes: safeRoutes as unknown as DirectionsRoute[],
      safeRoutes: safeRoutes as never,
      scores: {},
      bestRouteId: 'a',
    });
    const sent = context.body.routes[0] as unknown as Record<string, unknown>;
    expect(sent).not.toHaveProperty('start');
    expect(sent).not.toHaveProperty('end');
    expect(sent.path).toEqual(expect.any(Array));
    expect(JSON.stringify(context.body)).not.toMatch(/"start"|"end"/);
  });

  test('the client keeps the route geometry for the map, outside the request body', () => {
    const context = buildAgentContext({
      routes: safeRoutes as unknown as DirectionsRoute[],
      safeRoutes: safeRoutes as never,
      scores: {},
      bestRouteId: 'a',
    });
    expect(context.routes[0].path).toEqual([
      { latitude: 51.5, longitude: -0.1 },
      { latitude: 51.51, longitude: -0.112 },
    ]);
  });

  test('the body has no email or user identifier', () => {
    const context = buildAgentContext({
      routes: safeRoutes as unknown as DirectionsRoute[],
      safeRoutes: safeRoutes as never,
      scores: {},
      bestRouteId: 'a',
    });
    expect(JSON.stringify(context.body)).not.toMatch(/email|userId|"uid"|"token"/i);
  });
});

describe('getAgentSessionNumber', () => {
  test('is an integer from 1 to 999999 and is the same for every call in the session', () => {
    const first = getAgentSessionNumber();
    expect(Number.isInteger(first)).toBe(true);
    expect(first).toBeGreaterThanOrEqual(1);
    expect(first).toBeLessThanOrEqual(999999);
    expect(getAgentSessionNumber()).toBe(first);
  });
});

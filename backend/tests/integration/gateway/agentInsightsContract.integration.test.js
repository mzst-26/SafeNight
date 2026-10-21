const express = require('express');
const request = require('supertest');

// runAgent is replaced so the tests can read the facts the route passes in (the A2 interface).
jest.mock('../../../src/gateway/agent/loop', () => {
  const actual = jest.requireActual('../../../src/gateway/agent/loop');
  return { ...actual, runAgent: jest.fn() };
});

const JPEG_URL = 'data:image/jpeg;base64,AAAA';
const PNG_URL = 'data:image/png;base64,AAAA';
const KEY = 'test-key-not-real';

function loadApp() {
  let router;
  let loop;
  jest.isolateModules(() => {
    router = require('../../../src/gateway/routes/agentInsights');
    loop = require('../../../src/gateway/agent/loop');
  });
  const app = express();
  app.use('/api', router);
  return { app, runAgent: loop.runAgent };
}

const route = (i) => ({
  routeId: `r${i}`,
  distanceMeters: 1000 + i * 10,
  durationSeconds: 800 + i,
  score: 70,
});

function body(overrides = {}) {
  return {
    sessionNumber: 7,
    round: 1,
    bestRouteId: 'r1',
    routes: [route(1), route(2)],
    candidatePoints: [],
    snapshot: JPEG_URL,
    ...overrides,
  };
}

describe('POST /api/agent-insights contract v3 (A1)', () => {
  const originalKey = process.env.OPENROUTER_API_KEY;

  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = KEY;
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalKey;
  });

  describe('request validation', () => {
    test.each([
      ['missing', undefined],
      ['zero', 0],
      ['above 999999', 1000000],
      ['fractional', 1.5],
      ['a string', '3'],
    ])('returns 400 when sessionNumber is %s and never runs the agent', async (_label, value) => {
      const { app, runAgent } = loadApp();
      const payload = body({ sessionNumber: value });
      if (value === undefined) delete payload.sessionNumber;

      const res = await request(app).post('/api/agent-insights').send(payload);

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/sessionNumber/);
      expect(runAgent).not.toHaveBeenCalled();
    });

    test.each([
      ['missing', undefined],
      ['zero', 0],
      ['six', 6],
      ['fractional', 2.5],
    ])('returns 400 when round is %s', async (_label, value) => {
      const { app, runAgent } = loadApp();
      const payload = body({ round: value });
      if (value === undefined) delete payload.round;

      const res = await request(app).post('/api/agent-insights').send(payload);

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/round/);
      expect(runAgent).not.toHaveBeenCalled();
    });

    test('accepts the edge values sessionNumber 1 and 999999 and round 5', async () => {
      const { app, runAgent } = loadApp();
      runAgent.mockResolvedValue({ actions: [], question: null, message: null });

      const low = await request(app).post('/api/agent-insights').send(body({ sessionNumber: 1, round: 5 }));
      const high = await request(app).post('/api/agent-insights').send(body({ sessionNumber: 999999 }));

      expect(low.status).toBe(200);
      expect(high.status).toBe(200);
    });

    test('returns 400 when results has more than 20 items', async () => {
      const { app, runAgent } = loadApp();
      const results = Array.from({ length: 21 }, () => ({ type: 'pan_to', ok: true }));

      const res = await request(app).post('/api/agent-insights').send(body({ round: 2, results }));

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/results/);
      expect(runAgent).not.toHaveBeenCalled();
    });

    test.each([
      ['a missing type', [{ ok: true }]],
      ['a numeric type', [{ type: 4, ok: true }]],
      ['a string ok', [{ type: 'pan_to', ok: 'yes' }]],
      ['not an array', { type: 'pan_to', ok: true }],
    ])('returns 400 for results with %s', async (_label, results) => {
      const { app, runAgent } = loadApp();

      const res = await request(app).post('/api/agent-insights').send(body({ round: 2, results }));

      expect(res.status).toBe(400);
      expect(runAgent).not.toHaveBeenCalled();
    });

    test('accepts up to 20 valid results and passes the request on', async () => {
      const { app, runAgent } = loadApp();
      runAgent.mockResolvedValue({ actions: [], question: null, message: null });
      const results = Array.from({ length: 20 }, () => ({ type: 'fit_route', ok: false }));

      const res = await request(app).post('/api/agent-insights').send(body({ round: 2, results }));

      expect(res.status).toBe(200);
    });

    test('returns 400 when there are more than 6 routes and accepts 6', async () => {
      const { app, runAgent } = loadApp();
      runAgent.mockResolvedValue({ actions: [], question: null, message: null });
      const seven = Array.from({ length: 7 }, (_, i) => route(i + 1));
      const six = seven.slice(0, 6);

      const tooMany = await request(app).post('/api/agent-insights').send(body({ routes: seven }));
      const ok = await request(app).post('/api/agent-insights').send(body({ routes: six }));

      expect(tooMany.status).toBe(400);
      expect(tooMany.body.error).toMatch(/1 to 6/);
      expect(ok.status).toBe(200);
    });

    test.each([
      ['a gif prefix', 'data:image/gif;base64,AAAA'],
      ['plain text', 'not a picture'],
      ['a number', 12],
    ])('returns 400 for a snapshot that is %s', async (_label, snapshot) => {
      const { app, runAgent } = loadApp();

      const res = await request(app).post('/api/agent-insights').send(body({ snapshot }));

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/snapshot/);
      expect(runAgent).not.toHaveBeenCalled();
    });

    test('returns 400 for a snapshot over 400000 characters, and the error does not echo it', async () => {
      const { app, runAgent } = loadApp();
      const snapshot = `${JPEG_URL}${'A'.repeat(400000)}`;

      const res = await request(app).post('/api/agent-insights').send(body({ snapshot }));

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/snapshot/);
      expect(JSON.stringify(res.body)).not.toContain('AAAAAAAAAA');
      expect(runAgent).not.toHaveBeenCalled();
    });

    test('accepts a jpeg or png snapshot and passes it to the agent as a fact', async () => {
      const { app, runAgent } = loadApp();
      runAgent.mockResolvedValue({ actions: [], question: null, message: null });

      const jpeg = await request(app).post('/api/agent-insights').send(body({ snapshot: JPEG_URL }));
      const png = await request(app).post('/api/agent-insights').send(body({ snapshot: PNG_URL }));

      expect(jpeg.status).toBe(200);
      expect(png.status).toBe(200);
      expect(runAgent.mock.calls[0][0].facts.snapshot).toBe(JPEG_URL);
      expect(runAgent.mock.calls[1][0].facts.snapshot).toBe(PNG_URL);
    });
  });

  describe('agent facts (interface to A2)', () => {
    test('passes the route ids and the snapshot to the agent', async () => {
      const { app, runAgent } = loadApp();
      runAgent.mockResolvedValue({ actions: [], question: null, message: null });

      const res = await request(app).post('/api/agent-insights').send(body({ routes: [route(1), route(2), route(3)] }));

      expect(res.status).toBe(200);
      const { facts } = runAgent.mock.calls[0][0];
      expect(facts.snapshot).toBe(JPEG_URL);
      expect(facts.expansionAllowed).toBe(false);
      expect(facts.routeIds).toEqual(['r1', 'r2', 'r3']);
    });

    test('makes no model call without a snapshot and returns the fixed message with status done', async () => {
      const { app, runAgent } = loadApp();

      const res = await request(app).post('/api/agent-insights').send(body({ snapshot: undefined }));

      expect(res.status).toBe(200);
      expect(runAgent).not.toHaveBeenCalled();
      expect(res.body.status).toBe('done');
      expect(res.body.actions).toEqual([]);
      expect(typeof res.body.message).toBe('string');
      expect(res.body.message.length).toBeGreaterThan(0);
    });

    test('does not log the session number or the snapshot', async () => {
      const { app, runAgent } = loadApp();
      runAgent.mockResolvedValue({ actions: [], question: null, message: null });
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await request(app).post('/api/agent-insights').send(body({ sessionNumber: 424242, snapshot: `${JPEG_URL}BBBB` }));

      const logged = [...logSpy.mock.calls, ...errSpy.mock.calls].map((args) => args.join(' ')).join('\n');
      logSpy.mockRestore();
      errSpy.mockRestore();
      expect(logged).not.toContain('424242');
      expect(logged).not.toContain('BBBB');
      expect(runAgent).toHaveBeenCalledTimes(1);
    });
  });

  describe('trip tone, route path and ring points (A1b)', () => {
    const shared = [
      { lat: 51.5, lng: -0.1 },
      { lat: 51.51, lng: -0.1 },
    ];
    const far = [
      { lat: 52.0, lng: -0.1 },
      { lat: 52.01, lng: -0.1 },
    ];
    const lit = (i, path, extra = {}) => ({ ...route(i), path, ...extra });
    const expansionBody = (tone, otherPath = shared) => ({
      bestRouteId: 'r1',
      routes: [
        lit(1, shared, { worstStretch: { lengthM: 200, cause: 'lighting' } }),
        lit(2, otherPath),
      ],
      candidatePoints: [
        { id: 'p1', label: 'Midpoint', lat: 51.505, lng: -0.1, kind: 'stretch_midpoint' },
        { id: 'r1', label: 'Ring 1', lat: 51.6, lng: -0.1, kind: 'ring' },
        { id: 'r2', label: 'Ring 2', lat: 51.7, lng: -0.1, kind: 'ring' },
      ],
      ...(tone === undefined ? {} : { trip: { tone } }),
    });
    const toolNames = (runAgent) => runAgent.mock.calls[0][0].tools.map((t) => t.function.name);
    const expandTool = (runAgent) =>
      runAgent.mock.calls[0][0].tools.find((t) => t.function.name === 'expand_search');

    test.each(['morning', 'afternoon', 'evening', 'late'])('accepts trip tone %s', async (tone) => {
      const { app, runAgent } = loadApp();
      runAgent.mockResolvedValue({ actions: [], question: null, message: null });

      const res = await request(app).post('/api/agent-insights').send(body({ trip: { tone } }));

      expect(res.status).toBe(200);
    });

    test.each([
      ['an unknown word', 'noon'],
      ['upper case', 'LATE'],
      ['a number', 3],
    ])('returns 400 for a trip tone that is %s and never runs the agent', async (_label, tone) => {
      const { app, runAgent } = loadApp();

      const res = await request(app).post('/api/agent-insights').send(body({ trip: { tone } }));

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/trip/);
      expect(runAgent).not.toHaveBeenCalled();
    });

    test('returns 400 when a route path has more than 2000 points', async () => {
      const { app, runAgent } = loadApp();
      const path = Array.from({ length: 2001 }, (_, i) => ({ lat: 51.5 + i * 1e-5, lng: -0.1 }));
      const payload = body({ routes: [lit(1, path), route(2)] });

      const res = await request(app).post('/api/agent-insights').send(payload);

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/path/);
      expect(runAgent).not.toHaveBeenCalled();
    });

    test('returns 400 when a route path point is not a finite coordinate', async () => {
      const { app, runAgent } = loadApp();
      const payload = body({ routes: [lit(1, [{ lat: 51.5, lng: -0.1 }, { lat: 'north', lng: -0.1 }]), route(2)] });

      const res = await request(app).post('/api/agent-insights').send(payload);

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/path/);
      expect(runAgent).not.toHaveBeenCalled();
    });

    test('never sends route path points to the model', async () => {
      const { app, runAgent } = loadApp();
      runAgent.mockResolvedValue({ actions: [], question: null, message: null });
      const path = [
        { lat: 51.123457, lng: -0.654321 },
        { lat: 51.123999, lng: -0.654999 },
      ];

      const res = await request(app).post('/api/agent-insights').send(body({ routes: [lit(1, path), route(2)] }));

      expect(res.status).toBe(200);
      const sent = JSON.stringify(runAgent.mock.calls[0][0]);
      expect(sent).not.toContain('51.123457');
      expect(sent).not.toContain('-0.654321');
    });

    test('does not validate route start or end and never sends them to the model', async () => {
      const { app, runAgent } = loadApp();
      runAgent.mockResolvedValue({ actions: [], question: null, message: null });
      const payload = body();
      payload.routes[0].start = { lat: 'north', lng: 50.987654 };
      payload.routes[0].end = { lat: 300, lng: 200 };

      const res = await request(app).post('/api/agent-insights').send(payload);

      expect(res.status).toBe(200);
      expect(runAgent).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(runAgent.mock.calls[0][0])).not.toContain('50.987654');
    });

    test('offers expand_search with the ring ids when the trip is late and the corridor gate passes', async () => {
      const { app, runAgent } = loadApp();
      runAgent.mockResolvedValue({ actions: [], question: null, message: null });

      const res = await request(app).post('/api/agent-insights').send(body(expansionBody('late')));

      expect(res.status).toBe(200);
      expect(res.body.expansionAllowed).toBe(true);
      expect(runAgent.mock.calls[0][0].facts.expansionAllowed).toBe(true);
      expect(toolNames(runAgent)).toContain('expand_search');
      const ringEnum = JSON.stringify(expandTool(runAgent));
      expect(ringEnum).toContain('"r1"');
      expect(ringEnum).toContain('"r2"');
      expect(ringEnum).not.toContain('"p1"');
    });

    test('does not offer expand_search in the morning when the route is not dark', async () => {
      const { app, runAgent } = loadApp();
      runAgent.mockResolvedValue({ actions: [], question: null, message: null });

      const res = await request(app).post('/api/agent-insights').send(body(expansionBody('morning')));

      expect(res.body.expansionAllowed).toBe(false);
      expect(toolNames(runAgent)).not.toContain('expand_search');
    });

    test('does not offer expand_search when the other route is outside the corridor', async () => {
      const { app, runAgent } = loadApp();
      runAgent.mockResolvedValue({ actions: [], question: null, message: null });

      const res = await request(app).post('/api/agent-insights').send(body(expansionBody('late', far)));

      expect(res.body.expansionAllowed).toBe(false);
      expect(toolNames(runAgent)).not.toContain('expand_search');
    });
  });

  describe('response shape', () => {
    test('returns status done, the echoed round, maxRounds 5, expansionAllowed false and the suggested route', async () => {
      const { app, runAgent } = loadApp();
      runAgent.mockResolvedValue({ actions: [], question: null, message: null });

      const res = await request(app).post('/api/agent-insights').send(body({ round: 3, bestRouteId: 'r2' }));

      expect(res.status).toBe(200);
      expect(res.body).toEqual(
        expect.objectContaining({
          status: 'done',
          round: 3,
          maxRounds: 5,
          expansionAllowed: false,
          recommendedRouteId: res.body.decision.routeId,
        }),
      );
      expect(res.body.decision).toEqual(expect.objectContaining({ kind: expect.any(String), routeId: expect.any(String), reasons: expect.any(Array) }));
      expect(res.body.analysis).toBeDefined();
      expect(typeof res.body.message).toBe('string');
      expect(res.body.actions).toEqual([]);
    });

    test('uses the model recommendation when the agent returns one', async () => {
      const { app, runAgent } = loadApp();
      runAgent.mockResolvedValue({ actions: [], question: null, message: 'Stay aware of your surroundings.', recommendedRouteId: 'r2' });

      const res = await request(app).post('/api/agent-insights').send(body({ bestRouteId: 'r1' }));

      expect(res.body.recommendedRouteId).toBe('r2');
    });

    test('returns status continue when the agent says the round is not finished', async () => {
      const { app, runAgent } = loadApp();
      runAgent.mockResolvedValue({ status: 'continue', actions: [{ type: 'pan_to', candidateId: 'p1' }], question: null, message: null });

      const res = await request(app).post('/api/agent-insights').send(body({ round: 1, candidatePoints: [{ id: 'p1', label: 'Mid', lat: 51.5, lng: -0.1, kind: 'stretch_midpoint' }] }));

      expect(res.body.status).toBe('continue');
    });
  });
});

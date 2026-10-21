const express = require('express');
const request = require('supertest');

const MODEL = 'nvidia/nemotron-3-ultra-550b-a55b:free';
const KEY = 'test-key-not-real';

function loadApp() {
  let router;
  jest.isolateModules(() => {
    router = require('../../../src/gateway/routes/agentInsights');
  });
  const app = express();
  app.use('/api', router);
  return app;
}

/** A model reply that calls the given tools in one turn. */
const toolReply = (calls) => ({
  ok: true,
  status: 200,
  json: async () => ({
    choices: [
      {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: calls.map(([name, args], i) => ({
            id: `c${i}`,
            type: 'function',
            function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) },
          })),
        },
      },
    ],
  }),
});

const finishReply = (message) => toolReply([['finish', { message }]]);

/** Route 1 has a 200 m unlit stretch; route 2 has none and scores within 5 points, so the decision is switch to r2. */
function body(overrides = {}) {
  return {
    bestRouteId: 'r1',
    routes: [
      {
        routeId: 'r1',
        distanceMeters: 1200,
        durationSeconds: 900,
        score: 78,
        worstStretch: {
          lengthM: 200,
          cause: 'lighting',
          start: { lat: 51.5, lng: -0.1 },
          end: { lat: 51.51, lng: -0.09 },
        },
      },
      { routeId: 'r2', distanceMeters: 1500, durationSeconds: 1100, score: 76 },
    ],
    candidatePoints: [{ id: 'p1', label: 'Midpoint', lat: 51.505, lng: -0.095, kind: 'stretch_midpoint' }],
    ...overrides,
  };
}

describe('POST /api/agent-insights', () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.OPENROUTER_API_KEY;
  const originalModel = process.env.OPENROUTER_AGENT_MODEL;

  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = KEY;
    delete process.env.OPENROUTER_AGENT_MODEL;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalKey;
    if (originalModel === undefined) delete process.env.OPENROUTER_AGENT_MODEL;
    else process.env.OPENROUTER_AGENT_MODEL = originalModel;
  });

  test('returns 200 with analysis, decision, message and an actions array', async () => {
    global.fetch = jest.fn(async () =>
      finishReply('Route 1 has a dark stretch. Stay on the lit route. Stay aware of your surroundings.'),
    );
    const app = loadApp();

    const res = await request(app).post('/api/agent-insights').send(body());

    expect(res.status).toBe(200);
    expect(res.body.analysis.routes).toHaveLength(2);
    expect(res.body.analysis.routes[0].findings).toEqual([
      expect.objectContaining({ id: 'long_stretch', severity: 'risk' }),
    ]);
    expect(res.body.decision).toEqual(expect.objectContaining({ kind: 'switch', routeId: 'r2' }));
    expect(res.body.message).toBe('Route 1 has a dark stretch. Stay on the lit route. Stay aware of your surroundings.');
    expect(Array.isArray(res.body.actions)).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain(KEY);
  });

  test('calls the default model with reasoning disabled and the tool definitions', async () => {
    global.fetch = jest.fn(async () => finishReply('Stay aware of your surroundings.'));
    const app = loadApp();

    await request(app).post('/api/agent-insights').send(body());

    const sent = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(sent.model).toBe(MODEL);
    expect(sent.reasoning).toEqual({ enabled: false });
    expect(sent.tools.map((t) => t.function.name)).toEqual(expect.arrayContaining(['pan_to', 'finish', 'ask_user']));
  });

  test('returns the deterministic block and a fixed message when there is no API key', async () => {
    delete process.env.OPENROUTER_API_KEY;
    global.fetch = jest.fn();
    const app = loadApp();

    const res = await request(app).post('/api/agent-insights').send(body());

    expect(res.status).toBe(200);
    expect(res.body.decision).toEqual(expect.objectContaining({ kind: 'switch', routeId: 'r2' }));
    expect(res.body.analysis.routes).toHaveLength(2);
    expect(res.body.message).toContain('200 m');
    expect(res.body.actions).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('returns 400 for a bad body and never calls the model', async () => {
    global.fetch = jest.fn(async () => finishReply('x'));
    const app = loadApp();

    const missingBest = await request(app).post('/api/agent-insights').send({ routes: body().routes });
    const unknownBest = await request(app).post('/api/agent-insights').send(body({ bestRouteId: 'zz' }));
    const routesNotArray = await request(app).post('/api/agent-insights').send(body({ routes: 'x' }));

    expect(missingBest.status).toBe(400);
    expect(unknownBest.status).toBe(400);
    expect(routesNotArray.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('rejects a body over 450 kb before it reaches the model', async () => {
    global.fetch = jest.fn(async () => finishReply('x'));
    const app = loadApp();
    const huge = body({
      candidatePoints: [{ id: 'p1', label: 'x'.repeat(460 * 1024), lat: 51.5, lng: -0.1, kind: 'route_start' }],
    });

    const res = await request(app).post('/api/agent-insights').send(huge);

    expect([400, 413]).toContain(res.status);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('returns 200 with the deterministic block when the model returns invalid tool arguments', async () => {
    global.fetch = jest.fn(async () => toolReply([['pan_to', '{"candidateId": ']]));
    const app = loadApp();

    const res = await request(app).post('/api/agent-insights').send(body());

    expect(res.status).toBe(200);
    expect(res.body.actions).toEqual([]);
    expect(res.body.decision).toEqual(expect.objectContaining({ kind: 'switch' }));
    expect(res.body.message).toContain('200 m');
  });

  test('returns 200 with the deterministic block when the model call fails', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('network down');
    });
    const app = loadApp();

    const res = await request(app).post('/api/agent-insights').send(body());

    expect(res.status).toBe(200);
    expect(res.body.actions).toEqual([]);
    expect(res.body.analysis.routes).toHaveLength(2);
  });

  test('the model can only choose candidate ids: coordinates it sends are ignored', async () => {
    global.fetch = jest.fn(async () =>
      toolReply([
        ['pan_to', { candidateId: 'p1', lat: 0, lng: 0 }],
        ['pan_to', { candidateId: 'p7' }],
        ['finish', { message: 'Stay aware of your surroundings.' }],
      ]),
    );
    const app = loadApp();

    const res = await request(app).post('/api/agent-insights').send(body());

    expect(res.status).toBe(200);
    expect(res.body.actions).toEqual([{ type: 'pan_to', candidateId: 'p1' }]);
  });
});

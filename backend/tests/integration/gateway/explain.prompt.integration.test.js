const express = require('express');
const request = require('supertest');

function loadApp() {
  let router;
  jest.isolateModules(() => {
    router = require('../../../src/gateway/routes/explain');
  });
  const app = express();
  app.use(express.json({ limit: '50kb' }));
  app.use('/api', router);
  return app;
}

const breakdown = (over = {}) => ({
  roadType: 50, lighting: 50, crime: 50, cctv: 50, openPlaces: 50, traffic: 50, ...over,
});

const body = (tag) => ({
  bestRouteId: `${tag}-a`,
  routes: [
    { routeId: `${tag}-a`, distanceMeters: 1500, durationSeconds: 900, score: 80, breakdown: breakdown({ lighting: 80 }) },
    { routeId: `${tag}-b`, distanceMeters: 1000, durationSeconds: 600, score: 60, breakdown: breakdown({ lighting: 50 }) },
  ],
});

describe('POST /api/explain-route prompt', () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.OPENAI_API_KEY;
  const originalModel = process.env.OPENAI_EXPLAIN_MODEL;

  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test-key-not-real';
    delete process.env.OPENAI_EXPLAIN_MODEL;
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
    }));
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.OPENAI_API_KEY = originalKey;
    if (originalModel === undefined) delete process.env.OPENAI_EXPLAIN_MODEL;
    else process.env.OPENAI_EXPLAIN_MODEL = originalModel;
  });

  test('sends a system rule and the chosen-vs-alternative facts to the model', async () => {
    const res = await request(loadApp()).post('/api/explain-route').send(body('prompt1'));
    expect(res.status).toBe(200);

    const sent = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(sent.messages.map((m) => m.role)).toEqual(['system', 'user']);
    expect(sent.messages[0].content).toMatch(/higher means safer/);
    expect(sent.messages[1].content).toContain('Route 2');
    expect(sent.messages[1].content).toContain('street lighting');
    expect(sent.messages[1].content).toMatch(/5 min longer/);
    expect(sent.temperature).toBe(0.2);
  });

  test('defaults to gpt-4o-mini and honours OPENAI_EXPLAIN_MODEL', async () => {
    await request(loadApp()).post('/api/explain-route').send(body('model1'));
    expect(JSON.parse(global.fetch.mock.calls[0][1].body).model).toBe('gpt-4o-mini');

    process.env.OPENAI_EXPLAIN_MODEL = 'gpt-4.1-nano';
    await request(loadApp()).post('/api/explain-route').send(body('model2'));
    expect(JSON.parse(global.fetch.mock.calls[1][1].body).model).toBe('gpt-4.1-nano');
  });

  test('does not reuse a cached explanation when a route duration differs', async () => {
    const app = loadApp();
    const first = body('dur1');
    const second = body('dur1');
    second.routes[0].durationSeconds = 1800;

    await request(app).post('/api/explain-route').send(first);
    await request(app).post('/api/explain-route').send(second);

    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('does not reuse a cached explanation when the routes arrive in a different order', async () => {
    const app = loadApp();
    const first = body('ord1');
    const reversed = { ...body('ord1'), routes: [...first.routes].reverse() };

    await request(app).post('/api/explain-route').send(first);
    await request(app).post('/api/explain-route').send(reversed);

    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('rejects a bestRouteId that is not one of the routes', async () => {
    const res = await request(loadApp())
      .post('/api/explain-route')
      .send({ ...body('bad1'), bestRouteId: 'not-a-route' });

    expect(res.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});


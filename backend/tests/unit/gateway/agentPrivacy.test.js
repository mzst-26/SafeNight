const express = require('express');
const request = require('supertest');
const { buildAgentMessages } = require('../../../src/gateway/agent/loop');

const KEY = 'test-key-not-real';
const SESSION = 424242;
const EMAIL = 'walker.private@example.com';
const NAME = 'Jordan Walker';
const TOKEN = 'tok_live_9f8e7d6c5b4a';
const ADDRESS = '10 Downing Street';
const COORDS = ['51.50735', '-0.12775', '51.5049', '-0.1290', '51.5099', '-0.1301'];

// Values that must never reach the model, the logs or the response.
const FORBIDDEN = [String(SESSION), EMAIL, NAME, TOKEN, ADDRESS, ...COORDS];

function loadApp() {
  let router;
  jest.isolateModules(() => {
    router = require('../../../src/gateway/routes/agentInsights');
  });
  const app = express();
  app.use('/api', router);
  return app;
}

const finishReply = (message) => ({
  ok: true,
  status: 200,
  json: async () => ({
    choices: [
      {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 'c0', type: 'function', function: { name: 'finish', arguments: JSON.stringify({ message }) } }],
        },
      },
    ],
  }),
});

/** A request with coordinates, a session number, route paths, a labelled point with an address, and account fields. */
function privateBody() {
  return {
    sessionNumber: SESSION,
    round: 1,
    snapshot: 'data:image/jpeg;base64,AAAA',
    bestRouteId: 'r1',
    email: EMAIL,
    name: NAME,
    token: TOKEN,
    routes: [
      {
        routeId: 'r1',
        distanceMeters: 1200,
        durationSeconds: 900,
        score: 78,
        start: { lat: 51.50735, lng: -0.12775 },
        end: { lat: 51.5099, lng: -0.1301 },
        path: [
          { lat: 51.50735, lng: -0.12775 },
          { lat: 51.50123, lng: -0.14123 },
          { lat: 51.5099, lng: -0.1301 },
        ],
        worstStretch: {
          lengthM: 200,
          cause: 'lighting',
          start: { lat: 51.50735, lng: -0.12775 },
          end: { lat: 51.5099, lng: -0.1301 },
        },
      },
      {
        routeId: 'r2',
        distanceMeters: 1400,
        durationSeconds: 1100,
        score: 76,
        lightingQuality: 'verified',
        path: [{ lat: 51.50735, lng: -0.12775 }, { lat: 51.5099, lng: -0.1301 }],
      },
    ],
    candidatePoints: [{ id: 'p1', label: `Near ${ADDRESS}`, lat: 51.5049, lng: -0.1290, kind: 'stretch_midpoint' }],
  };
}

describe('agent privacy: nothing private reaches the model, the logs or the response', () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.OPENROUTER_API_KEY;

  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = KEY;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalKey;
    jest.restoreAllMocks();
  });

  test('the messages sent to the model hold no coordinates, session number, path, address or account data', async () => {
    global.fetch = jest.fn(async () => finishReply('Route 1 has a dark stretch. Stay aware of your surroundings.'));
    const app = loadApp();

    await request(app).post('/api/agent-insights').send(privateBody());

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(global.fetch.mock.calls[0][1].body);
    const messagesText = JSON.stringify(sent.messages);
    for (const value of FORBIDDEN) expect(messagesText).not.toContain(value);
    // No decimal coordinate-like number at all in the text the model reads.
    expect(messagesText).not.toMatch(/-?\d{1,3}\.\d{3,}/);
  });

  test('the logs hold no session number, path, coordinates, address or account data', async () => {
    global.fetch = jest.fn(async () => finishReply('Stay aware of your surroundings.'));
    const logs = [];
    for (const method of ['log', 'info', 'warn', 'error', 'debug']) {
      jest.spyOn(console, method).mockImplementation((...args) => logs.push(args.map(String).join(' ')));
    }
    const app = loadApp();

    await request(app).post('/api/agent-insights').send(privateBody());

    const output = logs.join('\n');
    for (const value of FORBIDDEN) expect(output).not.toContain(value);
  });

  test('the response holds no session number, path, coordinates, address or account data', async () => {
    global.fetch = jest.fn(async () => finishReply('Stay aware of your surroundings.'));
    const app = loadApp();

    const res = await request(app).post('/api/agent-insights').send(privateBody());

    expect(res.status).toBe(200);
    const responseText = JSON.stringify(res.body);
    for (const value of FORBIDDEN) expect(responseText).not.toContain(value);
  });

  test('the builder keeps point labels, coordinates and session data out of the messages', () => {
    const messages = buildAgentMessages({
      routes: [{ label: 'Route 1', routeId: 'r1', durationMin: 15, score: 78, risks: [], strengths: [] }],
      decision: { kind: 'keep', label: 'Route 1', reasons: ['Route 1 is the best choice.'] },
      candidates: [{ id: 'p1', label: `Near ${ADDRESS} ${COORDS[2]}, ${COORDS[3]}`, kind: 'stretch_midpoint', lat: 51.5049, lng: -0.1290 }],
      answer: null,
      snapshot: null,
    });
    const text = JSON.stringify(messages);
    expect(text).not.toContain(ADDRESS);
    expect(text).not.toContain(COORDS[2]);
    expect(text).toContain('p1');
  });
});

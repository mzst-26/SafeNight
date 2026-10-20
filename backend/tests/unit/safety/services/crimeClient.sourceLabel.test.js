/* eslint-env jest */
const fs = require('fs');
const os = require('os');
const path = require('path');

const MODULE_PATH = '../../../../src/safety/services/crimeClient';
const BBOX = { south: 51, west: -1.1, north: 51.1, east: -0.9 };

function loadModule(env = {}) {
  const previous = {};
  for (const [key, value] of Object.entries(env)) {
    previous[key] = process.env[key];
    if (value == null) delete process.env[key];
    else process.env[key] = String(value);
  }
  jest.resetModules();
  const mod = require(MODULE_PATH);
  mod.__resetForTests();
  return {
    ...mod,
    restoreEnv() {
      for (const [key, oldValue] of Object.entries(previous)) {
        if (oldValue == null) delete process.env[key];
        else process.env[key] = oldValue;
      }
    },
  };
}

function response(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

describe('crimeClient source label on a live fetch with no cache', () => {
  let cacheDir;
  let mod;

  beforeEach(() => {
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'safenight-crime-source-'));
    mod = loadModule({ SAFE_ROUTES_CACHE_DIR: cacheDir });
  });

  afterEach(() => {
    mod.restoreEnv();
    mod = null;
    delete global.fetch;
    jest.restoreAllMocks();
    fs.rmSync(cacheDir, { recursive: true, force: true });
  });

  test('a successful live fetch is labelled live', async () => {
    global.fetch = jest.fn(async () => response(200, []));
    const sourceMeta = [];

    const result = await mod.fetchCrimesWithStatus(BBOX, { onSourceMeta: (meta) => sourceMeta.push(meta) });

    expect(result.status).toBe('ok');
    expect(sourceMeta).toEqual([expect.objectContaining({ source: 'live', stale: false })]);
  });

  test('a failed live fetch with no cache is labelled live_error, not live', async () => {
    global.fetch = jest.fn(async () => response(503, { message: 'down' }));
    const sourceMeta = [];

    const result = await mod.fetchCrimesWithStatus(BBOX, { onSourceMeta: (meta) => sourceMeta.push(meta) });

    expect(result.status).toBe('unavailable');
    expect(sourceMeta).toEqual([expect.objectContaining({ source: 'live_error', stale: false })]);
  });
});

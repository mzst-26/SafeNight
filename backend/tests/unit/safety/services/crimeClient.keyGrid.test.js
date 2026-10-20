const fs = require('fs');
const os = require('os');
const path = require('path');

const MODULE_PATH = '../../../../src/safety/services/crimeClient';

function loadModule(cacheDir) {
  process.env.SAFE_ROUTES_CACHE_DIR = cacheDir;
  jest.resetModules();
  const mod = require(MODULE_PATH);
  mod.__resetForTests?.();
  return mod;
}

function makeResponse(payload) {
  return { status: 200, ok: true, json: async () => payload };
}

/** Parses the Police API poly parameter into [lat, lng] corners. */
function polyCorners(url) {
  const poly = new URL(url).searchParams.get('poly');
  return poly.split(':').map((pair) => pair.split(',').map(Number));
}

describe('crimeClient fetches the box its cache key names', () => {
  let cacheDir;
  let previousCacheDir;

  beforeEach(() => {
    previousCacheDir = process.env.SAFE_ROUTES_CACHE_DIR;
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'safenight-crime-keygrid-'));
  });

  afterEach(() => {
    delete global.fetch;
    if (previousCacheDir == null) delete process.env.SAFE_ROUTES_CACHE_DIR;
    else process.env.SAFE_ROUTES_CACHE_DIR = previousCacheDir;
    fs.rmSync(cacheDir, { recursive: true, force: true });
  });

  test('the live request uses the box snapped outward to the 1/200 degree key grid', async () => {
    const mod = loadModule(cacheDir);
    global.fetch = jest.fn(async () => makeResponse([]));

    await mod.fetchCrimesWithStatus({ south: 51.0012, west: -1.1003, north: 51.0049, east: -0.9004 });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const corners = polyCorners(global.fetch.mock.calls[0][0]);
    const lats = corners.map((c) => c[0]);
    const lngs = corners.map((c) => c[1]);
    // south 51.0012 -> 51.0, north 51.0049 -> 51.005, west -1.1003 -> -1.105, east -0.9004 -> -0.9
    expect(Math.min(...lats)).toBeCloseTo(51.0, 9);
    expect(Math.max(...lats)).toBeCloseTo(51.005, 9);
    expect(Math.min(...lngs)).toBeCloseTo(-1.105, 9);
    expect(Math.max(...lngs)).toBeCloseTo(-0.9, 9);
  });

  test('a box in a different key cell is not served the result fetched for another cell', async () => {
    const mod = loadModule(cacheDir);
    global.fetch = jest.fn(async () => makeResponse([]));

    // Both boxes used to round to the same key (north 51.005); their snapped boxes differ, so each fetches.
    await mod.fetchCrimesWithStatus({ south: 51.0, west: -1.0, north: 51.0049, east: -0.9 });
    await mod.fetchCrimesWithStatus({ south: 51.0, west: -1.0, north: 51.0051, east: -0.9 });

    expect(global.fetch).toHaveBeenCalledTimes(2);
    const northSecond = Math.max(...polyCorners(global.fetch.mock.calls[1][0]).map((c) => c[0]));
    expect(northSecond).toBeCloseTo(51.01, 9);
  });

  test('boxes that snap to the same cell share one cache entry', async () => {
    const mod = loadModule(cacheDir);
    global.fetch = jest.fn(async () => makeResponse([]));

    await mod.fetchCrimesWithStatus({ south: 51.001, west: -1.001, north: 51.004, east: -0.901 });
    await mod.fetchCrimesWithStatus({ south: 51.002, west: -1.002, north: 51.003, east: -0.902 });

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});

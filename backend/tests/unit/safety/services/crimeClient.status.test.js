/* eslint-env jest */
const fs = require('fs');
const os = require('os');
const path = require('path');

const MODULE_PATH = '../../../../src/safety/services/crimeClient';
const BBOX = { south: 51, west: -1.1, north: 51.1, east: -0.9 };
const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
const TWENTY_FIVE_HOURS_MS = 25 * 60 * 60 * 1000;

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

/** A fetch Response stand-in. `body` is returned by json(); an Error is thrown instead. */
function response(status, body) {
  const ok = status >= 200 && status < 300;
  return {
    status,
    ok,
    text: async () => (body instanceof Error ? '' : JSON.stringify(body)),
    json: async () => {
      if (body instanceof Error) throw body;
      return body;
    },
  };
}

const VALID_ROW = {
  category: 'violent-crime',
  month: '2026-03',
  location: { latitude: '51.0001', longitude: '-1.0001' },
};

describe('crimeClient status contract', () => {
  let cacheDir;
  let dateNowSpy;
  let mod;

  beforeEach(() => {
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'safenight-crime-status-'));
  });

  afterEach(() => {
    if (mod) mod.restoreEnv();
    mod = null;
    delete global.fetch;
    jest.restoreAllMocks();
    if (dateNowSpy) {
      dateNowSpy.mockRestore();
      dateNowSpy = null;
    }
    fs.rmSync(cacheDir, { recursive: true, force: true });
  });

  function load(extra = {}) {
    mod = loadModule({ SAFE_ROUTES_CACHE_DIR: cacheDir, ...extra });
    return mod;
  }

  describe('fetchCrimesWithStatus', () => {
    test('a 200 with crimes is status ok and carries parsed coordinates and severity', async () => {
      const client = load();
      global.fetch = jest.fn(async () => response(200, [VALID_ROW]));

      const result = await client.fetchCrimesWithStatus(BBOX);

      expect(result.status).toBe('ok');
      expect(result.crimes).toEqual([
        {
          lat: 51.0001,
          lng: -1.0001,
          category: 'violent-crime',
          severity: 1,
          month: '2026-03',
        },
      ]);
    });

    test('a genuine 200 with an empty array is status ok and is cached as a real zero', async () => {
      const client = load();
      global.fetch = jest.fn(async () => response(200, []));

      const first = await client.fetchCrimesWithStatus(BBOX);
      expect(first).toMatchObject({ status: 'ok', crimes: [] });

      global.fetch = jest.fn(async () => {
        throw new Error('network should not be called for a cached zero');
      });
      const second = await client.fetchCrimesWithStatus(BBOX);
      expect(second).toMatchObject({ status: 'ok', crimes: [] });
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test.each([
      ['429 Too Many Requests', 429],
      ['503 Service Unavailable', 503],
      ['404 Not Found', 404],
    ])('a %s is status unavailable, not a good zero, and is not cached', async (_label, status) => {
      const client = load();
      global.fetch = jest.fn(async () => response(status, { message: 'nope' }));

      const first = await client.fetchCrimesWithStatus(BBOX);
      expect(first).toMatchObject({ status: 'unavailable', crimes: [] });

      const second = await client.fetchCrimesWithStatus(BBOX);
      expect(second).toMatchObject({ status: 'unavailable', crimes: [] });
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    test('a network error with no cache is status unavailable and is not cached', async () => {
      const client = load();
      global.fetch = jest.fn(async () => {
        throw new TypeError('fetch failed');
      });

      const first = await client.fetchCrimesWithStatus(BBOX);
      expect(first).toMatchObject({ status: 'unavailable', crimes: [] });

      global.fetch = jest.fn(async () => response(200, [VALID_ROW]));
      const second = await client.fetchCrimesWithStatus(BBOX);
      expect(second.status).toBe('ok');
      expect(second.crimes).toHaveLength(1);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    test('an unparseable body is status unavailable and is not cached', async () => {
      const client = load();
      global.fetch = jest.fn(async () => response(200, new SyntaxError('Unexpected token <')));

      const first = await client.fetchCrimesWithStatus(BBOX);
      expect(first).toMatchObject({ status: 'unavailable', crimes: [] });

      global.fetch = jest.fn(async () => response(200, [VALID_ROW]));
      const second = await client.fetchCrimesWithStatus(BBOX);
      expect(second.status).toBe('ok');
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    test('a 200 whose body is not an array is status unavailable', async () => {
      const client = load();
      global.fetch = jest.fn(async () => response(200, { error: 'unexpected shape' }));

      const result = await client.fetchCrimesWithStatus(BBOX);
      expect(result).toMatchObject({ status: 'unavailable', crimes: [] });
    });

    test('rows with non-finite or out-of-range coordinates are skipped', async () => {
      const client = load();
      global.fetch = jest.fn(async () =>
        response(200, [
          VALID_ROW,
          { category: 'burglary', month: '2026-03', location: { latitude: 'abc', longitude: '-1' } },
          { category: 'burglary', month: '2026-03', location: { latitude: '51', longitude: 'Infinity' } },
          { category: 'burglary', month: '2026-03', location: { latitude: '95', longitude: '-1' } },
          { category: 'burglary', month: '2026-03', location: { latitude: '51', longitude: '-200' } },
          { category: 'burglary', month: '2026-03' },
        ]),
      );

      const result = await client.fetchCrimesWithStatus(BBOX);

      expect(result.status).toBe('ok');
      expect(result.crimes).toHaveLength(1);
      expect(result.crimes[0]).toMatchObject({ lat: 51.0001, lng: -1.0001 });
    });

    test('a 503 with a usable stale cache serves the stale data and reports ok', async () => {
      dateNowSpy = jest.spyOn(Date, 'now');
      let nowMs = 1000;
      dateNowSpy.mockImplementation(() => nowMs);
      const client = load({
        SAFE_ROUTES_CRIME_MAX_STALE_MS: String(TWELVE_HOURS_MS),
        SAFE_ROUTES_CRIME_STALE_FETCH_GRACE_MS: '5000',
      });

      global.fetch = jest.fn(async () => response(200, [VALID_ROW]));
      await client.fetchCrimesWithStatus(BBOX);

      nowMs += TWENTY_FIVE_HOURS_MS;
      global.fetch = jest.fn(async () => response(503, {}));
      const sourceMeta = [];
      const result = await client.fetchCrimesWithStatus(BBOX, {
        onSourceMeta: (meta) => sourceMeta.push(meta),
      });

      expect(result.status).toBe('ok');
      expect(result.crimes).toHaveLength(1);
      expect(sourceMeta[sourceMeta.length - 1]).toMatchObject({
        source: 'cache_stale',
        stale: true,
        staleFallbackReason: 'live_error',
      });
    });

    test('a network error with a usable stale cache serves the stale data and reports ok', async () => {
      dateNowSpy = jest.spyOn(Date, 'now');
      let nowMs = 1000;
      dateNowSpy.mockImplementation(() => nowMs);
      const client = load({
        SAFE_ROUTES_CRIME_MAX_STALE_MS: String(TWELVE_HOURS_MS),
        SAFE_ROUTES_CRIME_STALE_FETCH_GRACE_MS: '5000',
      });

      global.fetch = jest.fn(async () => response(200, [VALID_ROW]));
      await client.fetchCrimesWithStatus(BBOX);

      nowMs += TWENTY_FIVE_HOURS_MS;
      global.fetch = jest.fn(async () => {
        throw new TypeError('fetch failed');
      });
      const result = await client.fetchCrimesWithStatus(BBOX);

      expect(result.status).toBe('ok');
      expect(result.crimes).toHaveLength(1);
    });

    test('a fresh genuine 200 [] beats a stale cache with crimes', async () => {
      dateNowSpy = jest.spyOn(Date, 'now');
      let nowMs = 1000;
      dateNowSpy.mockImplementation(() => nowMs);
      const client = load({
        SAFE_ROUTES_CRIME_MAX_STALE_MS: String(TWELVE_HOURS_MS),
        SAFE_ROUTES_CRIME_STALE_FETCH_GRACE_MS: '5000',
      });

      global.fetch = jest.fn(async () => response(200, [VALID_ROW]));
      await client.fetchCrimesWithStatus(BBOX);

      nowMs += TWENTY_FIVE_HOURS_MS;
      global.fetch = jest.fn(async () => response(200, []));
      const result = await client.fetchCrimesWithStatus(BBOX);

      expect(result).toMatchObject({ status: 'ok', crimes: [] });
    });

    test('a 503 with a stale cache is not cached as a zero over the stale data', async () => {
      dateNowSpy = jest.spyOn(Date, 'now');
      let nowMs = 1000;
      dateNowSpy.mockImplementation(() => nowMs);
      const client = load({
        SAFE_ROUTES_CRIME_MAX_STALE_MS: String(TWELVE_HOURS_MS),
        SAFE_ROUTES_CRIME_STALE_FETCH_GRACE_MS: '5000',
      });

      global.fetch = jest.fn(async () => response(200, [VALID_ROW]));
      await client.fetchCrimesWithStatus(BBOX);

      nowMs += TWENTY_FIVE_HOURS_MS;
      global.fetch = jest.fn(async () => response(503, {}));
      await client.fetchCrimesWithStatus(BBOX);

      // The stale entry must still be there for the next request if upstream is still down.
      global.fetch = jest.fn(async () => response(503, {}));
      const again = await client.fetchCrimesWithStatus(BBOX);
      expect(again.status).toBe('ok');
      expect(again.crimes).toHaveLength(1);
    });
  });

  describe('fetchCrimesInBbox (thin wrapper)', () => {
    test('returns the crime array on success', async () => {
      const client = load();
      global.fetch = jest.fn(async () => response(200, [VALID_ROW]));

      const crimes = await client.fetchCrimesInBbox(BBOX);

      expect(Array.isArray(crimes)).toBe(true);
      expect(crimes).toHaveLength(1);
    });

    test('returns an empty array when the upstream is unavailable', async () => {
      const client = load();
      global.fetch = jest.fn(async () => response(503, {}));

      await expect(client.fetchCrimesInBbox(BBOX)).resolves.toEqual([]);
    });
  });
});

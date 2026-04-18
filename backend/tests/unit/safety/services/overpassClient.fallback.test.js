const { fetchAllSafetyData } = require('../../../../src/safety/services/overpassClient');

function makeResponse(status, payload) {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () =>
      typeof payload === 'string' ? payload : JSON.stringify(payload || {}),
    json: async () => {
      if (typeof payload === 'string') return JSON.parse(payload);
      return payload || {};
    },
  };
}

function decodeOverpassQuery(body) {
  if (typeof body !== 'string') return '';
  if (!body.startsWith('data=')) return body;
  return decodeURIComponent(body.slice(5));
}

function classifyQuery(query) {
  if (query.includes(')->.roads') && query.includes(')->.transit')) {
    return 'combined';
  }
  if (query.includes('node["highway"="street_lamp"]')) return 'lights';
  if (query.includes('node["man_made"="surveillance"]')) return 'cctv';
  if (query.includes('node["public_transport"="platform"]')) return 'transit';
  if (query.includes('node["amenity"]') && query.includes('out center')) {
    return 'places';
  }
  if (query.includes('way["highway"~"^(trunk|primary')) return 'roads';
  return 'unknown';
}

describe('overpassClient fallback behavior', () => {
  afterEach(() => {
    delete global.fetch;
    jest.restoreAllMocks();
  });

  test('falls back to split queries when combined query hits upstream 5xx', async () => {
    const hits = {
      combined: 0,
      roads: 0,
      lights: 0,
      cctv: 0,
      places: 0,
      transit: 0,
    };

    global.fetch = jest.fn(async (_url, options = {}) => {
      const query = decodeOverpassQuery(options.body);
      const kind = classifyQuery(query);
      if (kind in hits) hits[kind] += 1;

      if (kind === 'combined') {
        return makeResponse(504, '<html>gateway timeout</html>');
      }
      if (kind === 'roads') {
        return makeResponse(200, {
          elements: [
            {
              type: 'way',
              id: 10,
              nodes: [1, 2],
              tags: { highway: 'residential' },
            },
            { type: 'node', id: 1, lat: 50.1, lon: -4.1 },
            { type: 'node', id: 2, lat: 50.1005, lon: -4.1005 },
          ],
        });
      }
      if (kind === 'lights') {
        return makeResponse(200, {
          elements: [{ type: 'node', id: 3, lat: 50.1, lon: -4.1, tags: { highway: 'street_lamp' } }],
        });
      }
      if (kind === 'cctv') {
        return makeResponse(200, {
          elements: [{ type: 'node', id: 4, lat: 50.1, lon: -4.1, tags: { man_made: 'surveillance' } }],
        });
      }
      if (kind === 'places') {
        return makeResponse(200, {
          elements: [{ type: 'node', id: 5, lat: 50.1, lon: -4.1, tags: { amenity: 'cafe' } }],
        });
      }
      if (kind === 'transit') {
        return makeResponse(200, {
          elements: [{ type: 'node', id: 6, lat: 50.1, lon: -4.1, tags: { highway: 'bus_stop' } }],
        });
      }

      return makeResponse(200, { elements: [] });
    });

    const data = await fetchAllSafetyData({
      south: 50.0,
      west: -4.2,
      north: 50.2,
      east: -4.0,
    });

    expect(hits.combined).toBeGreaterThanOrEqual(1);
    expect(hits.roads).toBeGreaterThanOrEqual(1);
    expect(data.roads.elements.length).toBeGreaterThan(0);
    expect(data.lights.elements.length).toBeGreaterThan(0);
    expect(data.cctv.elements.length).toBeGreaterThan(0);
    expect(data.places.elements.length).toBeGreaterThan(0);
    expect(data.transit.elements.length).toBeGreaterThan(0);
  });

  test('keeps routes available when optional split category fails', async () => {
    const hits = {
      combined: 0,
      roads: 0,
      lights: 0,
      cctv: 0,
      places: 0,
      transit: 0,
    };

    global.fetch = jest.fn(async (_url, options = {}) => {
      const query = decodeOverpassQuery(options.body);
      const kind = classifyQuery(query);
      if (kind in hits) hits[kind] += 1;

      if (kind === 'combined') {
        return makeResponse(504, '<html>gateway timeout</html>');
      }
      if (kind === 'cctv') {
        return makeResponse(504, '<html>upstream timeout</html>');
      }
      if (kind === 'roads') {
        return makeResponse(200, {
          elements: [
            {
              type: 'way',
              id: 20,
              nodes: [11, 12],
              tags: { highway: 'residential' },
            },
            { type: 'node', id: 11, lat: 50.3, lon: -4.3 },
            { type: 'node', id: 12, lat: 50.31, lon: -4.31 },
          ],
        });
      }
      if (kind === 'lights') {
        return makeResponse(200, { elements: [] });
      }
      if (kind === 'places') {
        return makeResponse(200, { elements: [] });
      }
      if (kind === 'transit') {
        return makeResponse(200, { elements: [] });
      }

      return makeResponse(200, { elements: [] });
    });

    const data = await fetchAllSafetyData({
      south: 50.25,
      west: -4.35,
      north: 50.35,
      east: -4.25,
    });

    expect(hits.combined).toBeGreaterThanOrEqual(1);
    expect(hits.roads).toBeGreaterThanOrEqual(1);
    expect(hits.cctv).toBeGreaterThanOrEqual(1);
    expect(data.roads.elements.length).toBeGreaterThan(0);
    expect(data.cctv.elements).toEqual([]);
  });
});

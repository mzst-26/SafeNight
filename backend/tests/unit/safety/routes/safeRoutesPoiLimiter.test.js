const path = require('path');
const limiter = require(path.resolve(__dirname, '../../../../src/safety/routes/safeRoutesPoiLimiter'));

describe('normalizeResponsePolicy', () => {
  test('defaults to full verbosity, open places only and 500 per category', () => {
    expect(limiter.normalizeResponsePolicy()).toEqual({
      verbosity: 'full', openPlacesOnly: true,
      poiCaps: { cctv: 500, transit: 500, deadEnds: 500, lights: 500, places: 500, crimes: 500 },
    });
  });

  test('accepts compact, openPlacesOnly false, positive integer caps (floored) and Infinity', () => {
    const policy = limiter.normalizeResponsePolicy({
      verbosity: 'compact', openPlacesOnly: false, poiCaps: { cctv: 3.9, transit: Infinity, lights: 1 },
    });
    expect(policy).toMatchObject({ verbosity: 'compact', openPlacesOnly: false });
    expect(policy.poiCaps).toMatchObject({ cctv: 3, transit: Infinity, lights: 1, places: 500 });
  });

  test('unknown verbosity is full; bad caps fall back to the default', () => {
    const policy = limiter.normalizeResponsePolicy({ verbosity: 'weird', poiCaps: { cctv: 0, transit: -1, deadEnds: NaN, lights: 'x', places: null } });
    expect(policy.verbosity).toBe('full');
    expect(policy.poiCaps).toMatchObject({ cctv: 500, transit: 500, deadEnds: 500, lights: 500, places: 500 });
  });
});

describe('buildRouteVertices', () => {
  test('maps path nodes to vertices, skipping unknown and non-finite nodes', () => {
    const nodes = new Map([[1, { lat: 1, lng: 2 }], [2, { lat: NaN, lng: 2 }], [3, { lat: 3, lng: 4 }]]);
    expect(limiter.buildRouteVertices([1, 2, 3, 9], nodes)).toEqual([{ lat: 1, lng: 2 }, { lat: 3, lng: 4 }]);
    expect(limiter.buildRouteVertices(undefined, nodes)).toEqual([]);
  });
});

describe('limitRoutePois', () => {
  const caps = (over) => ({ cctv: 500, transit: 500, deadEnds: 500, lights: 500, places: 500, crimes: 500, ...over });
  const pts = (n, lat0 = 50.37) => Array.from({ length: n }, (_, i) => ({ lat: lat0 + i * 0.001, lng: -4.14 }));
  const vertices = [{ lat: 50.37, lng: -4.14 }, { lat: 50.38, lng: -4.14 }, { lat: 50.39, lng: -4.14 }];

  test('returns every category, empty for missing ones', () => {
    const out = limiter.limitRoutePois({}, caps(), vertices, 50.37, -4.14);
    expect(out).toEqual({ cctv: [], transit: [], deadEnds: [], lights: [], places: [], crimes: [] });
  });

  test('points under the cap are returned as they are; Infinity keeps everything', () => {
    const cctv = pts(4);
    expect(limiter.limitRoutePois({ cctv }, caps(), vertices, 50.37, -4.14).cctv).toBe(cctv);
    expect(limiter.limitRoutePois({ cctv: pts(30) }, caps({ cctv: Infinity }), vertices, 50.37, -4.14).cctv).toHaveLength(30);
  });

  test('a zero, negative or NaN cap keeps nothing', () => {
    for (const cap of [0, -2, NaN]) {
      expect(limiter.limitRoutePois({ cctv: pts(5) }, caps({ cctv: cap }), vertices, 50.37, -4.14).cctv).toEqual([]);
      expect(limiter.limitRoutePois({ cctv: pts(5) }, caps({ cctv: cap }), [], 50.37, -4.14).cctv).toEqual([]);
    }
  });

  test('over the cap, points are spread round-robin over the route segments', () => {
    // Four points near segment 0 (lat 50.371-50.374) and four near segment 1 (50.385-50.388).
    const near0 = [0.371, 0.372, 0.373, 0.374].map((l) => ({ lat: 50 + l, lng: -4.14 }));
    const near1 = [0.385, 0.386, 0.387, 0.388].map((l) => ({ lat: 50 + l, lng: -4.14 }));
    const out = limiter.limitRoutePois({ cctv: [...near0, ...near1] }, caps({ cctv: 2 }), vertices, 50.37, -4.14).cctv;
    expect(out).toHaveLength(2);
    expect(out.some((p) => p.lat < 50.38)).toBe(true);
    expect(out.some((p) => p.lat > 50.38)).toBe(true);
  });

  test('a route with fewer than two vertices takes the points nearest the origin', () => {
    const cctv = [{ lat: 50.5, lng: -4.14 }, { lat: 50.371, lng: -4.14 }, { lat: 50.4, lng: -4.14 }];
    const out = limiter.limitRoutePois({ cctv }, caps({ cctv: 2 }), [], 50.37, -4.14).cctv;
    expect(out).toEqual([{ lat: 50.371, lng: -4.14 }, { lat: 50.4, lng: -4.14 }]);
  });

  test('a non-array category is empty, with or without geometry', () => {
    expect(limiter.limitRoutePois({ cctv: 'x' }, caps(), vertices, 0, 0).cctv).toEqual([]);
    expect(limiter.limitRoutePois({ cctv: 'x' }, caps(), [], 0, 0).cctv).toEqual([]);
  });

  test('a zero-length route segment still measures distance to its point', () => {
    const same = [{ lat: 50.37, lng: -4.14 }, { lat: 50.37, lng: -4.14 }];
    const out = limiter.limitRoutePois({ cctv: pts(6) }, caps({ cctv: 2 }), same, 50.37, -4.14).cctv;
    expect(out).toHaveLength(2);
  });
});

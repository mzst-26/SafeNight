const path = require('path');
const lighting = require(path.resolve(__dirname, '../../../../../src/safety/services/graph/lightingStage'));

const LAT = 51.5;
const LNG = -0.1;
const noTick = () => {};

describe('graph/lightingStage collectLightSources', () => {
  const osmNodes = new Map([[1, { lat: LAT, lng: LNG }], [2, { lat: LAT, lng: LNG + 0.001 }]]);

  test('collects street lamps and the vertices of lit=yes ways that are known', () => {
    const src = lighting.collectLightSources({
      elements: [
        { type: 'node', lat: LAT, lon: LNG, tags: { highway: 'street_lamp' } },
        { type: 'node', lat: LAT, lon: LNG, tags: { highway: 'bus_stop' } },
        { type: 'way', nodes: [1, 2, 99], tags: { lit: 'yes' } },
        { type: 'way', nodes: [1], tags: { lit: 'no' } },
        { type: 'way', tags: { lit: 'yes' } },
      ],
    }, osmNodes, noTick);
    expect(src.lamps).toEqual([{ lat: LAT, lng: LNG }]);
    expect(src.lampGrid).toBeDefined();
    expect(src.litGrid).toBeDefined();
  });

  test('no light data gives empty sources', () => {
    expect(lighting.collectLightSources(null, osmNodes, noTick).lamps).toEqual([]);
  });
});

describe('graph/lightingStage area stats', () => {
  test('areaCellKey groups points within the same 0.003 degree cell', () => {
    expect(lighting.areaCellKey(51.5001, -0.1001)).toBe(lighting.areaCellKey(51.5002, -0.1002));
    expect(lighting.areaCellKey(51.5, -0.1)).not.toBe(lighting.areaCellKey(51.504, -0.1));
  });

  test('buildAreaStats sums lamps and road km per cell and the total', () => {
    const segments = [
      { dist: 500, midLat: 51.5001, midLng: -0.1001 },
      { dist: 250, midLat: 51.5002, midLng: -0.1002 },
      { dist: 1000, midLat: 51.52, midLng: -0.1 },
    ];
    const { areaStats, totalWayKm } = lighting.buildAreaStats([{ lat: 51.5001, lng: -0.1001 }, { lat: 51.5001, lng: -0.1001 }], segments);
    expect(totalWayKm).toBeCloseTo(1.75, 12);
    expect(areaStats.get(lighting.areaCellKey(51.5001, -0.1001))).toEqual({ lamps: 2, wayKm: 0.75 });
    expect(areaStats.get(lighting.areaCellKey(51.52, -0.1))).toEqual({ lamps: 0, wayKm: 1 });
  });
});

describe('graph/lightingStage createRoadIndexGetter', () => {
  test('builds the index once, on first use, from road-class segments only', () => {
    const seg = (highway) => ({ highway, nA: { lat: LAT, lng: LNG }, nB: { lat: LAT, lng: LNG + 0.001 } });
    const get = lighting.createRoadIndexGetter([seg('residential'), seg('footway')]);
    const first = get();
    expect(first).toBeDefined();
    expect(get()).toBe(first);
  });
});

describe('graph/lightingStage applyLightsCache', () => {
  const inferred = { pLit: 0.72, n: 3, source: 'prior' };
  const tagged = { pLit: 0.95, n: 20, source: 'tag' };

  test('no record leaves the inference alone', () => {
    expect(lighting.applyLightsCache(inferred, null)).toBe(inferred);
    expect(lighting.applyLightsCache(inferred, { lit_status: 'unknown', confidence: 0.9 })).toBe(inferred);
  });

  test('a verified unlit record beats everything, even an explicit lit tag', () => {
    expect(lighting.applyLightsCache(tagged, { lit_status: 'unlit', confidence: 0.8 })).toEqual({ pLit: 0.05, n: 20, source: 'cache' });
    expect(lighting.applyLightsCache(inferred, { lit_status: 'unlit', confidence: 0.9 })).toEqual({ pLit: 0.05, n: 20, source: 'cache' });
  });

  test('an explicit tag beats a verified lit record', () => {
    expect(lighting.applyLightsCache(tagged, { lit_status: 'lit', confidence: 0.9 })).toBe(tagged);
  });

  test('a verified lit record beats an inference', () => {
    expect(lighting.applyLightsCache(inferred, { lit_status: 'lit', confidence: 0.8 })).toEqual({ pLit: 0.95, n: 20, source: 'cache' });
  });

  test('an unverified record feeds the estimate with modest evidence', () => {
    const out = lighting.applyLightsCache(inferred, { lit_status: 'lit', confidence: 0.5 });
    expect(out.source).toBe('cache');
    expect(out.n).toBe(6);
    expect(out.pLit).toBeCloseTo(0.85, 12); // 0.7 + 0.5 * 0.3
    const dark = lighting.applyLightsCache(inferred, { lit_status: 'unlit', confidence: 0.5 });
    expect(dark.pLit).toBeCloseTo(0.075, 12);
  });
});

describe('graph/lightingStage litEstimateOf', () => {
  test.each([
    ['tag', 0.7, 'lit'], ['lamp', 0.9, 'lit'], ['prior', 0.95, 'estimated_lit'], ['cache', 0.95, 'estimated_lit'],
    ['tag', 0.2, 'unlit'], ['cache', 0.05, 'unlit'], ['lamp', 0.1, 'estimated_unlit'], ['prior', 0.1, 'estimated_unlit'],
    ['tag', 0.5, 'estimated_lit'], ['tag', 0.45, 'estimated_unlit'],
  ])('source %s effective %f -> %s', (source, effective, label) => {
    expect(lighting.litEstimateOf(source, effective)).toBe(label);
  });
});

describe('graph/lightingStage lightingAt', () => {
  const seg = (highway, tags = {}) => ({ highway, tags: { highway, ...tags }, midLat: LAT, midLng: LNG });
  const sourcesWith = (lampsAt = [], litAt = []) => {
    const { buildSpatialGrid } = require(path.resolve(__dirname, '../../../../../src/safety/services/geo'));
    return { lampGrid: buildSpatialGrid(lampsAt), litGrid: buildSpatialGrid(litAt) };
  };
  const context = (wayKm = 1, lamps = 0) => ({
    areaStats: new Map([[lighting.areaCellKey(LAT, LNG), { lamps, wayKm }]]),
    roadIndex: () => { throw new Error('road index should not be built for a road'); },
  });

  test('a lamp within 30 m gives lamp evidence and a lit estimate', () => {
    const out = lighting.lightingAt(seg('residential'), sourcesWith([{ lat: LAT + 0.0001, lng: LNG }]), context(), null);
    expect(out.lighting.source).toBe('lamp');
    expect(out.litEstimate).toBe('lit');
    expect(out.lampCountNearPath).toBe(1);
    expect(out.nearRoad).toBeUndefined();
  });

  test('a lamp 40 m away is outside the 30 m radius but inside the 60 m path radius', () => {
    const out = lighting.lightingAt(seg('residential'), sourcesWith([{ lat: LAT + 0.00036, lng: LNG }]), context(), null);
    expect(out.lighting.source).not.toBe('lamp');
    expect(out.lampCountNearPath).toBe(1);
  });

  test('a lit=yes tag wins and is classified lit', () => {
    const out = lighting.lightingAt(seg('residential', { lit: 'yes' }), sourcesWith(), context(), null);
    expect(out.lighting.source).toBe('tag');
    expect(out.litEstimate).toBe('lit');
  });

  test('footway-like ways ask the road index, and report nearRoad', () => {
    const ctx = { ...context(), roadIndex: jest.fn(() => ({ isNear: true })) };
    const roadProximity = require(path.resolve(__dirname, '../../../../../src/safety/scoring/roadProximity'));
    const spy = jest.spyOn(roadProximity, 'isNearRoad');
    const out = lighting.lightingAt(seg('footway'), sourcesWith(), ctx, null);
    expect(ctx.roadIndex).toHaveBeenCalledTimes(1);
    expect(typeof out.nearRoad).toBe('boolean');
    spy.mockRestore();
  });

  test('a verified unlit cache record overrides lamps', () => {
    const out = lighting.lightingAt(seg('residential'), sourcesWith([{ lat: LAT, lng: LNG }]), context(), { lit_status: 'unlit', confidence: 0.9 });
    expect(out.lighting).toEqual({ pLit: 0.05, n: 20, source: 'cache' });
    expect(out.litEstimate).toBe('unlit');
  });

  test('an area with no mapped road gives zero lamp density instead of dividing by zero', () => {
    const out = lighting.lightingAt(seg('path'), sourcesWith(), context(0, 5), null);
    expect(Number.isFinite(out.lightingSafety)).toBe(true);
  });
});

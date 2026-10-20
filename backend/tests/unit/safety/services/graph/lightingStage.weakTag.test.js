const path = require('path');
const lighting = require(path.resolve(__dirname, '../../../../../src/safety/services/graph/lightingStage'));
const { buildSpatialGrid } = require(path.resolve(__dirname, '../../../../../src/safety/services/geo'));
const { buildGraph } = require(path.resolve(__dirname, '../../../../../src/safety/services/safetyGraph'));
const { NIGHT, buildScene } = require('../../scoring/fixtures/calibrationScenes');

const LAT = 51.5;
const LNG = -0.1;
const km = 111.32;

function segment(highway, tags) {
  return { highway, tags: { highway, ...tags }, midLat: LAT, midLng: LNG };
}

/** Lighting for a segment with the given way context, area lamp stats and lamps nearby (metres north of the segment). */
function lightingFor(seg, { context = 'crossing', lamps = 9, wayKm = 2, lampAtM = null } = {}) {
  const ctx = {
    areaStats: new Map([[lighting.areaCellKey(LAT, LNG), { lamps, wayKm }]]),
    roadIndex: () => { throw new Error('unused'); },
    wayContext: () => context,
  };
  const lampList = lampAtM === null ? [] : [{ lat: LAT + lampAtM / (km * 1000), lng: LNG }];
  const sources = { lampGrid: buildSpatialGrid(lampList), litGrid: buildSpatialGrid([]) };
  return lighting.lightingAt(seg, sources, ctx, null);
}

describe('graph/lightingStage weak lit tag', () => {
  const litFootway = segment('footway', { lit: 'yes' });

  test('lit=yes on a crossing structure with no lamp within 60 m in a lamped area is weak (0.7, n 6)', () => {
    const { lighting: l, litEstimate } = lightingFor(litFootway);
    expect(l).toEqual({ pLit: 0.7, n: 6, source: 'weak-tag' });
    expect(litEstimate).toBe('estimated_lit'); // never labelled verified lit
  });

  test('also weak on an isolated footway and on a path-class way', () => {
    expect(lightingFor(litFootway, { context: 'isolated' }).lighting.source).toBe('weak-tag');
    expect(lightingFor(segment('path', { lit: 'yes' }), { context: undefined }).lighting.source).toBe('weak-tag');
  });

  test('a way alongside a street keeps the strong tag', () => {
    expect(lightingFor(litFootway, { context: 'alongside' }).lighting).toMatchObject({ pLit: 0.95, n: 20, source: 'tag' });
  });

  test('a lamp within 60 m restores the strong tag', () => {
    expect(lightingFor(litFootway, { lampAtM: 50 }).lighting.source).toBe('tag');
    expect(lightingFor(litFootway, { lampAtM: 70 }).lighting.source).toBe('weak-tag');
  });

  test('without mapped lamps in the area (sparse mapping) the tag stays strong', () => {
    expect(lightingFor(litFootway, { lamps: 0 }).lighting.source).toBe('tag');
    expect(lightingFor(litFootway, { lamps: 3, wayKm: 2 }).lighting.source).toBe('tag'); // 1.5 per km
    expect(lightingFor(litFootway, { wayKm: 0.1, lamps: 5 }).lighting.source).toBe('tag'); // too little mapped road
  });

  test('other tags and road classes are unchanged', () => {
    expect(lightingFor(segment('footway', { lit: 'no' })).lighting.pLit).toBe(0.05);
    expect(lightingFor(segment('residential', { lit: 'yes' }), { context: undefined }).lighting.source).toBe('tag');
  });
});

describe('A38-footbridge-like scene through buildGraph', () => {
  const TRUNK = { highway: 'trunk', maxspeed: '60 mph', lit: 'yes' };
  const STREET = { highway: 'residential', maxspeed: '30 mph' };
  const options = { level: 'extra', crimeStatus: 'ok', ...NIGHT };
  async function build(footwayTags, lamps) {
    const scene = buildScene({
      ways: [
        { name: 'target', tags: footwayTags, points: [[0, -75], [0, 75]] },
        { name: 'trunk', tags: TRUNK, points: [[-300, 0], [300, 0]] },
        { name: 'culver', tags: STREET, points: [[-150, 75], [0, 75], [150, 75]] },
        { name: 'reddington', tags: STREET, points: [[-150, -75], [0, -75], [150, -75]] },
      ],
      lamps,
    });
    const g = await buildGraph(scene.roadData, scene.lightData, scene.cctvData, scene.placeData,
      scene.transitData, scene.crimes, scene.bbox, options);
    return g.edges.find((e) => e.roadName === 'target');
  }
  // Lamps along the street 100 m south of the bridge midpoint: beyond LAMP_NEAR_PATH_M (60 m), inside the area cell.
  const farLamps = Array.from({ length: 30 }, (_, i) => [i * 5, -100]);
  const lampOnBridge = [[5, 10], [5, -10]];

  test('a lit=yes footbridge with lamps mapped around but none near it is weak evidence, not verified lit', async () => {
    const edge = await build({ highway: 'footway', lit: 'yes' }, farLamps);
    expect(edge.pLit).toBeCloseTo(0.7, 9);
    expect(edge.litEstimate).toBe('estimated_lit');
  });

  test('the same bridge with a lamp on it keeps the strong tag and scores higher', async () => {
    const weak = await build({ highway: 'footway', lit: 'yes' }, farLamps);
    const strong = await build({ highway: 'footway', lit: 'yes' }, [...farLamps, ...lampOnBridge]);
    expect(strong.pLit).toBeCloseTo(0.95, 9);
    expect(strong.risk).toBeLessThan(weak.risk);
  });

  test('with no lamps mapped anywhere the lit=yes tag is still trusted', async () => {
    const edge = await build({ highway: 'footway', lit: 'yes' }, []);
    expect(edge.pLit).toBeCloseTo(0.95, 9);
  });
});

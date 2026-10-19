/**
 * safetyGraph graph-building parts: crime month adapter, v1 helper naming, config-driven
 * lamp radius, crime severity fallback, opening-hours parsing and heuristics, and the
 * distance-only fallback graph used when the safety graph is not needed.
 *
 * Synthetic OSM-like data only: no network, and London hour and `now` are passed in.
 */

const path = require('path');

const SG_PATH = path.resolve(__dirname, '../../../../src/safety/services/safetyGraph');
const CONFIG_PATH = path.resolve(__dirname, '../../../../src/safety/scoring/config');
const safetyGraph = require(SG_PATH);
const {
  buildGraph,
  buildDistanceOnlyGraph,
  aStarDistance,
  findNearestNode,
  crimesToWeightedCounts,
  getV1Weights,
} = safetyGraph;

const LAT = 51.5;
const LNG = -0.1;
const DLNG = 0.0016; // ~111 m at this latitude

const NIGHT = { hour: 23, now: new Date('2026-10-19T22:30:00Z') }; // 23:30 London, BST

/** Same three-street network as safetyGraph.v2.test.js: street U (unmapped) is edges 3-5. */
function streetNetwork() {
  const elements = [];
  const streets = [
    { row: 0, firstId: 1, wayId: 101, tags: { highway: 'residential', maxspeed: '30 mph' }, lamps: true },
    { row: 3, firstId: 11, wayId: 102, tags: { highway: 'residential' }, lamps: false },
    { row: 6, firstId: 21, wayId: 103, tags: { highway: 'path', lit: 'no' }, lamps: false },
  ];
  const lamps = [];
  let lampId = 500;
  for (const street of streets) {
    const lat = LAT + street.row * 0.001;
    const nodeIds = [0, 1, 2, 3].map((k) => street.firstId + k);
    nodeIds.forEach((id, k) => elements.push({ type: 'node', id, lat, lon: LNG + k * DLNG }));
    elements.push({ type: 'way', id: street.wayId, nodes: nodeIds, tags: street.tags });
    if (street.lamps) {
      for (let k = 0; k <= 6; k++) {
        lamps.push({ type: 'node', id: lampId++, lat: lat + 0.00015, lon: LNG + (k * 0.5) * DLNG, tags: { highway: 'street_lamp' } });
      }
    }
  }
  return {
    roadData: { elements },
    lightData: { elements: lamps },
    bbox: { south: LAT - 0.001, north: LAT + 0.008, west: LNG - 0.001, east: LNG + 0.005 },
  };
}

/** Edge 4 is the middle edge of the unmapped street, centred at (LAT + 0.003, LNG + 1.5 * DLNG). */
const UNMAPPED_MID = { lat: LAT + 0.003, lng: LNG + 1.5 * DLNG };

/** Loads safetyGraph with a different LAMP_RADIUS_M in config, in an isolated module registry. */
function loadWithLampRadius(radius) {
  let mod;
  jest.isolateModules(() => {
    const actual = jest.requireActual(CONFIG_PATH);
    jest.doMock(CONFIG_PATH, () => ({ ...actual, LAMP_RADIUS_M: radius }));
    mod = require(SG_PATH);
  });
  jest.dontMock(CONFIG_PATH);
  return mod;
}

/** Loads safetyGraph with the opening-hours parse flag set, in an isolated module registry. */
function loadWithOpeningHoursParse() {
  const previous = process.env.SAFE_ROUTES_PARSE_PLACE_OPENING_HOURS;
  process.env.SAFE_ROUTES_PARSE_PLACE_OPENING_HOURS = '1';
  let mod;
  try {
    jest.isolateModules(() => { mod = require(SG_PATH); });
  } finally {
    if (previous === undefined) delete process.env.SAFE_ROUTES_PARSE_PLACE_OPENING_HOURS;
    else process.env.SAFE_ROUTES_PARSE_PLACE_OPENING_HOURS = previous;
  }
  return mod;
}

/** Edge 4 placeScore with one place tagged `tags` 5 m from the unmapped street's midpoint. */
async function placeScoreFor(tags, hour, now = NIGHT.now, mod = safetyGraph) {
  const net = streetNetwork();
  const place = { elements: [{ type: 'node', id: 950, lat: UNMAPPED_MID.lat + 0.00005, lon: UNMAPPED_MID.lng, tags }] };
  const graph = await mod.buildGraph(net.roadData, net.lightData, null, place, null, [], net.bbox, { level: 'extra', hour, now });
  return graph.edges[4].placeScore;
}

describe('crimesToWeightedCounts (crimeClient rows to recency input)', () => {
  test('counts whole calendar months back from the newest month in the data', () => {
    const out = crimesToWeightedCounts([
      { category: 'violent-crime', month: '2026-08' },
      { category: 'burglary', month: '2026-05' },
      { category: 'robbery', month: '2025-08' },
    ]);
    expect(out).toEqual([
      { category: 'violent-crime', monthsAgo: 0 },
      { category: 'burglary', monthsAgo: 3 },
      { category: 'robbery', monthsAgo: 12 },
    ]);
  });

  test('a single-month release is full weight whatever the clock says', () => {
    const out = crimesToWeightedCounts([{ category: 'drugs', month: '2026-08' }, { category: 'drugs', month: '2026-08' }]);
    expect(out.map((r) => r.monthsAgo)).toEqual([0, 0]);
  });

  test('a missing, empty or malformed month counts as monthsAgo 0 (never as zero harm)', () => {
    const rows = [
      { category: 'drugs' },
      { category: 'drugs', month: '' },
      { category: 'drugs', month: 'Oct-2026' },
      { category: 'drugs', month: '2026-13' },
      { category: 'drugs', month: '2026-00' },
      { category: 'drugs', month: null },
    ];
    expect(crimesToWeightedCounts(rows).map((r) => r.monthsAgo)).toEqual([0, 0, 0, 0, 0, 0]);
  });

  test('bad rows do not disturb the anchor chosen from the valid rows', () => {
    const out = crimesToWeightedCounts([{ category: 'drugs', month: '2026-06' }, { category: 'drugs' }, { category: 'drugs', month: '2026-04' }]);
    expect(out.map((r) => r.monthsAgo)).toEqual([0, 0, 2]);
  });

  test('an empty list gives an empty list', () => {
    expect(crimesToWeightedCounts([])).toEqual([]);
  });
});

describe('getV1Weights (v1 time-of-day helper, renamed from getWeights)', () => {
  test('is exported under its own name and gives the late-night v1 weights', () => {
    expect(getV1Weights(2, 'extra')).toEqual({
      roadType: 0.22, lighting: 0.28, crimeRate: 0.25, cctv: 0.08, openPlaces: 0.07, gpsTraffic: 0.10,
    });
  });

  test('the standard level drops cctv and openPlaces and rescales the rest to sum to 1', () => {
    const w = getV1Weights(12, 'standard');
    expect(w.cctv).toBe(0);
    expect(w.openPlaces).toBe(0);
    const total = Object.values(w).reduce((sum, x) => sum + x, 0);
    expect(total).toBeCloseTo(1, 9);
  });
});

describe('v2 lamp radius comes from config (LAMP_RADIUS_M)', () => {
  test('a lamp 44 m from an edge lights it only when the config radius is wider than 44 m', async () => {
    const net = streetNetwork();
    net.lightData.elements.push({ type: 'node', id: 700, lat: UNMAPPED_MID.lat + 0.0004, lon: UNMAPPED_MID.lng, tags: { highway: 'street_lamp' } });

    const narrow = await loadWithLampRadius(30).buildGraph(net.roadData, net.lightData, null, null, null, [], net.bbox, { level: 'extra', ...NIGHT });
    const wide = await loadWithLampRadius(60).buildGraph(net.roadData, net.lightData, null, null, null, [], net.bbox, { level: 'extra', ...NIGHT });

    expect(wide.edges[4].pLit).toBeGreaterThan(narrow.edges[4].pLit);
  });
});

describe('v1 crime severity comes from the category table when a crime has no severity field', () => {
  const previous = process.env.SAFETY_MODEL;
  beforeEach(() => { process.env.SAFETY_MODEL = 'v1'; });
  afterEach(() => {
    if (previous === undefined) delete process.env.SAFETY_MODEL;
    else process.env.SAFETY_MODEL = previous;
  });

  function crimeAt(category) {
    return { lat: UNMAPPED_MID.lat, lng: UNMAPPED_MID.lng, category, month: '2026-10' };
  }

  test('a violent crime weighs more than shoplifting (table severity 1.0 against 0.2, not both 0.4)', async () => {
    const net = streetNetwork();
    const violent = await buildGraph(net.roadData, net.lightData, null, null, null, [crimeAt('violent-crime')], net.bbox, { level: 'extra', ...NIGHT });
    const shop = await buildGraph(net.roadData, net.lightData, null, null, null, [crimeAt('shoplifting')], net.bbox, { level: 'extra', ...NIGHT });
    expect(violent.edges[4].crimeScore).toBeLessThan(shop.edges[4].crimeScore);
  });
});

describe('v2 crime recency is measured from the newest month in the data', () => {
  const crime = (month) => ({ lat: UNMAPPED_MID.lat, lng: UNMAPPED_MID.lng, category: 'violent-crime', month });
  const build = (crimes) => {
    const net = streetNetwork();
    return buildGraph(net.roadData, net.lightData, null, null, null, crimes, net.bbox, { level: 'extra', ...NIGHT });
  };

  test('an older crime in the same release weighs less than a crime from the newest month', async () => {
    const mixed = await build([crime('2026-08'), crime('2026-01')]);
    const bothRecent = await build([crime('2026-08'), crime('2026-08')]);
    expect(mixed.edges[4].crimeScore).toBeGreaterThan(bothRecent.edges[4].crimeScore);
  });

  test('a release that is months old is not discounted against the clock', async () => {
    const stale = await build([crime('2026-05')]);
    const fresh = await build([crime('2026-10')]);
    expect(stale.edges[4].crimeScore).toBeCloseTo(fresh.edges[4].crimeScore, 12);
  });

  test('crimes outside the bbox, or with non-finite coordinates, are ignored', async () => {
    const net = streetNetwork();
    const none = await buildGraph(net.roadData, net.lightData, null, null, null, [], net.bbox, { level: 'extra', ...NIGHT });
    const junk = [
      { lat: 10, lng: 10, category: 'violent-crime', month: '2026-10' },
      { lat: Number.NaN, lng: LNG, category: 'violent-crime', month: '2026-10' },
      { lat: LAT, lng: Number.NaN, category: 'violent-crime', month: '2026-10' },
      null,
    ];
    const withJunk = await buildGraph(net.roadData, net.lightData, null, null, null, junk, net.bbox, { level: 'extra', ...NIGHT });
    expect(withJunk.edges[4].risk).toBeCloseTo(none.edges[4].risk, 12);
  });
});

describe('opening hours on places: heuristic path (parse flag off)', () => {
  // The default module is loaded with SAFE_ROUTES_PARSE_PLACE_OPENING_HOURS unset.
  test.each([
    ['hospital at 03:00 is always open', { amenity: 'hospital' }, 3, true],
    ['pub at 09:00 is closed', { amenity: 'pub' }, 9, false],
    ['pub at 11:00 is open', { amenity: 'pub' }, 11, true],
    ['convenience shop at 05:00 is closed', { shop: 'convenience' }, 5, false],
    ['convenience shop at 10:00 is open', { shop: 'convenience' }, 10, true],
    ['supermarket at 22:00 is open (extended shops close at 23:00)', { shop: 'supermarket' }, 22, true],
    ['unlisted amenity at 08:00 is open (daytime default)', { amenity: 'bank' }, 8, true],
    ['unlisted amenity at 21:00 is closed', { amenity: 'bank' }, 21, false],
  ])('%s', async (_name, tags, hour, open) => {
    const score = await placeScoreFor(tags, hour);
    if (open) expect(score).toBeGreaterThan(0);
    else expect(score).toBe(0);
  });
});

describe('opening hours on places: parse path (SAFE_ROUTES_PARSE_PLACE_OPENING_HOURS=1)', () => {
  // 20:00 London on the same BST day as NIGHT.now.
  const EIGHT_PM = new Date('2026-10-19T19:00:00Z');
  const NOON = new Date('2026-10-19T11:00:00Z');

  test('a parsed opening_hours rule overrides the cafe heuristic: closed at 20:00 for 09:00-17:00', async () => {
    const parsed = loadWithOpeningHoursParse();
    const score = await placeScoreFor({ amenity: 'cafe', opening_hours: 'Mo-Su 09:00-17:00' }, 20, EIGHT_PM, parsed);
    expect(score).toBe(0);
  });

  test('a parsed opening_hours rule that is open at noon counts the place', async () => {
    const parsed = loadWithOpeningHoursParse();
    const score = await placeScoreFor({ amenity: 'cafe', opening_hours: 'Mo-Su 09:00-17:00' }, 12, NOON, parsed);
    expect(score).toBeGreaterThan(0);
  });

  test('PH clauses are removed before parsing, both as a separate rule and as a suffix', async () => {
    const parsed = loadWithOpeningHoursParse();
    expect(await placeScoreFor({ amenity: 'cafe', opening_hours: 'Mo-Su 09:00-17:00; PH off' }, 12, NOON, parsed)).toBeGreaterThan(0);
    expect(await placeScoreFor({ amenity: 'cafe', opening_hours: 'Mo-Su 09:00-17:00, PH off' }, 12, NOON, parsed)).toBeGreaterThan(0);
  });

  test('opening_hours that is only a PH clause leaves nothing to parse, so the heuristic decides', async () => {
    const parsed = loadWithOpeningHoursParse();
    expect(await placeScoreFor({ amenity: 'pub', opening_hours: 'PH off' }, 12, NOON, parsed)).toBeGreaterThan(0);
  });

  test('unparseable opening_hours falls back to the heuristic instead of throwing', async () => {
    const parsed = loadWithOpeningHoursParse();
    expect(await placeScoreFor({ amenity: 'pub', opening_hours: 'this is not opening hours' }, 12, NOON, parsed)).toBeGreaterThan(0);
  });
});

describe('distance-only fallback graph', () => {
  test('buildDistanceOnlyGraph keeps walkable topology with no safety fields', () => {
    const net = streetNetwork();
    const dist = buildDistanceOnlyGraph(net.roadData);
    expect(dist.edges.length).toBe(9);
    expect(dist.edges[0]).toEqual(expect.objectContaining({ from: 1, to: 2 }));
    expect(dist.edges[0]).not.toHaveProperty('risk');
    expect(dist.osmNodes.size).toBe(12);
  });

  test('buildDistanceOnlyGraph skips non-walkable ways and ways with missing nodes', () => {
    const elements = [
      { type: 'node', id: 1, lat: LAT, lon: LNG },
      { type: 'node', id: 2, lat: LAT, lon: LNG + DLNG },
      { type: 'way', id: 9, nodes: [1, 2], tags: { highway: 'motorway' } },
      { type: 'way', id: 10, nodes: [1, 99], tags: { highway: 'footway' } },
      { type: 'way', id: 11, nodes: [1, 2] },
    ];
    const dist = buildDistanceOnlyGraph({ elements });
    expect(dist.edges).toEqual([]);
  });

  test('aStarDistance finds the shortest walking path along a street and returns its length', () => {
    const net = streetNetwork();
    const dist = buildDistanceOnlyGraph(net.roadData);
    const result = aStarDistance(dist.osmNodes, dist.edges, dist.adjacency, 1, 4, 10000);
    expect(result.path).toEqual([1, 2, 3, 4]);
    expect(result.totalDist).toBeGreaterThan(300);
    expect(result.totalDist).toBeLessThan(400);
  });

  test('aStarDistance returns null for unknown nodes, unreachable targets and the cap', () => {
    const net = streetNetwork();
    const dist = buildDistanceOnlyGraph(net.roadData);
    expect(aStarDistance(dist.osmNodes, dist.edges, dist.adjacency, 1, 999, 10000)).toBeNull();
    expect(aStarDistance(dist.osmNodes, dist.edges, dist.adjacency, 1, 21, 10000)).toBeNull();
    expect(aStarDistance(dist.osmNodes, dist.edges, dist.adjacency, 1, 4, 50)).toBeNull();
  });

  test('aStarDistance from a node to itself is the single-node path of length 0', () => {
    const net = streetNetwork();
    const dist = buildDistanceOnlyGraph(net.roadData);
    expect(aStarDistance(dist.osmNodes, dist.edges, dist.adjacency, 1, 1, 10000)).toEqual({ path: [1], totalDist: 0 });
  });

  test('findNearestNode returns the closest node that is in the graph, or null when none is near', () => {
    const net = streetNetwork();
    const dist = buildDistanceOnlyGraph(net.roadData);
    expect(findNearestNode(dist.nodeGrid, dist.adjacency, LAT, LNG)).toBe(1);
    expect(findNearestNode(dist.nodeGrid, dist.adjacency, 0, 0)).toBeNull();
  });
});

describe('v2 graph branches: cancellation, clock, lit ways, cache, A* edges, empty routes', () => {
  const bbox = { south: LAT - 0.001, north: LAT + 0.008, west: LNG - 0.001, east: LNG + 0.005 };

  test('buildGraph stops with SEARCH_CANCELLED once shouldCancel says so during a large build', async () => {
    const elements = [];
    for (let i = 0; i < 3000; i++) elements.push({ type: 'node', id: i + 1, lat: LAT, lon: LNG });
    await expect(
      buildGraph({ elements }, null, null, null, null, [], bbox, { ...NIGHT, shouldCancel: () => true }),
    ).rejects.toMatchObject({ code: 'SEARCH_CANCELLED', statusCode: 409 });
  });

  test('without an explicit hour, the London hour of options.now decides opening (23:30 London closes a convenience shop)', async () => {
    const shop = { shop: 'convenience' };
    expect(await placeScoreFor(shop, undefined, NIGHT.now)).toBe(0);
    expect(await placeScoreFor(shop, undefined, new Date('2026-10-19T11:00:00Z'))).toBeGreaterThan(0);
  });

  test('a place mapped as a way uses its centre point, and an open one counts', async () => {
    const net = streetNetwork();
    const way = {
      type: 'way', id: 960, nodes: [1, 2], tags: { amenity: 'pub' },
      center: { lat: UNMAPPED_MID.lat + 0.00005, lon: UNMAPPED_MID.lng },
    };
    const graph = await buildGraph(net.roadData, net.lightData, null, { elements: [way] }, null, [], net.bbox, { level: 'extra', hour: 12, now: NIGHT.now });
    expect(graph.edges[4].placeScore).toBeGreaterThan(0);
  });

  test('transit nodes near an edge are counted, and CCTV or transit entries without coordinates are ignored', async () => {
    const net = streetNetwork();
    const transit = {
      elements: [
        { type: 'node', id: 970, lat: UNMAPPED_MID.lat + 0.0001, lon: UNMAPPED_MID.lng },
        { type: 'node', id: 971 },
      ],
    };
    const cctv = { elements: [{ type: 'way', id: 972 }, { type: 'node', id: 973 }] };
    const graph = await buildGraph(net.roadData, net.lightData, cctv, null, transit, [], net.bbox, { level: 'extra', ...NIGHT });
    expect(graph.edges[4].nearbyTransitCount).toBe(1);
    expect(graph.edges[4].nearbyCctvCount).toBe(0);
  });

  test('a lit way over the unmapped street lights its edge, and unknown node ids in the way are skipped', async () => {
    const net = streetNetwork();
    const none = await buildStreetsWith(net, null);
    // A node at the edge midpoint (on no walkable way) puts a lit-way node within 30 m of the edge.
    net.roadData.elements.push({ type: 'node', id: 15, lat: UNMAPPED_MID.lat, lon: UNMAPPED_MID.lng });
    net.lightData.elements.push({ type: 'way', id: 300, nodes: [15, 99999], tags: { lit: 'yes' } });
    const lit = await buildStreetsWith(net, null);
    expect(lit.edges[4].pLit).toBeGreaterThan(none.edges[4].pLit);
  });

  test('a verified-lit cache entry gives pLit 0.95 with a cache source, and an unverified entry still feeds the estimate', async () => {
    const net = streetNetwork();
    const verified = await buildGraph(net.roadData, net.lightData, null, null, null, [], net.bbox, {
      level: 'extra', ...NIGHT, lightsCacheByEdgeIdx: new Map([[4, { lit_status: 'lit', confidence: 0.9 }]]),
    });
    expect(verified.edges[4].pLit).toBeCloseTo(0.95, 6);
    expect(verified.edges[4].litEstimate).toBe('estimated_lit');

    const weak = await buildGraph(net.roadData, net.lightData, null, null, null, [], net.bbox, {
      level: 'extra', ...NIGHT, lightsCacheByEdgeIdx: new Map([[4, { lit_status: 'unlit', confidence: 0.5 }]]),
    });
    expect(Number.isFinite(weak.edges[4].pLit)).toBe(true);
  });

  test('aStarSafety returns null for an absent start or end, and for an unreachable end', () => {
    const osmNodes = new Map([[1, { lat: LAT, lng: LNG }], [2, { lat: LAT, lng: LNG + DLNG }]]);
    const adjacency = new Map([[1, []], [2, []]]);
    expect(safetyGraph.aStarSafety(osmNodes, [], new Map(), 1, 2, 1000)).toBeNull();
    expect(safetyGraph.aStarSafety(new Map([[1, osmNodes.get(1)]]), [], adjacency, 1, 2, 1000)).toBeNull();
    expect(safetyGraph.aStarSafety(new Map([[2, osmNodes.get(2)]]), [], adjacency, 1, 2, 1000)).toBeNull();
    expect(safetyGraph.aStarSafety(osmNodes, [], adjacency, 1, 2, 1000)).toBeNull();
  });

  test('routeToPolyline skips path nodes that are not in osmNodes', () => {
    const osmNodes = new Map([[1, { lat: LAT, lng: LNG }], [2, { lat: LAT, lng: LNG + DLNG }]]);
    expect(safetyGraph.routeToPolyline(osmNodes, [1, 99, 2])).toEqual([
      { lat: LAT, lng: LNG }, { lat: LAT, lng: LNG + DLNG },
    ]);
  });

  test('a zero-length v2 breakdown is all zeros', async () => {
    const graph = await buildStreetsWith(streetNetwork(), null);
    const breakdown = safetyGraph.routeSafetyBreakdown(graph.edges, [], graph.weights, []);
    expect(breakdown.overall).toBe(0);
    expect(breakdown.routeRisk).toBe(0);
  });

  test('a route from a node to itself is a single zero-length, unexcluded route', async () => {
    const net = streetNetwork();
    const graph = await buildGraph(net.roadData, net.lightData, null, null, null, [], net.bbox, { level: 'extra', ...NIGHT });
    const routes = safetyGraph.findKSafestRoutes(graph.osmNodes, graph.edges, graph.adjacency, 1, 1, 1000, 5, {});
    expect(routes.length).toBeGreaterThan(0);
    for (const route of routes) {
      expect(route).toMatchObject({ edges: [], lengthM: 0, excluded: false });
    }
  });
});

/** Builds the streetNetwork graph with the given crimes (or none), at NIGHT. */
function buildStreetsWith(net, crimes) {
  return buildGraph(net.roadData, net.lightData, null, null, null, crimes || [], net.bbox, { level: 'extra', ...NIGHT });
}

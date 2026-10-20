/**
 * Golden scenarios for the v2 safety graph (buildGraph, findKSafestRoutes, routeSafetyBreakdown) and the
 * response formatter. Every scenario is synthetic and deterministic: fixed instants, explicit London hour,
 * explicit crimeStatus and a seeded generator. computeGolden() returns a JSON-safe snapshot in which every
 * number is rounded to 12 decimals, so a refactor can be proved number-for-number identical.
 *
 * Regenerate (only for an intentional model change) with: node tests/unit/safety/services/__golden__/generate.js
 */

const path = require('path');
const crypto = require('crypto');

const SRC = path.resolve(__dirname, '../../../../../src/safety');
const graphApi = require(path.join(SRC, 'services/safetyGraph'));
const { buildRouteResponses } = require(path.join(SRC, 'routes/safeRoutesResponseFormatter'));
const fixtures = require(path.resolve(__dirname, '../../scoring/fixtures/calibrationScenes'));

const { findKSafestRoutes, routeSafetyBreakdown } = graphApi;

// The settlement class is injected (Plymouth and London scenes are 'city'), so the snapshot never depends on the
// shipped gazetteer file. Scenarios may override it through options.settlementClassAt.
const buildGraph = (road, light, cctv, places, transit, crimes, bbox, options = {}) => graphApi.buildGraph(
  road, light, cctv, places, transit, crimes, bbox, { settlementClassAt: fixtures.CITY, ...options },
);

// Compact snapshots keep hashes of the big arrays plus the per-edge risks. Set DETAIL (GOLDEN_DETAIL=1) to
// include every edge and the whole formatter payload, for diffing a failing refactor against a saved baseline.
const DETAIL = process.env.GOLDEN_DETAIL === '1';
const edgeDump = (edges) => (DETAIL ? { edges: norm(edges) } : { risks: norm(edges.map((e) => e.risk)) });

const NIGHT = { hour: 23, now: new Date('2026-10-19T22:30:00Z') };
const DAY = { hour: 12, now: new Date('2026-06-21T11:00:00Z') };

// ── normalisation ──────────────────────────────────────────────────────────

/** JSON-safe copy: Maps and Sets become sorted arrays, numbers are rounded to 12 decimals. */
function norm(value) {
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return 'NaN';
    if (!Number.isFinite(value)) return value > 0 ? 'Infinity' : '-Infinity';
    return Number(value.toFixed(12));
  }
  if (value instanceof Map) {
    return [...value.entries()].map(([k, v]) => [norm(k), norm(v)])
      .sort((a, b) => JSON.stringify(a[0]).localeCompare(JSON.stringify(b[0])));
  }
  if (value instanceof Set) return [...value].map(norm).sort();
  if (Array.isArray(value)) return value.map(norm);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined && typeof value[key] !== 'function') out[key] = norm(value[key]);
    }
    return out;
  }
  return value;
}

const hashOf = (value) => crypto.createHash('sha256').update(JSON.stringify(norm(value))).digest('hex');

/** Full graph summary: edges (hash plus the first few in full), weights, darkness, node and adjacency hashes. */
function graphSummary(graph) {
  return {
    edgeCount: graph.edges.length,
    edgesHash: hashOf(graph.edges),
    firstEdges: norm(graph.edges.slice(0, 3)),
    weights: norm(graph.weights),
    darkness: norm(graph.darkness),
    osmNodesHash: hashOf(graph.osmNodes),
    adjacencyHash: hashOf(graph.adjacency),
    nodeDegreeHash: hashOf(graph.nodeDegree),
    cctvNodesHash: hashOf(graph.cctvNodes),
    transitNodesHash: hashOf(graph.transitNodes),
  };
}

const routeSummary = (route) => norm({ ...route });

// ── scenario: three streets (safetyGraph.model.test.js) ───────────────────────

const LAT = 51.5;
const LNG = -0.1;
const DLNG = 0.0016;

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

async function streetScenarios() {
  const out = {};
  const crimeAt = (category, month, dLat = 0) => ({ lat: LAT + 0.003 + dLat, lng: LNG + 1.5 * DLNG, category, month });
  const crimes = [
    crimeAt('violent-crime', '2026-08'), crimeAt('shoplifting', '2026-05'), crimeAt('burglary', '2025-12'),
    crimeAt('robbery', '2026-08', 0.0002), { lat: 10, lng: 10, category: 'robbery', month: '2026-08' }, null,
    { lat: LAT + 0.0005, lng: LNG + 0.001, category: 'drugs' },
  ];
  const shop = { type: 'node', id: 900, lat: LAT + 0.003 + 0.00005, lon: LNG + 1.5 * DLNG, tags: { shop: 'convenience' } };
  const pub = { type: 'node', id: 901, lat: LAT + 0.0001, lon: LNG + 0.5 * DLNG, tags: { amenity: 'pub' } };
  const cctv = { elements: [{ type: 'node', id: 902, lat: LAT + 0.002, lon: LNG + 0.001 }] };
  const transit = { elements: [{ type: 'node', id: 903, lat: LAT + 0.003, lon: LNG + 1.5 * DLNG }] };
  const cases = {
    nightOk: [null, null, null, [], { ...NIGHT, crimeStatus: 'ok' }],
    nightDown: [null, null, null, [], { ...NIGHT, crimeStatus: 'unavailable' }],
    day: [null, null, null, [], { ...DAY, crimeStatus: 'ok' }],
    standardLevel: [cctv, null, null, [], { ...NIGHT, level: 'standard', crimeStatus: 'ok' }],
    crimes: [null, null, null, crimes, { ...NIGHT, crimeStatus: 'ok' }],
    activityNight: [cctv, { elements: [shop, pub] }, transit, crimes, { ...NIGHT, crimeStatus: 'ok' }],
    activityNoon: [cctv, { elements: [shop, pub] }, transit, crimes, { hour: 12, now: NIGHT.now, crimeStatus: 'ok' }],
    cacheUnlit: [null, null, null, [], {
      ...NIGHT, crimeStatus: 'ok', lightsCacheByEdgeIdx: new Map([[1, { lit_status: 'unlit', confidence: 0.9 }], [4, { lit_status: 'lit', confidence: 0.9 }], [7, { lit_status: 'unlit', confidence: 0.5 }]]),
    }],
  };
  for (const [name, [cctvData, placeData, transitData, crimeRows, options]] of Object.entries(cases)) {
    const net = streetNetwork();
    const graph = await buildGraph(net.roadData, net.lightData, cctvData, placeData, transitData, crimeRows, net.bbox, { level: 'extra', ...options });
    out[name] = { summary: graphSummary(graph), ...edgeDump(graph.edges) };
  }
  // Routes along one street and the breakdown of each.
  const net = streetNetwork();
  const graph = await buildGraph(net.roadData, net.lightData, null, null, null, crimes, net.bbox, { level: 'extra', ...NIGHT, crimeStatus: 'ok' });
  const routes = findKSafestRoutes(graph.osmNodes, graph.edges, graph.adjacency, 11, 14, 2000, 5, {});
  out.routes = {
    list: routes.map(routeSummary),
    breakdowns: routes.map((r) => norm(routeSafetyBreakdown(graph.edges, r.edges))),
    self: findKSafestRoutes(graph.osmNodes, graph.edges, graph.adjacency, 1, 1, 1000, 5, {}).map(routeSummary),
    empty: norm(routeSafetyBreakdown(graph.edges, [])),
  };
  return out;
}

// ── scenario: lighting features (safetyGraph.lightingFeatures.test.js) ─────

const LAT0 = 50.3745;
const LNG0 = -4.1385;
const M_LAT = 1 / 111320;
const M_LNG = 1 / (111320 * Math.cos(LAT0 * Math.PI / 180));

function lightScene({ ways, lamps = [], litWayNames = [] }) {
  const nodes = new Map();
  let nextId = 1;
  const idOf = ([e, n]) => {
    const key = `${e},${n}`;
    if (!nodes.has(key)) nodes.set(key, { id: nextId++, e, n });
    return nodes.get(key).id;
  };
  const wayEls = ways.map((w, i) => ({ type: 'way', id: 100 + i, nodes: w.points.map(idOf), tags: { ...w.tags, name: w.name } }));
  const nodeEls = [...nodes.values()].map(({ id, e, n }) => ({ type: 'node', id, lat: LAT0 + n * M_LAT, lon: LNG0 + e * M_LNG }));
  const lightEls = lamps.map(([e, n]) => ({ type: 'node', lat: LAT0 + n * M_LAT, lon: LNG0 + e * M_LNG, tags: { highway: 'street_lamp' } }));
  wayEls.filter((w) => litWayNames.includes(w.tags.name)).forEach((w) => lightEls.push({ type: 'way', id: w.id, nodes: w.nodes, tags: { lit: 'yes' } }));
  return { roadData: { elements: [...nodeEls, ...wayEls] }, lightData: { elements: lightEls }, bbox: { south: LAT0 - 0.01, north: LAT0 + 0.01, west: LNG0 - 0.01, east: LNG0 + 0.01 } };
}

async function lightingScenarios() {
  const road = (name, y, tags = { highway: 'residential' }) => ({ name, tags, points: [[0, y], [200, y]] });
  const farLamps = Array.from({ length: 12 }, (_, i) => [i * 15, 160]);
  const classes = ['trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service'];
  const classWays = [];
  classes.forEach((highway, i) => {
    classWays.push({ name: `r${i}`, tags: { highway }, points: [[0, i * 200], [100, i * 200]] });
    classWays.push({ name: `f${i}`, tags: { highway: 'footway' }, points: [[0, i * 200 + 10], [100, i * 200 + 10]] });
  });
  const lane = { name: 'lane', tags: { highway: 'service' }, points: [[0, 0], [200, 0]] };
  const litNext = { name: 'litnext', tags: { highway: 'residential', lit: 'yes' }, points: [[100, 20], [300, 20]] };
  const scenes = {
    sidewalk: { ways: [road('main', 0), road('walk', 10, { highway: 'footway' })] },
    sidewalkLamp: { ways: [road('main', 0), road('walk', 10, { highway: 'footway' })], lamps: [[100, 50]] },
    isolated: { ways: [road('main', 0), road('park', 100, { highway: 'footway' })] },
    isolatedLamp: { ways: [road('main', 0), road('park', 100, { highway: 'footway' })], lamps: [[100, 140]] },
    boundary: { ways: [road('main', 0), road('near', 20, { highway: 'cycleway' }), road('far', -30, { highway: 'steps' })] },
    footwayOnly: { ways: [road('a', 0, { highway: 'footway' }), road('b', 8, { highway: 'path' }), road('c', 16, { highway: 'footway' })] },
    classes: { ways: classWays },
    trail: { ways: [road('main', 0), road('trail', 10, { highway: 'path' })] },
    absence: { ways: [road('park', 0, { highway: 'footway' }), road('park2', 60, { highway: 'footway' }), road('park3', 120, { highway: 'footway' })], lamps: farLamps },
    absenceRoad: { ways: [road('res', 0), road('res2', 60), road('res3', 120)], lamps: farLamps },
    neighbour: { ways: [lane, litNext], litWayNames: ['litnext'] },
    lamp: { ways: [lane], lamps: [[100, 5]] },
    farNeighbour: { ways: [lane, { ...litNext, points: [[100, 90], [300, 90]] }], litWayNames: ['litnext'] },
  };
  const out = {};
  for (const [name, spec] of Object.entries(scenes)) {
    const s = lightScene(spec);
    const graph = await buildGraph(s.roadData, s.lightData, null, null, null, [], s.bbox, { level: 'extra', ...NIGHT, crimeStatus: 'ok' });
    out[name] = { summary: graphSummary(graph), ...edgeDump(graph.edges) };
  }
  return out;
}

// ── scenario: calibration scenes ───────────────────────────────────────────

async function calibrationScenarios() {
  const out = { archetypes: {}, routes: {} };
  const build = (scene, options) => buildGraph(scene.roadData, scene.lightData, scene.cctvData, scene.placeData,
    scene.transitData, scene.crimes, scene.bbox, { level: 'extra', crimeStatus: 'ok', ...options });
  for (const letter of Object.keys(fixtures.ARCHETYPES)) {
    const graph = await build(fixtures.ARCHETYPES[letter](), { ...fixtures.NIGHT, ...(fixtures.ARCHETYPE_OPTIONS[letter] || {}) });
    const target = graph.edges.find((e) => e.roadName === 'target');
    out.archetypes[letter] = { summary: graphSummary(graph), target: norm(target), score: Math.round(100 * (1 - target.risk)) };
  }
  const aDay = await build(fixtures.ARCHETYPES.A(), fixtures.DAY);
  out.archetypes.A_day = { summary: graphSummary(aDay), target: norm(aDay.edges.find((e) => e.roadName === 'target')) };
  const aDown = await build(fixtures.ARCHETYPES.A(), { ...fixtures.NIGHT, crimeStatus: 'unavailable' });
  out.archetypes.A_down = { summary: graphSummary(aDown), target: norm(aDown.edges.find((e) => e.roadName === 'target')) };
  for (const name of Object.keys(fixtures.ROUTES)) {
    const graph = await build(fixtures.ROUTES[name](), fixtures.NIGHT);
    const idxs = fixtures.routeEdgeIdxs(graph);
    out.routes[name] = { summary: graphSummary(graph), breakdown: norm(routeSafetyBreakdown(graph.edges, idxs)) };
  }
  return out;
}

// ── scenario: 10x10 grid with mixed ways, K routes, formatter ──────────────

function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function gridNetwork() {
  const rnd = seeded(20261019);
  const N = 10;
  const STEP = 0.0008;
  const LAT_G = 50.372;
  const LNG_G = -4.145;
  const id = (r, c) => r * N + c + 1;
  const nodes = [];
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) nodes.push({ type: 'node', id: id(r, c), lat: LAT_G + r * STEP, lon: LNG_G + c * STEP * 1.6 });
  const rowTags = [
    { highway: 'residential', maxspeed: '30 mph', sidewalk: 'both' },
    { highway: 'residential', surface: 'gravel' },
    { highway: 'tertiary', lit: 'yes', sidewalk: 'both' },
    { highway: 'footway', surface: 'dirt' },
    { highway: 'service', tunnel: 'yes', lit: 'yes' },
  ];
  const colTags = [
    { highway: 'residential', name: 'Col Road' },
    { highway: 'path' },
    { highway: 'secondary', maxspeed: '60 mph' },
    { highway: 'residential', lit: 'no' },
  ];
  const ways = [];
  for (let r = 0; r < N; r++) {
    ways.push({ type: 'way', id: 1000 + r, nodes: Array.from({ length: N }, (_, c) => id(r, c)), tags: { ...rowTags[r % rowTags.length], name: `Row ${r}` } });
  }
  for (let c = 0; c < N; c++) {
    ways.push({ type: 'way', id: 2000 + c, nodes: Array.from({ length: N }, (_, r) => id(r, c)), tags: colTags[c % colTags.length] });
  }
  // A motorway through the middle (not walkable; contributes node degree) and a way with an unknown node.
  nodes.push({ type: 'node', id: 900, lat: LAT_G + 4.5 * STEP, lon: LNG_G + 3 * STEP * 1.6 });
  ways.push({ type: 'way', id: 3000, nodes: [id(4, 3), 900, id(5, 3)], tags: { highway: 'motorway' } });
  ways.push({ type: 'way', id: 3001, nodes: [id(0, 0), 424242], tags: { highway: 'footway' } });
  const at = () => ({ lat: LAT_G + rnd() * (N - 1) * STEP, lon: LNG_G + rnd() * (N - 1) * STEP * 1.6 });
  const lamps = Array.from({ length: 70 }, () => ({ type: 'node', ...at(), tags: { highway: 'street_lamp' } }));
  lamps.push({ type: 'way', id: 4000, nodes: [id(2, 0), id(2, 1), id(2, 2)], tags: { lit: 'yes' } });
  const placeKinds = [{ amenity: 'hospital' }, { amenity: 'pub' }, { shop: 'convenience' }, { amenity: 'pharmacy' }, { amenity: 'bank' }];
  const places = Array.from({ length: 25 }, (_, i) => ({ type: 'node', id: 5000 + i, ...at(), tags: placeKinds[i % placeKinds.length] }));
  const cctv = Array.from({ length: 6 }, () => ({ type: 'node', ...at() }));
  const transit = Array.from({ length: 5 }, () => ({ type: 'node', ...at() }));
  const categories = ['violent-crime', 'robbery', 'burglary', 'shoplifting', 'drugs', 'anti-social-behaviour'];
  const months = ['2026-01', '2026-03', '2026-05', '2026-07', '2026-08', '2026-09'];
  const crimes = Array.from({ length: 80 }, (_, i) => ({ ...(({ lat, lon }) => ({ lat, lng: lon }))(at()), category: categories[i % categories.length], month: months[i % months.length] }));
  return {
    id,
    roadData: { elements: [...nodes, ...ways] },
    lightData: { elements: lamps },
    cctvData: { elements: cctv },
    placeData: { elements: places },
    transitData: { elements: transit },
    crimes,
    bbox: { south: LAT_G - 0.0005, north: LAT_G + (N - 1) * STEP + 0.0005, west: LNG_G - 0.0005, east: LNG_G + (N - 1) * STEP * 1.6 + 0.0005 },
  };
}

async function gridScenarios() {
  const g = gridNetwork();
  const out = {};
  const build = (options) => buildGraph(g.roadData, g.lightData, g.cctvData, g.placeData, g.transitData, g.crimes, g.bbox, { level: 'extra', ...options });
  const variants = {
    nightOk: { ...NIGHT, crimeStatus: 'ok' },
    nightDown: { ...NIGHT, crimeStatus: 'unavailable' },
    noon: { ...DAY, crimeStatus: 'ok' },
    standard: { ...NIGHT, level: 'standard', crimeStatus: 'ok' },
    cached: { ...NIGHT, crimeStatus: 'ok', lightsCacheByEdgeIdx: new Map([[10, { lit_status: 'unlit', confidence: 0.9 }], [20, { lit_status: 'lit', confidence: 0.85 }], [30, { lit_status: 'lit', confidence: 0.4 }]]) },
  };
  const graphs = {};
  for (const [name, options] of Object.entries(variants)) {
    graphs[name] = await build(options);
    out[name] = { summary: graphSummary(graphs[name]), ...edgeDump(graphs[name].edges) };
  }

  const graph = graphs.nightOk;
  const start = g.id(0, 0);
  const end = g.id(9, 9);
  const maxDist = 2300;
  const routes = findKSafestRoutes(graph.osmNodes, graph.edges, graph.adjacency, start, end, maxDist, 5, {});
  const routesHazards = findKSafestRoutes(graph.osmNodes, graph.edges, graph.adjacency, start, end, maxDist, 3, { allowHazards: true });
  const mid = findKSafestRoutes(graph.osmNodes, graph.edges, graph.adjacency, g.id(2, 1), g.id(7, 8), maxDist, 4, {});
  const single = routes.length > 0 ? routes[0] : null;
  out.routes = {
    count: routes.length,
    list: routes.map(routeSummary),
    hazards: routesHazards.map(routeSummary),
    mid: mid.map(routeSummary),
    breakdowns: routes.map((r) => norm(routeSafetyBreakdown(graph.edges, r.edges))),
    aStar: norm(graphApi.aStarSafety(graph.osmNodes, graph.edges, graph.adjacency, start, end, maxDist, {})),
    aStarUnreachable: graphApi.aStarSafety(graph.osmNodes, graph.edges, graph.adjacency, start, 999999, maxDist, {}),
    polyline: single ? norm(graphApi.routeToPolyline(graph.osmNodes, single.path)) : null,
    penaltiesCleared: graph.edges.every((e) => e.penalty === 0),
  };

  // Distance-only graph and queries.
  const dist = graphApi.buildDistanceOnlyGraph(g.roadData);
  out.distanceOnly = {
    edgeCount: dist.edges.length,
    edgesHash: hashOf(dist.edges),
    nearest: graphApi.findNearestNode(dist.nodeGrid, dist.adjacency, 50.3725, -4.1445),
    nearestFar: graphApi.findNearestNode(dist.nodeGrid, dist.adjacency, 0, 0),
    path: norm(graphApi.aStarDistance(dist.osmNodes, dist.edges, dist.adjacency, start, end, 5000)),
    capped: graphApi.aStarDistance(dist.osmNodes, dist.edges, dist.adjacency, start, end, 100),
  };

  // Formatter: full and compact payloads, with crimes in the response.
  const hospitals = { elements: g.placeData.elements.filter((el) => el.tags.amenity === 'hospital' || el.tags.amenity === 'pharmacy') };
  const formatterArgs = (responsePolicy, crimeStatus) => ({
    rawRoutes: routes.map((r) => ({ ...r })),
    osmNodes: graph.osmNodes,
    edges: graph.edges,
    cctvNodes: graph.cctvNodes,
    transitNodes: graph.transitNodes,
    nodeDegree: graph.nodeDegree,
    crimes: g.crimes,
    allData: { lights: g.lightData, places: hospitals },
    oLat: 50.372, oLng: -4.145, dLat: 50.3792, dLng: -4.1335,
    enableOpeningHoursParse: false,
    responsePolicy,
    edgeConfidences: null,
    straightLineDist: 1150,
    verificationFootprints: [],
    crimeStatus,
  });
  const full = buildRouteResponses(formatterArgs(undefined, 'ok'));
  const compact = buildRouteResponses(formatterArgs({ verbosity: 'compact', poiCaps: { crimes: 5, lights: 10 } }, 'ok'));
  const down = buildRouteResponses(formatterArgs({ verbosity: 'full' }, 'unavailable'));
  out.formatter = {
    fullHash: hashOf(full),
    compactHash: hashOf(compact),
    downHash: hashOf(down),
    fullSafety: norm(full.map((r) => r.safety)),
    compactSafety: norm(compact.map((r) => r.safety)),
    downDataQuality: down.map((r) => r.safety.dataQuality),
    segmentColors: full.map((r) => r.segments.map((seg) => seg.color)),
    crimeMarkers: norm(full.map((r) => r.routePOIs.crimes)),
    routeStats: norm(full.map((r) => r.routeStats)),
    ...(DETAIL ? { full: norm(full), compact: norm(compact), down: norm(down) } : {}),
  };
  return out;
}

async function computeGolden() {
  return {
    streets: await streetScenarios(),
    lighting: await lightingScenarios(),
    calibration: await calibrationScenarios(),
    grid: await gridScenarios(),
  };
}

module.exports = { computeGolden, norm, hashOf };

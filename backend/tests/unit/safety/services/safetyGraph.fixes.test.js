/**
 * Correctness fixes in the safety graph (final review round 1): C1 large crime lists, C2 shared A* budget,
 * C3 cancellable phase-1 search, C4 zero-length edges, C5 fail-closed crime status.
 * Synthetic data only: no network, no clock.
 */
const path = require('path');
const {
  buildGraph,
  buildDistanceOnlyGraph,
  aStarDistance,
  aStarSafety,
  findKSafestRoutes,
  crimesToWeightedCounts,
} = require(path.resolve(__dirname, '../../../../src/safety/services/safetyGraph'));
const { buildRouteResponses } = require(path.resolve(__dirname, '../../../../src/safety/routes/safeRoutesResponseFormatter'));

const LAT = 51.5;
const LNG = -0.1;
const DLNG = 0.0016; // ~111 m
const NIGHT = { hour: 23, now: new Date('2026-10-19T22:30:00Z') };

/** A single three-edge residential street, nodes 1-4. */
function street() {
  const elements = [0, 1, 2, 3].map((k) => ({ type: 'node', id: k + 1, lat: LAT, lon: LNG + k * DLNG }));
  elements.push({ type: 'way', id: 10, nodes: [1, 2, 3, 4], tags: { highway: 'residential', maxspeed: '30 mph' } });
  return { roadData: { elements }, bbox: { south: LAT - 0.001, north: LAT + 0.001, west: LNG - 0.001, east: LNG + 0.006 } };
}

/** Square grid of side n (every node joined to its right and down neighbours) in the A* guard-test shape. */
function gridGraph(n) {
  const osmNodes = new Map();
  const edges = [];
  const adjacency = new Map();
  const id = (r, c) => r * n + c;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      osmNodes.set(id(r, c), { lat: LAT + r * 0.001, lng: LNG + c * 0.001 });
      adjacency.set(id(r, c), []);
    }
  }
  const link = (a, b) => {
    const idx = edges.length;
    edges.push({
      idx, distance: 111, safetyScore: 0.8, penalty: 0, hasSidewalk: true, isTunnel: false, isLit: true,
      risk: 0.2, certainty: 0.8, cause: 'road', start: { lat: LAT, lng: LNG }, end: { lat: LAT, lng: LNG },
    });
    adjacency.get(a).push({ edgeIdx: idx, neighborId: b });
    adjacency.get(b).push({ edgeIdx: idx, neighborId: a });
  };
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (c + 1 < n) link(id(r, c), id(r, c + 1));
      if (r + 1 < n) link(id(r, c), id(r + 1, c));
    }
  }
  osmNodes.set(99999, { lat: LAT + 0.5, lng: LNG + 0.5 });
  adjacency.set(99999, []);
  return { osmNodes, edges, adjacency, id };
}

describe('C1: very large crime lists', () => {
  test('crimesToWeightedCounts handles 200,000 rows (no RangeError from Math.max spread)', () => {
    const rows = Array.from({ length: 200_000 }, (_, i) => ({ category: 'drugs', month: i % 2 === 0 ? '2026-08' : '2026-02' }));
    const out = crimesToWeightedCounts(rows);
    expect(out).toHaveLength(200_000);
    expect(out[0].monthsAgo).toBe(0);
    expect(out[1].monthsAgo).toBe(6);
  });

  test('buildGraph accepts 200,000 crimes inside the bbox', async () => {
    const net = street();
    const crimes = Array.from({ length: 200_000 }, () => ({ lat: LAT, lng: LNG + 1.5 * DLNG, category: 'burglary', month: '2026-08' }));
    const graph = await buildGraph(net.roadData, null, null, null, null, crimes, net.bbox, { ...NIGHT, crimeStatus: 'ok' });
    expect(graph.edges).toHaveLength(3);
    for (const edge of graph.edges) expect(Number.isFinite(edge.risk)).toBe(true);
  });

  test('a list with no usable month still anchors every row at full weight', () => {
    expect(crimesToWeightedCounts([{ category: 'a' }, { category: 'b', month: 'x' }]).map((r) => r.monthsAgo)).toEqual([0, 0]);
  });
});

describe('C2: the shared A* budget returns the routes found so far', () => {
  test('a later candidate search that runs out of budget does not fail the request once a route exists', () => {
    const g = gridGraph(20);
    const start = g.id(0, 0);
    const end = g.id(19, 19);
    const probe = { maxExpansions: Infinity, shouldCancel: null, pops: 0, expansions: 0 };
    expect(aStarSafety(g.osmNodes, g.edges, g.adjacency, start, end, 1e9, { budget: probe })).not.toBeNull();

    const routes = findKSafestRoutes(g.osmNodes, g.edges, g.adjacency, start, end, 1e9, 3, { maxExpansions: probe.expansions + 5 });

    expect(routes).toHaveLength(1);
    expect(routes[0].path[0]).toBe(start);
    expect(routes[0].path[routes[0].path.length - 1]).toBe(end);
    expect(g.edges.every((e) => e.penalty === 0)).toBe(true);
  });

  test('still throws NO_ROUTE_FOUND when the budget runs out before any route is found', () => {
    const g = gridGraph(20);
    expect(() => findKSafestRoutes(g.osmNodes, g.edges, g.adjacency, g.id(0, 0), g.id(19, 19), 1e9, 3, { maxExpansions: 10 }))
      .toThrow(expect.objectContaining({ code: 'NO_ROUTE_FOUND', statusCode: 404 }));
  });

  test('cancellation is never swallowed by the budget handling', () => {
    const g = gridGraph(60);
    let calls = 0;
    expect(() => findKSafestRoutes(g.osmNodes, g.edges, g.adjacency, g.id(0, 0), g.id(59, 59), 1e9, 3, {
      shouldCancel: () => { calls += 1; return calls >= 3; },
    })).toThrow(expect.objectContaining({ code: 'SEARCH_CANCELLED' }));
  });
});

describe('C3: aStarDistance checks for cancellation every 1024 pops', () => {
  test('stops with SEARCH_CANCELLED at the second checkpoint', () => {
    const g = gridGraph(60);
    let checks = 0;
    const shouldCancel = () => { checks += 1; return checks >= 2; };
    expect(() => aStarDistance(g.osmNodes, g.edges, g.adjacency, g.id(0, 0), 99999, 1e9, { shouldCancel }))
      .toThrow(expect.objectContaining({ code: 'SEARCH_CANCELLED', statusCode: 409 }));
    expect(checks).toBe(2);
  });

  test('a search that ends before the first checkpoint never calls shouldCancel, and options are optional', () => {
    const g = gridGraph(4);
    const shouldCancel = jest.fn(() => false);
    expect(aStarDistance(g.osmNodes, g.edges, g.adjacency, g.id(0, 0), g.id(3, 3), 1e9, { shouldCancel })).not.toBeNull();
    expect(shouldCancel).not.toHaveBeenCalled();
    expect(aStarDistance(g.osmNodes, g.edges, g.adjacency, g.id(0, 0), g.id(3, 3), 1e9)).not.toBeNull();
  });
});

describe('C4: zero-length edges are kept, not dropped', () => {
  // Way A: 1 - 2 - 3 where nodes 2 and 3 share coordinates; way B continues 3 - 4. Dropping the 2-3 edge
  // would split the network into {1, 2} and {3, 4}.
  function duplicateNodeNetwork() {
    const elements = [
      { type: 'node', id: 1, lat: LAT, lon: LNG },
      { type: 'node', id: 2, lat: LAT, lon: LNG + DLNG },
      { type: 'node', id: 3, lat: LAT, lon: LNG + DLNG },
      { type: 'node', id: 4, lat: LAT, lon: LNG + 2 * DLNG },
      { type: 'way', id: 10, nodes: [1, 2, 3], tags: { highway: 'residential' } },
      { type: 'way', id: 11, nodes: [3, 4], tags: { highway: 'residential' } },
    ];
    return { roadData: { elements }, bbox: { south: LAT - 0.001, north: LAT + 0.001, west: LNG - 0.001, east: LNG + 0.004 } };
  }

  test('buildGraph keeps a 0.5 m edge between nodes at identical coordinates, so a route exists', async () => {
    const net = duplicateNodeNetwork();
    const graph = await buildGraph(net.roadData, null, null, null, null, [], net.bbox, { ...NIGHT, crimeStatus: 'ok' });
    expect(graph.edges).toHaveLength(3);
    expect(graph.edges[1].distance).toBe(0.5);
    expect(graph.edges[1].lengthM).toBe(0.5);

    const routes = findKSafestRoutes(graph.osmNodes, graph.edges, graph.adjacency, 1, 4, 1000, 3, {});
    expect(routes).toHaveLength(1);
    expect(routes[0].path).toEqual([1, 2, 3, 4]);
    expect(routes[0].totalDist).toBeCloseTo(graph.edges[0].distance + 0.5 + graph.edges[2].distance, 9);
  });

  test('the distance-only graph keeps it too, so the phase-1 corridor search connects', () => {
    const net = duplicateNodeNetwork();
    const dist = buildDistanceOnlyGraph(net.roadData);
    expect(dist.edges).toHaveLength(3);
    expect(dist.edges[1].distance).toBe(0.5);
    expect(aStarDistance(dist.osmNodes, dist.edges, dist.adjacency, 1, 4, 1000).path).toEqual([1, 2, 3, 4]);
  });

  test('an edge between 0.5 m and the next node is unchanged (only shorter edges are raised to 0.5 m)', async () => {
    const elements = [
      { type: 'node', id: 1, lat: LAT, lon: LNG },
      { type: 'node', id: 2, lat: LAT, lon: LNG + 0.00002 }, // ~1.4 m
      { type: 'way', id: 10, nodes: [1, 2], tags: { highway: 'residential' } },
    ];
    const graph = await buildGraph({ elements }, null, null, null, null, [], { south: LAT - 0.001, north: LAT + 0.001, west: LNG - 0.001, east: LNG + 0.001 }, { ...NIGHT, crimeStatus: 'ok' });
    expect(graph.edges[0].distance).toBeGreaterThan(1);
    expect(graph.edges[0].distance).toBeLessThan(2);
  });
});

describe('C5: a missing crimeStatus fails closed', () => {
  test('buildGraph without crimeStatus equals crimeStatus unavailable, which is riskier than ok on a street with no crime', async () => {
    const net = street();
    const build = (extra) => buildGraph(net.roadData, null, null, null, null, [], net.bbox, { ...NIGHT, ...extra });
    const missing = await build({});
    const down = await build({ crimeStatus: 'unavailable' });
    const ok = await build({ crimeStatus: 'ok' });
    expect(missing.edges.map((e) => e.risk)).toEqual(down.edges.map((e) => e.risk));
    expect(missing.edges.map((e) => e.crimeScore)).toEqual(down.edges.map((e) => e.crimeScore));
    expect(missing.edges[1].risk).toBeGreaterThan(ok.edges[1].risk);
  });

  test('an unrecognised crimeStatus value is an outage too', async () => {
    const net = street();
    const build = (crimeStatus) => buildGraph(net.roadData, null, null, null, null, [], net.bbox, { ...NIGHT, crimeStatus });
    const odd = await build('maybe');
    const down = await build('unavailable');
    expect(odd.edges.map((e) => e.risk)).toEqual(down.edges.map((e) => e.risk));
  });

  test('the response formatter reports dataQuality.crime unavailable when crimeStatus is not passed', async () => {
    const net = street();
    const graph = await buildGraph(net.roadData, null, null, null, null, [], net.bbox, { ...NIGHT, crimeStatus: 'ok' });
    const raw = findKSafestRoutes(graph.osmNodes, graph.edges, graph.adjacency, 1, 4, 1000, 1, {});
    const base = {
      rawRoutes: raw, osmNodes: graph.osmNodes, edges: graph.edges, weights: graph.weights, cctvNodes: [], transitNodes: [],
      nodeDegree: graph.nodeDegree, crimes: [], allData: { lights: { elements: [] }, places: { elements: [] } },
      oLat: LAT, oLng: LNG, dLat: LAT, dLng: LNG + 3 * DLNG, enableOpeningHoursParse: false, straightLineDist: 330,
    };
    expect(buildRouteResponses(base)[0].safety.dataQuality.crime).toBe('unavailable');
    expect(buildRouteResponses({ ...base, crimeStatus: 'ok' })[0].safety.dataQuality.crime).toBe('ok');
    expect(buildRouteResponses({ ...base, crimeStatus: 'weird' })[0].safety.dataQuality.crime).toBe('unavailable');
  });
});

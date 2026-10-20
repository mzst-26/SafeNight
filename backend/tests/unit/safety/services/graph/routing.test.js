const path = require('path');
const routing = require(path.resolve(__dirname, '../../../../../src/safety/services/graph/routing'));
const { buildNodeGrid } = require(path.resolve(__dirname, '../../../../../src/safety/services/graph/osmIndex'));
const { manualGraph } = require('./fixtures');

describe('graph/routing isHazardEdge', () => {
  const base = { hasSidewalk: false, isTunnel: false, isLit: false };
  test('allowHazards turns every check off', () => {
    expect(routing.isHazardEdge({ ...base, maxspeed: '70 mph', isTunnel: true }, true)).toBe(false);
  });
  test('80 km/h (50 mph) without a sidewalk is a hazard; 79 is not; a sidewalk saves a fast road', () => {
    expect(routing.isHazardEdge({ ...base, maxspeed: '80' })).toBe(true);
    expect(routing.isHazardEdge({ ...base, maxspeed: '79' })).toBe(false);
    expect(routing.isHazardEdge({ ...base, maxspeed: '50 mph' })).toBe(true);
    expect(routing.isHazardEdge({ ...base, maxspeed: '40 mph' })).toBe(false);
    expect(routing.isHazardEdge({ ...base, maxspeed: '60 mph', hasSidewalk: true })).toBe(false);
  });
  test('a missing, non-string or unparseable maxspeed is not a hazard; an unlit tunnel always is', () => {
    expect(routing.isHazardEdge({ ...base })).toBe(false);
    expect(routing.isHazardEdge({ ...base, maxspeed: 80 })).toBe(false);
    expect(routing.isHazardEdge({ ...base, maxspeed: 'signals' })).toBe(false);
    expect(routing.isHazardEdge({ ...base, isTunnel: true, isLit: false })).toBe(true);
    expect(routing.isHazardEdge({ ...base, isTunnel: true, isLit: true })).toBe(false);
  });
});

describe('graph/routing findNearestNode', () => {
  const osmNodes = new Map([[1, { lat: 51.5, lng: -0.1, id: 1 }], [2, { lat: 51.5, lng: -0.099, id: 2 }]]);
  const grid = buildNodeGrid(osmNodes);
  test('returns the nearest node that has an edge, within the radius', () => {
    expect(routing.findNearestNode(grid, new Map([[1, []], [2, []]]), 51.5, -0.1)).toBe(1);
    expect(routing.findNearestNode(grid, new Map([[2, []]]), 51.5, -0.1)).toBe(2);
    expect(routing.findNearestNode(grid, new Map(), 51.5, -0.1)).toBeNull();
    expect(routing.findNearestNode(grid, new Map([[1, []]]), 52, 0)).toBeNull();
    expect(routing.findNearestNode(grid, new Map([[2, []]]), 51.5, -0.1, 10)).toBeNull();
  });
});

describe('graph/routing routeToPolyline', () => {
  test('maps known nodes in order and skips unknown ones', () => {
    const nodes = new Map([[1, { lat: 1, lng: 2 }], [2, { lat: 3, lng: 4 }]]);
    expect(routing.routeToPolyline(nodes, [1, 9, 2])).toEqual([{ lat: 1, lng: 2 }, { lat: 3, lng: 4 }]);
    expect(routing.routeToPolyline(nodes, [])).toEqual([]);
  });
});

describe('graph/routing aStarSafety', () => {
  // S-A-E is short and risky (safety 0.2); S-B-E is longer and safe (safety 0.9).
  const g = manualGraph([['S', 'A', 100, 0.8], ['A', 'E', 100, 0.8], ['S', 'B', 120, 0.1], ['B', 'E', 120, 0.1]]);

  test('prefers the safer path when cost = distance / safety is lower', () => {
    const route = routing.aStarSafety(g.osmNodes, g.edges, g.adjacency, 'S', 'E', 1000);
    expect(route.edges).toEqual([2, 3]);
    expect(route.totalDist).toBe(240);
    expect(route.avgSafety).toBeCloseTo(0.9, 12);
  });

  test('edge penalties push the search to the other path', () => {
    g.edges[2].penalty = 0.8;
    g.edges[3].penalty = 0.8;
    const route = routing.aStarSafety(g.osmNodes, g.edges, g.adjacency, 'S', 'E', 1000);
    expect(route.edges).toEqual([0, 1]);
    g.edges[2].penalty = 0;
    g.edges[3].penalty = 0;
  });

  test('a hazard edge is skipped unless allowHazards is set', () => {
    const h = manualGraph([['S', 'E', 100, 0.1]], { maxspeed: '70 mph', hasSidewalk: false });
    expect(routing.aStarSafety(h.osmNodes, h.edges, h.adjacency, 'S', 'E', 1000)).toBeNull();
    expect(routing.aStarSafety(h.osmNodes, h.edges, h.adjacency, 'S', 'E', 1000, { allowHazards: true }).edges).toEqual([0]);
  });

  test('a path longer than 1.5x maxDistM is not considered', () => {
    expect(routing.aStarSafety(g.osmNodes, g.edges, g.adjacency, 'S', 'E', 100)).toBeNull();
    expect(routing.aStarSafety(g.osmNodes, g.edges, g.adjacency, 'S', 'E', 200)).not.toBeNull();
  });

  test('start equals end is the single-node path of length 0', () => {
    expect(routing.aStarSafety(g.osmNodes, g.edges, g.adjacency, 'S', 'S', 1000)).toEqual({ path: ['S'], edges: [], totalDist: 0, avgSafety: 0 });
  });

  test('missing endpoints or nodes give null', () => {
    expect(routing.aStarSafety(g.osmNodes, g.edges, g.adjacency, 'X', 'E', 1000)).toBeNull();
    expect(routing.aStarSafety(g.osmNodes, g.edges, g.adjacency, 'S', 'X', 1000)).toBeNull();
    const nodesMissing = new Map([...g.osmNodes].filter(([id]) => id !== 'E'));
    expect(routing.aStarSafety(nodesMissing, g.edges, g.adjacency, 'S', 'E', 1000)).toBeNull();
    const startMissing = new Map([...g.osmNodes].filter(([id]) => id !== 'S'));
    expect(routing.aStarSafety(startMissing, g.edges, g.adjacency, 'S', 'E', 1000)).toBeNull();
  });

  test('a disconnected end gives null; a spent budget throws NO_ROUTE_FOUND; a shared budget is counted', () => {
    const d = manualGraph([['S', 'A', 100, 0.1], ['X', 'Y', 100, 0.1]]);
    expect(routing.aStarSafety(d.osmNodes, d.edges, d.adjacency, 'S', 'Y', 1000)).toBeNull();
    expect(() => routing.aStarSafety(g.osmNodes, g.edges, g.adjacency, 'S', 'E', 1000, { maxExpansions: 1 }))
      .toThrow(expect.objectContaining({ code: 'NO_ROUTE_FOUND', statusCode: 404 }));
    const budget = { maxExpansions: 100, shouldCancel: null, pops: 0, expansions: 0 };
    routing.aStarSafety(g.osmNodes, g.edges, g.adjacency, 'S', 'E', 1000, { budget });
    expect(budget.expansions).toBeGreaterThan(0);
    expect(budget.pops).toBeGreaterThanOrEqual(budget.expansions);
  });
});

describe('graph/routing path helpers', () => {
  test('reconstructPath rebuilds forwards and returns null for a broken chain', () => {
    const prev = new Map([['B', { prevNode: 'A', edgeIdx: 1 }], ['A', { prevNode: 'S', edgeIdx: 0 }]]);
    expect(routing.reconstructPath(prev, 'S', 'B')).toEqual({ path: ['S', 'A', 'B'], usedEdges: [0, 1] });
    expect(routing.reconstructPath(prev, 'S', 'S')).toEqual({ path: ['S'], usedEdges: [] });
    expect(routing.reconstructPath(new Map(), 'S', 'B')).toBeNull();
  });

  test('summariseRoute weights safety by distance, and an empty route has 0', () => {
    const edges = [{ distance: 100, safetyScore: 0.5 }, { distance: 300, safetyScore: 0.9 }];
    expect(routing.summariseRoute(edges, ['a', 'b', 'c'], [0, 1])).toEqual({
      path: ['a', 'b', 'c'], edges: [0, 1], totalDist: 400, avgSafety: (100 * 0.5 + 300 * 0.9) / 400,
    });
    expect(routing.summariseRoute(edges, ['a'], []).avgSafety).toBe(0);
  });
});

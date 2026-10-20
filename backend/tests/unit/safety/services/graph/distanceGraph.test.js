const path = require('path');
const dist = require(path.resolve(__dirname, '../../../../../src/safety/services/graph/distanceGraph'));

const node = (id, lat, lon) => ({ type: 'node', id, lat, lon });
const way = (id, nodes, tags) => ({ type: 'way', id, nodes, tags });
const LAT = 51.5;
const LNG = -0.1;
const D = 0.0015; // ~104 m

// 1 - 2 - 3 along a residential street, 3 - 4 a footway, 5 isolated, 2 - 6 a motorway (not walkable).
const DATA = {
  elements: [
    node(1, LAT, LNG), node(2, LAT, LNG + D), node(3, LAT, LNG + 2 * D), node(4, LAT, LNG + 3 * D),
    node(5, LAT + 1, LNG), node(6, LAT + D, LNG + D),
    way(10, [1, 2, 3], { highway: 'residential' }),
    way(11, [3, 4], { highway: 'footway' }),
    way(12, [2, 6], { highway: 'motorway' }),
  ],
};

describe('graph/distanceGraph buildDistanceOnlyGraph', () => {
  test('has walkable edges with from, to and distance only, bidirectional adjacency and a node grid', () => {
    const g = dist.buildDistanceOnlyGraph(DATA);
    expect(g.edges).toHaveLength(3);
    expect(Object.keys(g.edges[0]).sort()).toEqual(['distance', 'from', 'to']);
    expect(g.edges[0]).toMatchObject({ from: 1, to: 2 });
    expect(g.adjacency.get(2).map((a) => a.neighborId).sort()).toEqual([1, 3]);
    expect(g.osmNodes.size).toBe(6);
    expect(g.nodeGrid).toBeDefined();
    expect(g.adjacency.has(5)).toBe(false);
    expect(g.adjacency.has(6)).toBe(false);
  });

  test('nodes at the same coordinates stay joined by a 0.5 m edge', () => {
    const g = dist.buildDistanceOnlyGraph({
      elements: [node(1, LAT, LNG), node(2, LAT, LNG), way(1, [1, 2], { highway: 'residential' })],
    });
    expect(g.edges).toEqual([{ from: 1, to: 2, distance: 0.5 }]);
  });
});

describe('graph/distanceGraph aStarDistance', () => {
  const g = dist.buildDistanceOnlyGraph(DATA);

  test('finds the shortest path and its straight-line length', () => {
    const out = dist.aStarDistance(g.osmNodes, g.edges, g.adjacency, 1, 4, 10000);
    expect(out.path).toEqual([1, 2, 3, 4]);
    expect(out.totalDist).toBeGreaterThan(300);
    expect(out.totalDist).toBeLessThan(330);
  });

  test('start equals end is a one-node path', () => {
    expect(dist.aStarDistance(g.osmNodes, g.edges, g.adjacency, 2, 2, 10)).toEqual({ path: [2], totalDist: 0 });
  });

  test('null for unknown nodes, an isolated end, the distance cap, and nodes missing from the node map', () => {
    expect(dist.aStarDistance(g.osmNodes, g.edges, g.adjacency, 1, 99, 10000)).toBeNull();
    expect(dist.aStarDistance(g.osmNodes, g.edges, g.adjacency, 1, 5, 10000)).toBeNull();
    expect(dist.aStarDistance(g.osmNodes, g.edges, g.adjacency, 1, 4, 150)).toBeNull();
    expect(dist.aStarDistance(new Map(), g.edges, g.adjacency, 1, 4, 10000)).toBeNull();
  });

  test('works without an options argument and ignores a non-function shouldCancel', () => {
    expect(dist.aStarDistance(g.osmNodes, g.edges, g.adjacency, 1, 3, 10000).path).toEqual([1, 2, 3]);
    expect(dist.aStarDistance(g.osmNodes, g.edges, g.adjacency, 1, 3, 10000, { shouldCancel: 'no' }).path).toEqual([1, 2, 3]);
  });
});

describe('graph/distanceGraph pathFromPrev and pathLength', () => {
  test('pathFromPrev rebuilds start to end, or null on a broken chain', () => {
    const prev = new Map([[3, { prevNode: 2 }], [2, { prevNode: 1 }]]);
    expect(dist.pathFromPrev(prev, 1, 3)).toEqual([1, 2, 3]);
    expect(dist.pathFromPrev(prev, 1, 1)).toEqual([1]);
    expect(dist.pathFromPrev(new Map(), 1, 3)).toBeNull();
  });

  test('pathLength sums straight-line legs between known nodes and skips unknown ones', () => {
    const nodes = new Map([[1, { lat: LAT, lng: LNG }], [2, { lat: LAT, lng: LNG + D }]]);
    const one = dist.pathLength(nodes, [1, 2]);
    expect(one).toBeGreaterThan(100);
    expect(dist.pathLength(nodes, [1, 2, 99])).toBeCloseTo(one, 12);
    expect(dist.pathLength(nodes, [1])).toBe(0);
  });
});

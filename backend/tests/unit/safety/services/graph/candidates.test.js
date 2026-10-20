const path = require('path');
const candidates = require(path.resolve(__dirname, '../../../../../src/safety/services/graph/candidates'));
const { manualGraph } = require('./fixtures');

describe('graph/candidates countEdgeOverlap', () => {
  test('is the fraction of the second route that the first also uses', () => {
    expect(candidates.countEdgeOverlap([1, 2, 3], [2, 3, 4, 5])).toBe(0.5);
    expect(candidates.countEdgeOverlap([1, 2], [1, 2])).toBe(1);
    expect(candidates.countEdgeOverlap([1], [2])).toBe(0);
    expect(candidates.countEdgeOverlap([1], [])).toBe(0);
  });

  test('two empty-edge routes count as duplicates of each other', () => {
    expect(candidates.countEdgeOverlap([], [])).toBe(1);
  });
});

describe('graph/candidates findKSafestRoutes', () => {
  const spec = [['S', 'A', 500, 0.5], ['A', 'E', 500, 0.5], ['S', 'B', 600, 0.3], ['B', 'E', 600, 0.3]];

  test('finds both distinct routes, ranks them by exposure and clears the penalties', () => {
    const { osmNodes, edges, adjacency } = manualGraph(spec);
    const routes = candidates.findKSafestRoutes(osmNodes, edges, adjacency, 'S', 'E', 2000, 5, {});
    expect(routes.map((r) => r.edges)).toEqual([[2, 3], [0, 1]]);
    expect(routes.every((r) => Number.isFinite(r.exposure))).toBe(true);
    expect(edges.every((e) => e.penalty === 0)).toBe(true);
  });

  test('k limits the routes returned', () => {
    const { osmNodes, edges, adjacency } = manualGraph(spec);
    expect(candidates.findKSafestRoutes(osmNodes, edges, adjacency, 'S', 'E', 2000, 1, {})).toHaveLength(1);
  });

  test('no path gives an empty list', () => {
    const { osmNodes, edges, adjacency } = manualGraph([['S', 'A', 10, 0.1], ['X', 'E', 10, 0.1]]);
    expect(candidates.findKSafestRoutes(osmNodes, edges, adjacency, 'S', 'E', 2000, 3, {})).toEqual([]);
  });

  test('the same route twice (all edges shared) is kept once', () => {
    const { osmNodes, edges, adjacency } = manualGraph([['S', 'E', 100, 0.1]]);
    expect(candidates.findKSafestRoutes(osmNodes, edges, adjacency, 'S', 'E', 2000, 5, {})).toHaveLength(1);
  });

  test('start equal to end yields one zero-length route, not one copy per candidate search', () => {
    const { osmNodes, edges, adjacency } = manualGraph([['S', 'A', 500, 0.5], ['A', 'S', 500, 0.5]]);
    const routes = candidates.findKSafestRoutes(osmNodes, edges, adjacency, 'S', 'S', 2000, 5, {});
    expect(routes).toHaveLength(1);
    expect(routes[0]).toMatchObject({ edges: [], totalDist: 0 });
  });

  test('cancellation propagates and clears penalties', () => {
    const { osmNodes, edges, adjacency } = manualGraph(spec);
    expect(() => candidates.findKSafestRoutes(osmNodes, edges, adjacency, 'S', 'E', 2000, 5, { shouldCancel: () => true }))
      .toThrow(expect.objectContaining({ code: 'SEARCH_CANCELLED' }));
    expect(edges.every((e) => e.penalty === 0)).toBe(true);
  });

  test('a budget overrun before any route is found throws NO_ROUTE_FOUND', () => {
    const { osmNodes, edges, adjacency } = manualGraph(spec);
    expect(() => candidates.findKSafestRoutes(osmNodes, edges, adjacency, 'S', 'E', 2000, 5, { maxExpansions: 1 }))
      .toThrow(expect.objectContaining({ code: 'NO_ROUTE_FOUND' }));
  });

  test('a budget overrun after a route was found returns that route', () => {
    const { osmNodes, edges, adjacency } = manualGraph(spec);
    // The first search expands S, B, E (3 nodes); a budget of 4 lets it finish and stops the second search.
    const routes = candidates.findKSafestRoutes(osmNodes, edges, adjacency, 'S', 'E', 2000, 5, { maxExpansions: 4 });
    expect(routes).toHaveLength(1);
    expect(routes[0].edges).toEqual([2, 3]);
  });

  test('a non-budget error is rethrown even after a route was found', () => {
    const { osmNodes, edges, adjacency } = manualGraph(spec);
    let calls = 0;
    const shouldCancel = () => { calls += 1; return calls >= 2; };
    expect(() => candidates.findKSafestRoutes(osmNodes, edges, adjacency, 'S', 'E', 2000, 5, { shouldCancel }))
      .toThrow(expect.objectContaining({ code: 'SEARCH_CANCELLED' }));
  });
});

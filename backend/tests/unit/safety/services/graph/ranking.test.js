const path = require('path');
const ranking = require(path.resolve(__dirname, '../../../../../src/safety/services/graph/ranking'));
const { manualGraph } = require('./fixtures');

describe('graph/ranking toAggregateEdge', () => {
  test('maps the graph edge to the aggregation shape', () => {
    const edge = { distance: 120, risk: 0.3, certainty: 0.7, cause: 'crime', start: { lat: 1, lng: 2 }, end: { lat: 3, lng: 4 }, extra: 1 };
    expect(ranking.toAggregateEdge(edge)).toEqual({
      lengthM: 120, risk: 0.3, certainty: 0.7, cause: 'crime', start: { lat: 1, lng: 2 }, end: { lat: 3, lng: 4 },
    });
  });
});

describe('graph/ranking rankRoutesByExposure', () => {
  // Route 0: 1000 m at risk 0.5 (exposure 0.5). Route 1: 1400 m at 0.4 (0.4 * sqrt(1.4) = 0.473). Route 2: 2100 m at 0.1.
  const { edges } = manualGraph([
    ['S', 'A', 500, 0.5], ['A', 'E', 500, 0.5],
    ['S', 'B', 700, 0.4], ['B', 'E', 700, 0.4],
    ['S', 'E', 2100, 0.1],
  ]);
  const route = (idxs, totalDist) => ({ path: [], edges: idxs, totalDist });

  test('orders by exposure, attaches the aggregate fields and puts a route over 2.0x last as excluded', () => {
    const ranked = ranking.rankRoutesByExposure([route([0, 1], 1000), route([2, 3], 1400), route([4], 2100)], edges);
    expect(ranked.map((r) => r.edges)).toEqual([[2, 3], [0, 1], [4]]);
    expect(ranked.map((r) => r.excluded)).toEqual([false, false, true]);
    expect(ranked[0].exposure).toBeCloseTo(0.4 * Math.sqrt(1.4), 12);
    expect(ranked[0]).toMatchObject({ lengthM: 1400, score: 60 });
    expect(ranked[0].routeRisk).toBeCloseTo(0.4, 12);
    expect(ranked[0].avgSafety).toBeCloseTo(0.6, 12);
    expect(ranked[0].worstStretch).toBeNull();
    for (const key of ['mean', 'm3', 'certainty']) expect(Number.isFinite(ranked[0][key])).toBe(true);
  });

  test('a route with no edges goes first, with the degenerate scores', () => {
    const ranked = ranking.rankRoutesByExposure([route([0, 1], 1000), route([], 0)], edges);
    expect(ranked[0]).toMatchObject({
      edges: [], routeRisk: 0, score: 100, certainty: 0, exposure: 0, excluded: false, lengthM: 0, avgSafety: 1, worstStretch: null,
    });
    expect(ranked[1].edges).toEqual([0, 1]);
  });

  test('an empty candidate list ranks to an empty list', () => {
    expect(ranking.rankRoutesByExposure([], edges)).toEqual([]);
  });
});

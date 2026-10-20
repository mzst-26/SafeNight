/**
 * Avoidance candidates (graph/candidates.js): after the k normal candidates, the best route's weak stretches
 * (contiguous edges at risk >= RISK_POOR_THRESHOLD, >= AVOID.MIN_STRETCH_M long, at most AVOID.MAX_STRETCHES) are
 * blocked in turn (cost x AVOID.PENALTY, not removed) and the route is searched again from the origin. The normal
 * exposure ranking then decides whether the detour wins.
 *
 * Scene (edges are [from, to, metres, risk]): S -- A -- B -- E with a dark span A-B in the middle, and a lit detour
 * A -- C -- B around it. Edge order fixes the indexes: 0 S-A, 1 A-B (dark), 2 B-E, 3 A-C, 4 C-B.
 */
const path = require('path');
const { findKSafestRoutes } = require(path.resolve(__dirname, '../../../../../src/safety/services/graph/candidates'));
const { AVOID } = require(path.resolve(__dirname, '../../../../../src/safety/scoring/config'));
const { manualGraph } = require('./fixtures');

/** k = 1 so the normal pass yields only the direct route and the avoidance pass is what finds the detour. */
const run = (spec, options = {}, k = 1) => {
  const g = manualGraph(spec);
  return { ...g, routes: findKSafestRoutes(g.osmNodes, g.edges, g.adjacency, 'S', 'E', 20_000, k, options) };
};
const usesDarkSpan = (route) => route.edges.includes(1);

// The dark span must be what plain A* picks (cost = metres / safety), so the detour has to cost more than the span:
// at risk 0.7 a span costs about 3.3 per metre and the lit detour about 1.1 per metre, hence legs well over half the span.
const scene = ({ darkM, detourLegM, darkRisk = 0.7, litRisk = 0.1, detourRisk = 0.1 }) => [
  ['S', 'A', 1000, litRisk],
  ['A', 'B', darkM, darkRisk],
  ['B', 'E', 1000, litRisk],
  ['A', 'C', detourLegM, detourRisk],
  ['C', 'B', detourLegM, detourRisk],
];

describe('avoidance candidate', () => {
  test('is added when the best route has a weak stretch and a way round exists', () => {
    const { routes } = run(scene({ darkM: 300, detourLegM: 500 }));
    expect(routes).toHaveLength(2);
    expect(routes.some(usesDarkSpan)).toBe(true);
    expect(routes.some((r) => !usesDarkSpan(r))).toBe(true);
  });

  test('wins the exposure ranking when the dark span is long enough', () => {
    const { routes } = run(scene({ darkM: 300, detourLegM: 500 }));
    expect(usesDarkSpan(routes[0])).toBe(false);
    expect(routes[0].exposure).toBeLessThan(routes[1].exposure);
  });

  test('loses the ranking when the detour is too long for what it saves (exposure formula decides)', () => {
    const { routes } = run(scene({ darkM: 80, detourLegM: 200, detourRisk: 0.4 }));
    expect(routes).toHaveLength(2); // still offered as a candidate: ranking, not the generator, decides
    expect(usesDarkSpan(routes[0])).toBe(true);
    expect(routes[0].exposure).toBeLessThan(routes[1].exposure);
  });

  test('is not added when the best route has no weak stretch', () => {
    const { routes } = run(scene({ darkM: 300, detourLegM: 500, darkRisk: 0.55 }));
    expect(routes).toHaveLength(1);
  });

  test('is not added when the weak stretch is shorter than AVOID.MIN_STRETCH_M', () => {
    const { routes } = run(scene({ darkM: AVOID.MIN_STRETCH_M - 10, detourLegM: 200 }));
    expect(routes).toHaveLength(1);
  });

  test('a stretch exactly AVOID.MIN_STRETCH_M long counts', () => {
    const { routes } = run(scene({ darkM: AVOID.MIN_STRETCH_M, detourLegM: 120 }));
    expect(routes).toHaveLength(2);
  });

  test('is not added when there is no alternative: the blocked stretch is penalised, not removed', () => {
    const { routes } = run([['S', 'A', 1000, 0.1], ['A', 'B', 200, 0.7], ['B', 'E', 1000, 0.1]]);
    expect(routes).toHaveLength(1);
    expect(routes[0].edges).toEqual([0, 1, 2]);
  });

  test('is not added when the detour would exceed the length cap (MAX_LENGTH_RATIO of the shortest)', () => {
    const { routes } = run(scene({ darkM: 300, detourLegM: 3000 }));
    expect(routes).toHaveLength(1);
  });

  test('a contiguous run of weak edges is one stretch (two 40 m edges make an 80 m stretch)', () => {
    const { routes } = run([
      ['S', 'A', 1000, 0.1], ['A', 'M', 40, 0.7], ['M', 'B', 40, 0.7], ['B', 'E', 1000, 0.1],
      ['A', 'C', 150, 0.1], ['C', 'B', 150, 0.1],
    ]);
    expect(routes).toHaveLength(2);
    expect(routes.some((r) => !r.edges.includes(1) && !r.edges.includes(2))).toBe(true);
  });

  test('runs at most AVOID.MAX_STRETCHES extra searches (one cancellation check per search)', () => {
    // Three separate dark spans, each with a bypass.
    const spec = [
      ['S', 'A1', 300, 0.1], ['A1', 'B1', 100, 0.7], ['B1', 'A2', 300, 0.1], ['A2', 'B2', 90, 0.7],
      ['B2', 'A3', 300, 0.1], ['A3', 'B3', 80, 0.7], ['B3', 'E', 300, 0.1],
      ['A1', 'C1', 350, 0.1], ['C1', 'B1', 350, 0.1], ['A2', 'C2', 350, 0.1], ['C2', 'B2', 350, 0.1],
      ['A3', 'C3', 350, 0.1], ['C3', 'B3', 350, 0.1],
    ];
    let checks = 0;
    const { routes } = run(spec, { shouldCancel: () => { checks += 1; return false; } });
    expect(AVOID.MAX_STRETCHES).toBe(2);
    expect(checks).toBeLessThanOrEqual(1 + AVOID.MAX_STRETCHES); // 1 normal search + the avoidance searches
    expect(routes.length).toBeLessThanOrEqual(1 + AVOID.MAX_STRETCHES);
    expect(routes.length).toBeGreaterThan(1);
  });

  test('picks the longest stretches first', () => {
    const spec = [
      ['S', 'A1', 300, 0.1], ['A1', 'B1', 70, 0.7], ['B1', 'A2', 300, 0.1], ['A2', 'B2', 200, 0.7],
      ['B2', 'A3', 300, 0.1], ['A3', 'B3', 150, 0.7], ['B3', 'E', 300, 0.1],
      ['A1', 'C1', 350, 0.1], ['C1', 'B1', 350, 0.1], ['A2', 'C2', 350, 0.1], ['C2', 'B2', 350, 0.1],
      ['A3', 'C3', 350, 0.1], ['C3', 'B3', 350, 0.1],
    ];
    const { routes } = run(spec);
    const avoided = (route, edgeIdx) => !route.edges.includes(edgeIdx);
    // Spans are edges 1 (70 m), 3 (200 m) and 5 (150 m): the two longest, 3 and 5, are the ones searched around.
    expect(routes.some((r) => avoided(r, 3))).toBe(true);
    expect(routes.some((r) => avoided(r, 5))).toBe(true);
    expect(routes.every((r) => !avoided(r, 1) || avoided(r, 3) || avoided(r, 5))).toBe(true);
  });

  test('leaves no penalty or block on the edges afterwards', () => {
    const { edges } = run(scene({ darkM: 300, detourLegM: 500 }));
    expect(edges.every((e) => e.penalty === 0)).toBe(true);
    expect(edges.every((e) => !('avoid' in e))).toBe(true);
  });

  test('cancellation during the avoidance pass propagates and clears penalties', () => {
    let checks = 0;
    const g = manualGraph(scene({ darkM: 300, detourLegM: 500 }));
    expect(() => findKSafestRoutes(g.osmNodes, g.edges, g.adjacency, 'S', 'E', 20_000, 1, {
      shouldCancel: () => { checks += 1; return checks >= 2; },
    })).toThrow(expect.objectContaining({ code: 'SEARCH_CANCELLED' }));
    expect(g.edges.every((e) => e.penalty === 0)).toBe(true);
  });

  test('a budget overrun during the avoidance pass keeps the routes already found', () => {
    // The first search expands S, A, B, E (4 nodes); a budget of 5 stops the avoidance search.
    const { routes } = run(scene({ darkM: 300, detourLegM: 500 }), { maxExpansions: 5 });
    expect(routes).toHaveLength(1);
  });
});

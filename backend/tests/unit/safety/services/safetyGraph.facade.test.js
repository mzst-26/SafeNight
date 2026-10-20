/**
 * The public surface of services/safetyGraph.js: the names callers import, no v1 or model-flag leftovers,
 * and the graph-builder constants pinned in scoring/config.js.
 */
const path = require('path');
const safetyGraph = require(path.resolve(__dirname, '../../../../src/safety/services/safetyGraph'));
const config = require(path.resolve(__dirname, '../../../../src/safety/scoring/config'));

describe('safetyGraph facade', () => {
  test('exports exactly the public API', () => {
    expect(Object.keys(safetyGraph).sort()).toEqual([
      'MAX_ASTAR_EXPANSIONS', 'ROAD_TYPE_SCORES', 'WALKABLE_HIGHWAYS', 'aStarDistance', 'aStarSafety', 'buildDistanceOnlyGraph',
      'buildGraph', 'crimesToWeightedCounts', 'findKSafestRoutes', 'findNearestNode', 'isHazardEdge', 'routeSafetyBreakdown',
      'routeToPolyline',
    ]);
  });

  test('no model flag, v1 weights or v1 helpers remain', () => {
    for (const name of ['useV2', 'currentModel', 'getV1Weights', 'buildGraphV1']) {
      expect(safetyGraph).not.toHaveProperty(name);
    }
  });

  test('the SAFETY_MODEL environment variable no longer changes anything', async () => {
    const previous = process.env.SAFETY_MODEL;
    process.env.SAFETY_MODEL = 'v1';
    try {
      const roadData = { elements: [
        { type: 'node', id: 1, lat: 51.5, lon: -0.1 }, { type: 'node', id: 2, lat: 51.5, lon: -0.098 },
        { type: 'way', id: 9, nodes: [1, 2], tags: { highway: 'residential' } },
      ] };
      const bbox = { south: 51.49, north: 51.51, west: -0.11, east: -0.09 };
      const graph = await safetyGraph.buildGraph(roadData, null, null, null, null, [], bbox, { hour: 23, now: new Date('2026-10-19T22:30:00Z'), crimeStatus: 'ok' });
      expect(graph.edges[0].risk).toBeGreaterThan(0);
      expect(graph.edges[0].safetyScore).toBeCloseTo(1 - graph.edges[0].risk, 12);
    } finally {
      if (previous === undefined) delete process.env.SAFETY_MODEL;
      else process.env.SAFETY_MODEL = previous;
    }
  });

  test('WALKABLE_HIGHWAYS is the road score table', () => {
    expect([...safetyGraph.WALKABLE_HIGHWAYS].sort()).toEqual(Object.keys(safetyGraph.ROAD_TYPE_SCORES).sort());
    expect(safetyGraph.ROAD_TYPE_SCORES).toBe(config.ROAD_TYPE_SCORES);
  });
});

describe('graph-builder constants in scoring/config.js', () => {
  test('lamp radii are separate on purpose: 30 m lights a segment, 60 m saves a lonely path', () => {
    expect(config.LAMP_RADIUS_M).toBe(30);
    expect(config.LAMP_NEAR_PATH_M).toBe(60);
  });

  test('pins the graph tunables the calibration depends on', () => {
    expect(config.GRAPH).toMatchObject({
      ROAD_N: 10, ACTIVITY_N: 8, ISOLATION_N: 6, CACHE_LIGHT_N: 6,
      DEAD_END_PENALTY: 0.5, UNLIT_PATH_PENALTY: 0.95,
      AREA_CELL_DEG: 0.003, CRIME_CELL_M: 500, CRIME_PRIOR_FLOOR: 0.1,
      CCTV_RADIUS_M: 80, PLACE_RADIUS_M: 80, TRANSIT_RADIUS_M: 150, MIN_EDGE_LENGTH_M: 0.5,
    });
    expect(config.SEARCH).toMatchObject({
      MAX_ASTAR_EXPANSIONS: 3_000_000, CANCEL_CHECK_MASK: 1023, PENALTY_INCREMENT: 0.15, DUPLICATE_OVERLAP: 0.85, EXTRA_SEARCHES: 3,
    });
    expect(config.CRIME_STATUS).toEqual({ OK: 'ok', UNAVAILABLE: 'unavailable' });
  });

  test('the road score table is the walkable set and every score is in (0, 1]', () => {
    for (const score of Object.values(config.ROAD_TYPE_SCORES)) {
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThanOrEqual(1);
    }
    expect(Object.keys(config.ROAD_TYPE_SCORES)).toHaveLength(14);
  });
});

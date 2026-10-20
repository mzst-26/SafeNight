/**
 * A* cancellation and expansion budget (aStarSafety / findKSafestRoutes).
 * Synthetic square grids only: no network, no clock, deterministic.
 */
const path = require('path');
const {
  aStarSafety,
  findKSafestRoutes,
  MAX_ASTAR_EXPANSIONS,
} = require(path.resolve(__dirname, '../../../../src/safety/services/safetyGraph'));

const LAT0 = 51.5;
const LNG0 = -0.1;
const STEP = 0.001; // about 111 m

/**
 * Square grid of side n, every node joined to its right and down neighbours (both directions).
 * The node `isolatedId`, if given, is present in osmNodes and adjacency but connected to nothing,
 * so a search to it has to exhaust the whole reachable grid before it reports no path.
 */
function gridGraph(n, { isolatedId = null } = {}) {
  const osmNodes = new Map();
  const edges = [];
  const adjacency = new Map();
  const id = (r, c) => r * n + c;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      osmNodes.set(id(r, c), { lat: LAT0 + r * STEP, lng: LNG0 + c * STEP });
      adjacency.set(id(r, c), []);
    }
  }
  const link = (a, b) => {
    const idx = edges.length;
    edges.push({
      idx,
      distance: 111,
      safetyScore: 0.8,
      penalty: 0,
      hasSidewalk: true,
      isTunnel: false,
      isLit: true,
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
  if (isolatedId != null) {
    osmNodes.set(isolatedId, { lat: LAT0 + 0.5, lng: LNG0 + 0.5 });
    adjacency.set(isolatedId, []);
  }
  return { osmNodes, edges, adjacency, id };
}

describe('safetyGraph A* cancellation and expansion budget', () => {
  test('MAX_ASTAR_EXPANSIONS is 3,000,000', () => {
    expect(MAX_ASTAR_EXPANSIONS).toBe(3_000_000);
  });

  test('aStarSafety stops mid-search when the cancel signal flips after a checkpoint', () => {
    // 60x60 = 3600 reachable nodes and an unreachable end: the search pops every node, so it
    // reaches the second 1024-pop checkpoint (pop 2048) well before it could finish.
    const g = gridGraph(60, { isolatedId: 99999 });
    let checks = 0;
    const shouldCancel = () => {
      checks += 1;
      return checks >= 2;
    };

    let thrown = null;
    try {
      aStarSafety(g.osmNodes, g.edges, g.adjacency, g.id(0, 0), 99999, 1e9, { shouldCancel });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).not.toBeNull();
    expect(thrown.code).toBe('SEARCH_CANCELLED');
    expect(checks).toBe(2);
  });

  test('aStarSafety returns without checking cancellation when the search finishes before the first checkpoint', () => {
    const g = gridGraph(4);
    const shouldCancel = jest.fn(() => false);

    const route = aStarSafety(g.osmNodes, g.edges, g.adjacency, g.id(0, 0), g.id(3, 3), 1e9, { shouldCancel });

    expect(route).not.toBeNull();
    expect(shouldCancel).not.toHaveBeenCalled();
  });

  test('aStarSafety throws a path-not-found style error once the expansion budget is exceeded', () => {
    const g = gridGraph(60);

    let thrown = null;
    try {
      aStarSafety(g.osmNodes, g.edges, g.adjacency, g.id(0, 0), g.id(59, 59), 1e9, { maxExpansions: 10 });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).not.toBeNull();
    expect(thrown.code).toBe('NO_ROUTE_FOUND');
    expect(thrown.statusCode).toBe(404);
  });

  test('findKSafestRoutes returns immediately with SEARCH_CANCELLED when the token is already cancelled', () => {
    const g = gridGraph(6);

    expect(() =>
      findKSafestRoutes(g.osmNodes, g.edges, g.adjacency, g.id(0, 0), g.id(5, 5), 1e9, 3, {
        shouldCancel: () => true,
      }),
    ).toThrow(expect.objectContaining({ code: 'SEARCH_CANCELLED' }));
  });

  test('findKSafestRoutes applies the expansion budget across its candidate searches', () => {
    const g = gridGraph(60);

    let thrown = null;
    try {
      findKSafestRoutes(g.osmNodes, g.edges, g.adjacency, g.id(0, 0), g.id(59, 59), 1e9, 3, {
        maxExpansions: 10,
      });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).not.toBeNull();
    expect(thrown.code).toBe('NO_ROUTE_FOUND');
  });

  test('a cancelled findKSafestRoutes leaves no edge penalties behind', () => {
    // First candidate is found (and penalises its edges), then the cancel signal fires at the
    // next candidate. The penalties must be cleared on the way out.
    const g = gridGraph(3);
    let calls = 0;
    const shouldCancel = () => {
      calls += 1;
      return calls >= 2;
    };

    expect(() =>
      findKSafestRoutes(g.osmNodes, g.edges, g.adjacency, g.id(0, 0), g.id(2, 2), 1e9, 3, { shouldCancel }),
    ).toThrow(expect.objectContaining({ code: 'SEARCH_CANCELLED' }));

    expect(g.edges.every((e) => e.penalty === 0)).toBe(true);
  });
});

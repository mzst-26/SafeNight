const {
  aggregateRoute,
  exposure,
  rankRoutes,
  buildReason,
} = require('../../../../src/safety/scoring/routeAggregate');
const { createSeededRandom } = require('./seededRandom');

const EPS = 1e-9;
const CAUSES = ['lighting', 'crime', 'road', 'activity', 'isolation'];
const ORIGIN = { lat: 50.37, lng: -4.14 };
const DESTINATION = { lat: 50.38, lng: -4.13 };

function edge(lengthM, risk, overrides = {}) {
  return {
    lengthM,
    risk,
    certainty: 0.8,
    cause: 'road',
    start: ORIGIN,
    end: DESTINATION,
    ...overrides,
  };
}

function randomRoute(rand, edgeCount) {
  return Array.from({ length: edgeCount }, () =>
    edge(20 + rand() * 480, rand(), {
      certainty: rand(),
      cause: CAUSES[Math.floor(rand() * CAUSES.length)],
    }),
  );
}

function ranked(id, lengthM, routeRisk) {
  return {
    id,
    lengthM,
    routeRisk,
    score: Math.round(100 * (1 - routeRisk)),
    certainty: 0.8,
  };
}

function candidate(id, lengthM, routeRisk, score, worstStretch = null) {
  return { id, lengthM, routeRisk, score, certainty: 0.8, worstStretch };
}

describe('aggregateRoute property tests', () => {
  test('splitting any edge into two halves with the same risk leaves routeRisk unchanged', () => {
    const rand = createSeededRandom(1);

    for (let trial = 0; trial < 200; trial++) {
      const edges = randomRoute(rand, 2 + Math.floor(rand() * 8));
      const index = Math.floor(rand() * edges.length);
      const half = { ...edges[index], lengthM: edges[index].lengthM / 2 };
      const split = [...edges.slice(0, index), half, half, ...edges.slice(index + 1)];

      const original = aggregateRoute(edges).routeRisk;
      const splitRisk = aggregateRoute(split).routeRisk;

      expect(Math.abs(splitRisk - original)).toBeLessThan(EPS);
    }
  });

  test('a route where every edge has the same risk has routeRisk equal to that risk', () => {
    const rand = createSeededRandom(2);

    for (let trial = 0; trial < 200; trial++) {
      const risk = rand();
      const edges = randomRoute(rand, 1 + Math.floor(rand() * 10)).map((e) => ({
        ...e,
        risk,
      }));

      expect(Math.abs(aggregateRoute(edges).routeRisk - risk)).toBeLessThan(EPS);
    }
  });

  test('adding a stretch at or above the poor threshold to a route below it never raises the score', () => {
    const rand = createSeededRandom(3);

    for (let trial = 0; trial < 200; trial++) {
      const base = randomRoute(rand, 2 + Math.floor(rand() * 6)).map((e) => ({
        ...e,
        risk: rand() * 0.6,
      }));
      const poor = edge(20 + rand() * 400, 0.6 + rand() * 0.4);

      const before = aggregateRoute(base).score;
      const after = aggregateRoute([...base, poor]).score;

      expect(after).toBeLessThanOrEqual(before);
    }
  });

  test('a 300 m risk-0.9 stretch inside a 2 km route scores clearly lower than mean-only scoring', () => {
    const calm = Array.from({ length: 17 }, () => edge(100, 0.1));
    const dark = edge(300, 0.9, { cause: 'lighting' });
    const route = [...calm.slice(0, 8), dark, ...calm.slice(8)];

    const weighted = aggregateRoute(route).score;
    const meanOnly = aggregateRoute(route, { g: 0 }).score;

    expect(meanOnly - weighted).toBeGreaterThanOrEqual(5);
  });

  test('zero-length edges do not change the aggregate', () => {
    const edges = [edge(100, 0.2), edge(300, 0.5)];
    const withZero = [...edges, edge(0, 0.99)];

    expect(aggregateRoute(withZero).routeRisk).toBeCloseTo(
      aggregateRoute(edges).routeRisk,
      12,
    );
  });

  test('throws TypeError for an empty edge list', () => {
    expect(() => aggregateRoute([])).toThrow(TypeError);
  });

  test('throws TypeError when no edge has positive length', () => {
    expect(() => aggregateRoute([edge(0, 0.5)])).toThrow(TypeError);
  });
});

describe('aggregateRoute worstStretch', () => {
  test('merges adjacent poor edges into one stretch with summed length and boundary points', () => {
    const edges = [
      edge(100, 0.1),
      edge(150, 0.7, { cause: 'lighting', start: { lat: 1, lng: 1 }, end: { lat: 1.1, lng: 1.1 } }),
      edge(200, 0.8, { cause: 'lighting', start: { lat: 1.1, lng: 1.1 }, end: { lat: 1.2, lng: 1.2 } }),
      edge(100, 0.2),
      edge(250, 0.65, { cause: 'crime' }),
    ];

    expect(aggregateRoute(edges).worstStretch).toEqual({
      start: { lat: 1, lng: 1 },
      end: { lat: 1.2, lng: 1.2 },
      lengthM: 350,
      cause: 'lighting',
    });
  });

  test('takes the most common cause by length rather than by edge count', () => {
    const edges = [
      edge(60, 0.9, { cause: 'road' }),
      edge(60, 0.9, { cause: 'road' }),
      edge(200, 0.9, { cause: 'lighting' }),
    ];

    expect(aggregateRoute(edges).worstStretch.cause).toBe('lighting');
  });

  test('counts an edge at exactly the poor threshold as poor', () => {
    const stretch = aggregateRoute([edge(100, 0.2), edge(300, 0.6, { cause: 'crime' })]).worstStretch;

    expect(stretch).toEqual({
      start: ORIGIN,
      end: DESTINATION,
      lengthM: 300,
      cause: 'crime',
    });
  });

  test('returns null when no edge reaches the poor threshold', () => {
    expect(aggregateRoute([edge(100, 0.2), edge(100, 0.59)]).worstStretch).toBeNull();
  });
});

describe('exposure', () => {
  test('is routeRisk times length in kilometres', () => {
    expect(exposure(0.5, 2000)).toBeCloseTo(1.0, 12);
  });
});

describe('rankRoutes', () => {
  test('orders kept routes by exposure, not by routeRisk', () => {
    const ordered = rankRoutes([ranked('B', 1400, 0.25), ranked('A', 1000, 0.3)]);

    expect(ordered.map((r) => r.id)).toEqual(['A', 'B']);
  });

  test('prefers the shorter of two routes with equal risk', () => {
    const ordered = rankRoutes([ranked('long', 2400, 0.3), ranked('short', 2000, 0.3)]);

    expect(ordered.map((r) => r.id)).toEqual(['short', 'long']);
  });

  test('excludes a route over 1.5x the shortest even when it is safer per metre, listing it last', () => {
    const ordered = rankRoutes([ranked('far', 3500, 0.1), ranked('short', 2000, 0.5)]);

    expect(ordered.map((r) => r.id)).toEqual(['short', 'far']);
    expect(ordered[0].excluded).toBe(false);
    expect(ordered[1].excluded).toBe(true);
  });

  test('keeps a route exactly 1.5x the shortest', () => {
    const ordered = rankRoutes([ranked('short', 2000, 0.5), ranked('edge', 3000, 0.1)]);

    expect(ordered.find((r) => r.id === 'edge').excluded).toBe(false);
  });

  test('attaches exposure to every returned route', () => {
    const ordered = rankRoutes([ranked('short', 2000, 0.5)]);

    expect(ordered[0].exposure).toBeCloseTo(1.0, 12);
  });
});

describe('buildReason', () => {
  test('explains a lowest-exposure pick that is shorter but less safe than an alternative', () => {
    const best = candidate(1, 2000, 0.3, 70);
    const alternative = candidate(2, 2644, 0.25, 75);

    expect(buildReason(best, [best, alternative])).toBe(
      'Lowest overall exposure: 0.4 mi shorter than Route 2, Route 2 scores 5 higher',
    );
  });

  test('reports a route that is both safest and shortest', () => {
    const best = candidate(1, 2000, 0.2, 80);
    const others = [candidate(2, 2500, 0.3, 70), candidate(3, 2400, 0.35, 65)];

    expect(buildReason(best, others)).toBe('Safest and shortest');
  });

  test('names an avoided dark stretch when an alternative carries a longer poor stretch', () => {
    const best = candidate(1, 2000, 0.25, 75);
    const shorterAlternative = candidate(2, 1800, 0.4, 60, {
      start: ORIGIN,
      end: DESTINATION,
      lengthM: 240,
      cause: 'lighting',
    });
    const saferAlternative = candidate(3, 2600, 0.3, 70);

    expect(buildReason(best, [shorterAlternative, saferAlternative])).toBe(
      'Lowest overall exposure: 0.1 mi longer than Route 2, scores 5 higher than Route 3, avoids a 240 m dark stretch',
    );
  });

  test('states only the route when there are no alternatives', () => {
    const best = candidate(1, 2000, 0.3, 70);

    expect(buildReason(best, [best])).toBe('Only route found');
  });
});

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

const INVALID_EDGE_FIELDS = [
  ['NaN length', { lengthM: NaN }],
  ['negative length', { lengthM: -1 }],
  ['infinite length', { lengthM: Infinity }],
  ['NaN risk', { risk: NaN }],
  ['risk below 0', { risk: -0.01 }],
  ['risk above 1', { risk: 1.01 }],
  ['infinite risk', { risk: Infinity }],
  ['NaN certainty', { certainty: NaN }],
  ['certainty below 0', { certainty: -0.01 }],
  ['certainty above 1', { certainty: 1.01 }],
  ['infinite certainty', { certainty: Infinity }],
];

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

  test('a 300 m risk-0.9 stretch inside a 2 km route scores 68 weighted and 78 mean-only', () => {
    const calm = Array.from({ length: 17 }, () => edge(100, 0.1));
    const dark = edge(300, 0.9, { cause: 'lighting' });
    const route = [...calm.slice(0, 8), dark, ...calm.slice(8)];

    expect(aggregateRoute(route).score).toBe(68);
    expect(aggregateRoute(route, { g: 0 }).score).toBe(78);
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

describe('aggregateRoute input validation', () => {
  test.each(INVALID_EDGE_FIELDS)('throws TypeError for an edge with %s', (_, overrides) => {
    expect(() => aggregateRoute([edge(100, 0.2), edge(300, 0.4, overrides)])).toThrow(TypeError);
  });

  test('still validates zero-length edges, which are otherwise ignored', () => {
    expect(() => aggregateRoute([edge(100, 0.2), edge(0, 1.5)])).toThrow(TypeError);
    expect(() => aggregateRoute([edge(100, 0.2), edge(0, 0.5, { certainty: NaN })])).toThrow(
      TypeError,
    );
  });

  test('accepts the boundary values 0 and 1 for risk and certainty, and zero length', () => {
    expect(() =>
      aggregateRoute([
        edge(0, 0, { certainty: 0 }),
        edge(100, 0, { certainty: 0 }),
        edge(100, 1, { certainty: 1 }),
      ]),
    ).not.toThrow();
  });
});

describe('aggregateRoute certainty and score', () => {
  test('certainty is the length-weighted mean', () => {
    const result = aggregateRoute([
      edge(100, 0.1, { certainty: 1 }),
      edge(300, 0.1, { certainty: 0 }),
    ]);

    expect(result.certainty).toBeCloseTo(0.25, 12);
  });

  test('rounds the score to the nearest integer, not down', () => {
    // 100 * (1 - 0.342) = 65.8: round gives 66, floor would give 65.
    expect(aggregateRoute([edge(100, 0.342)]).score).toBe(66);
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

  test('ignores edges with no cause when choosing the dominant cause', () => {
    const edges = [
      edge(300, 0.9, { cause: null }),
      edge(100, 0.9, { cause: 'crime' }),
    ];

    expect(aggregateRoute(edges).worstStretch.cause).toBe('crime');
  });

  test('has a null cause when no edge in the stretch has one', () => {
    expect(aggregateRoute([edge(300, 0.9, { cause: null })]).worstStretch.cause).toBeNull();
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

  test('uses a custom poorThreshold when one is given', () => {
    const edges = [edge(100, 0.2), edge(300, 0.4, { cause: 'crime' })];

    expect(aggregateRoute(edges).worstStretch).toBeNull();
    expect(aggregateRoute(edges, { poorThreshold: 0.3 }).worstStretch).toEqual({
      start: ORIGIN,
      end: DESTINATION,
      lengthM: 300,
      cause: 'crime',
    });
  });
});

describe('exposure', () => {
  test('is routeRisk times length in kilometres', () => {
    expect(exposure(0.5, 2000)).toBeCloseTo(1.0, 12);
  });
});

describe('rankRoutes', () => {
  test('returns an empty list for no routes', () => {
    expect(rankRoutes([])).toEqual([]);
  });

  test('orders kept routes by exposure, not by routeRisk', () => {
    const ordered = rankRoutes([ranked('B', 1400, 0.25), ranked('A', 1000, 0.3)]);

    expect(ordered.map((r) => r.id)).toEqual(['A', 'B']);
  });

  test('breaks an exposure tie by lower routeRisk first', () => {
    // Both exposures equal exactly 0.75 (0.75 * 1.0 km and 0.5 * 1.5 km), and both
    // lengths are within 1.5x the shortest, so neither is excluded.
    const ordered = rankRoutes([ranked('B', 1000, 0.75), ranked('A', 1500, 0.5)]);

    expect(ordered.map((r) => r.id)).toEqual(['A', 'B']);
  });

  test('breaks a risk tie by shorter length first', () => {
    const ordered = rankRoutes([ranked('long', 2400, 0), ranked('short', 2000, 0)]);

    expect(ordered.map((r) => r.id)).toEqual(['short', 'long']);
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

  test('always keeps the shortest route, and every route tied for shortest', () => {
    const single = rankRoutes([ranked('only', 2000, 0.5)]);
    const tied = rankRoutes([ranked('a', 2000, 0.5), ranked('b', 2000, 0.1)]);

    expect(single[0].excluded).toBe(false);
    expect(tied.every((r) => r.excluded === false)).toBe(true);
  });

  test('attaches exposure to every returned route', () => {
    const ordered = rankRoutes([ranked('short', 2000, 0.5)]);

    expect(ordered[0].exposure).toBeCloseTo(1.0, 12);
  });

  test.each([
    ['zero length', 0],
    ['negative length', -10],
    ['NaN length', NaN],
    ['infinite length', Infinity],
  ])('throws TypeError for a route with %s', (_, lengthM) => {
    expect(() => rankRoutes([ranked('a', 2000, 0.3), { ...ranked('b', 1, 0.3), lengthM }])).toThrow(
      TypeError,
    );
  });

  test.each([
    ['NaN routeRisk', NaN],
    ['infinite routeRisk', Infinity],
  ])('throws TypeError for a route with %s', (_, routeRisk) => {
    expect(() => rankRoutes([ranked('a', 2000, routeRisk)])).toThrow(TypeError);
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

  test('describes a higher score when the lowest-exposure pick is longer but safer', () => {
    const best = candidate(1, 2000, 0.2, 80);
    const alternative = candidate(2, 1500, 0.6, 60);

    expect(buildReason(best, [best, alternative])).toBe(
      'Lowest overall exposure: 0.3 mi longer than Route 2, scores 20 higher than Route 2',
    );
  });

  test('uses "Route N" as the lead when the pick does not have the lowest exposure', () => {
    const best = candidate(1, 2000, 0.3, 70);
    const alternative = candidate(2, 1500, 0.2, 80);

    expect(buildReason(best, [best, alternative])).toBe(
      'Route 1: 0.3 mi longer than Route 2, Route 2 scores 10 higher',
    );
  });

  test('omits the score clause when the runner-up has the same score', () => {
    const best = candidate(1, 2644, 0.25, 75);
    const alternative = candidate(2, 2000, 0.25, 75);

    expect(buildReason(best, [best, alternative])).toBe(
      'Route 1: 0.4 mi longer than Route 2',
    );
  });

  test('says "about the same length" when lengths round to the same tenth of a mile', () => {
    const best = candidate(1, 2000, 0.25, 75);
    const alternative = candidate(2, 2020, 0.2, 80);

    expect(buildReason(best, [best, alternative])).toBe(
      'Route 1: about the same length as Route 2, Route 2 scores 5 higher',
    );
  });

  test('compares only with the runner-up, the best alternative by exposure', () => {
    const best = candidate(1, 3000, 0.1, 90);
    // Equal exposure (1.0): the lower routeRisk (Route 2) must win the runner-up slot
    // even though Route 3 is listed first.
    const alt3 = candidate(3, 1000, 1.0, 0);
    const alt2 = candidate(2, 2000, 0.5, 50);

    expect(buildReason(best, [best, alt3, alt2])).toBe(
      'Lowest overall exposure: 0.6 mi longer than Route 2, scores 40 higher than Route 2',
    );
  });

  test('reports a route that is both safest and shortest', () => {
    const best = candidate(1, 2000, 0.2, 80);
    const others = [candidate(2, 2500, 0.3, 70), candidate(3, 2400, 0.35, 65)];

    expect(buildReason(best, others)).toBe('Safest and shortest');
  });

  test('adds a stretch clause to a safest-and-shortest route', () => {
    const best = candidate(1, 2000, 0.2, 80);
    const alternative = candidate(2, 2500, 0.3, 70, {
      start: ORIGIN,
      end: DESTINATION,
      lengthM: 300,
      cause: 'lighting',
    });

    expect(buildReason(best, [alternative])).toBe('Safest and shortest: avoids a 300 m dark stretch');
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
      'Lowest overall exposure: 0.1 mi longer than Route 2, scores 15 higher than Route 2, avoids a 240 m dark stretch',
    );
  });

  test('uses "high-risk" rather than "dark" when the avoided stretch has another cause', () => {
    const best = candidate(1, 2000, 0.25, 75);
    const alternative = candidate(2, 1800, 0.4, 60, {
      start: ORIGIN,
      end: DESTINATION,
      lengthM: 240,
      cause: 'crime',
    });

    expect(buildReason(best, [alternative])).toBe(
      'Lowest overall exposure: 0.1 mi longer than Route 2, scores 15 higher than Route 2, avoids a 240 m high-risk stretch',
    );
  });

  test('names the longest avoided stretch when several alternatives carry one', () => {
    const best = candidate(1, 2000, 0.25, 75);
    const runnerUp = candidate(2, 1800, 0.4, 60, {
      start: ORIGIN,
      end: DESTINATION,
      lengthM: 240,
      cause: 'lighting',
    });
    const other = candidate(3, 2600, 0.3, 70, {
      start: ORIGIN,
      end: DESTINATION,
      lengthM: 300,
      cause: 'crime',
    });

    const expected =
      'Lowest overall exposure: 0.1 mi longer than Route 2, scores 15 higher than Route 2, avoids a 300 m high-risk stretch';

    // Both input orders must name the 300 m stretch, not whichever came last.
    expect(buildReason(best, [runnerUp, other])).toBe(expected);
    expect(buildReason(best, [other, runnerUp])).toBe(expected);
  });

  test('does not claim an avoided stretch when the best route has a longer one itself', () => {
    const best = candidate(1, 2000, 0.25, 75, {
      start: ORIGIN,
      end: DESTINATION,
      lengthM: 400,
      cause: 'lighting',
    });
    const alternative = candidate(2, 1800, 0.4, 60, {
      start: ORIGIN,
      end: DESTINATION,
      lengthM: 240,
      cause: 'lighting',
    });

    expect(buildReason(best, [alternative])).toBe(
      'Lowest overall exposure: 0.1 mi longer than Route 2, scores 15 higher than Route 2',
    );
  });

  test('names an alternative stretch longer than the best route own stretch', () => {
    const best = candidate(1, 2000, 0.25, 75, {
      start: ORIGIN,
      end: DESTINATION,
      lengthM: 100,
      cause: 'lighting',
    });
    const alternative = candidate(2, 1800, 0.4, 60, {
      start: ORIGIN,
      end: DESTINATION,
      lengthM: 240,
      cause: 'lighting',
    });

    expect(buildReason(best, [alternative])).toBe(
      'Lowest overall exposure: 0.1 mi longer than Route 2, scores 15 higher than Route 2, avoids a 240 m dark stretch',
    );
  });

  test('states only the route when there are no alternatives', () => {
    const best = candidate(1, 2000, 0.3, 70);

    expect(buildReason(best, [best])).toBe('Only route found');
  });

  test.each([
    ['NaN score', { score: NaN }],
    ['infinite routeRisk', { routeRisk: Infinity }],
    ['NaN lengthM', { lengthM: NaN }],
  ])('throws TypeError rather than printing NaN for an alternative with %s', (_, overrides) => {
    const best = candidate(1, 2000, 0.3, 70);
    const bad = { ...candidate(2, 2600, 0.2, 80), ...overrides };

    expect(() => buildReason(best, [best, bad])).toThrow(TypeError);
  });

  test('throws TypeError for a non-finite stretch length on the best route', () => {
    const best = candidate(1, 2000, 0.3, 70, {
      start: ORIGIN,
      end: DESTINATION,
      lengthM: NaN,
      cause: 'lighting',
    });

    expect(() => buildReason(best, [candidate(2, 2600, 0.2, 80)])).toThrow(TypeError);
  });
});

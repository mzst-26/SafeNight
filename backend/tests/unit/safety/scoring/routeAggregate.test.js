const {
  aggregateRoute,
  exposure,
  rankRoutes,
  buildReason,
} = require('../../../../src/safety/scoring/routeAggregate');
const { createSeededRandom } = require('./seededRandom');

const TOLERANCE = 1e-9;
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

      expect(Math.abs(splitRisk - original)).toBeLessThan(TOLERANCE);
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

      expect(Math.abs(aggregateRoute(edges).routeRisk - risk)).toBeLessThan(TOLERANCE);
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

describe('aggregateRoute option validation', () => {
  test.each([
    ['g below 0', -0.1],
    ['g above 1', 1.1],
    ['g NaN', NaN],
    ['g infinite', Infinity],
  ])('throws TypeError for %s', (_name, g) => {
    expect(() => aggregateRoute([edge(100, 0.2)], { g })).toThrow(TypeError);
  });

  test('accepts g at exactly 0 and exactly 1', () => {
    expect(() => aggregateRoute([edge(100, 0.2)], { g: 0 })).not.toThrow();
    expect(() => aggregateRoute([edge(100, 0.2)], { g: 1 })).not.toThrow();
  });

  test.each([
    ['zero', 0],
    ['negative', -0.1],
    ['above 1', 1.5],
    ['NaN', NaN],
    ['infinite', Infinity],
  ])('throws TypeError for a poorThreshold that is %s', (_name, poorThreshold) => {
    expect(() => aggregateRoute([edge(100, 0.2)], { poorThreshold })).toThrow(TypeError);
  });

  test('accepts a poorThreshold of exactly 1', () => {
    expect(aggregateRoute([edge(100, 1)], { poorThreshold: 1 }).worstStretch).not.toBeNull();
  });
});

describe('length cap', () => {
  test('rejects an edge longer than 1e7 m and accepts exactly 1e7 m', () => {
    expect(() => aggregateRoute([edge(1e7 + 1, 0.2)])).toThrow(TypeError);
    expect(() => aggregateRoute([edge(1e7, 0.2)])).not.toThrow();
  });

  test('rankRoutes rejects a route longer than 1e7 m and accepts exactly 1e7 m', () => {
    expect(() => rankRoutes([ranked('a', 1e7 + 1, 0.2)])).toThrow(TypeError);
    expect(() => rankRoutes([ranked('a', 1e7, 0.2)])).not.toThrow();
  });
});

describe('score rounding and ties', () => {
  test('rounds an exact half up: routeRisk 0.125 gives 88 and 0.875 gives 13', () => {
    // g = 0 makes routeRisk equal the mean, so the half-point is exact in floating point.
    expect(aggregateRoute([edge(100, 0.125)], { g: 0 }).score).toBe(88);
    expect(aggregateRoute([edge(100, 0.875)], { g: 0 }).score).toBe(13);
  });

  test('a length tie between two causes in one run picks the cause that appears first', () => {
    const edges = [
      edge(100, 0.9, { cause: 'crime' }),
      edge(100, 0.9, { cause: 'lighting' }),
    ];

    expect(aggregateRoute(edges).worstStretch.cause).toBe('crime');
  });

  test('a length tie between two poor stretches picks the first stretch', () => {
    const firstStart = { lat: 1, lng: 1 };
    const firstEnd = { lat: 1.1, lng: 1.1 };
    const secondStart = { lat: 2, lng: 2 };
    const secondEnd = { lat: 2.1, lng: 2.1 };
    const edges = [
      edge(200, 0.9, { cause: 'crime', start: firstStart, end: firstEnd }),
      edge(100, 0.1),
      edge(200, 0.9, { cause: 'lighting', start: secondStart, end: secondEnd }),
    ];

    expect(aggregateRoute(edges).worstStretch).toEqual({
      start: firstStart,
      end: firstEnd,
      lengthM: 200,
      cause: 'crime',
    });
  });

  test('property: routeRisk stays within [0, 1] for every blend g when every edge is fully risky', () => {
    const rand = createSeededRandom(5);

    for (let trial = 0; trial < 500; trial++) {
      const g = rand();
      const edges = [edge(100, 1), edge(50 + rand() * 100, 1)];

      expect(aggregateRoute(edges, { g }).routeRisk).toBeLessThanOrEqual(1);
    }
  });
});

describe('MAX_LENGTH_RATIO comes from config', () => {
  test('rankRoutes applies the configured ratio, not a private copy of it', () => {
    const configPath = '../../../../src/safety/scoring/config';
    let rankWithConfig;
    jest.isolateModules(() => {
      jest.doMock(configPath, () => ({ ...jest.requireActual(configPath), MAX_LENGTH_RATIO: 2.5 }));
      rankWithConfig = require('../../../../src/safety/scoring/routeAggregate').rankRoutes;
    });
    jest.dontMock(configPath);

    // With a ratio of 2.5, a route at 2.4x the shortest is kept and one at 2.6x is excluded.
    const ordered = rankWithConfig([
      ranked('short', 2000, 0.5),
      ranked('kept', 4800, 0.1),
      ranked('dropped', 5200, 0.1),
    ]);

    expect(ordered.find((r) => r.id === 'kept').excluded).toBe(false);
    expect(ordered.find((r) => r.id === 'dropped').excluded).toBe(true);
  });
});

describe('exposure validation', () => {
  test.each([
    ['routeRisk below 0', -0.1, 1000],
    ['routeRisk above 1', 1.1, 1000],
    ['NaN routeRisk', NaN, 1000],
    ['negative length', 0.5, -1],
    ['NaN length', 0.5, NaN],
  ])('throws TypeError for %s', (_name, routeRisk, lengthM) => {
    expect(() => exposure(routeRisk, lengthM)).toThrow(TypeError);
  });

  test('accepts zero length and the boundary risks', () => {
    expect(exposure(0, 0)).toBe(0);
    expect(exposure(1, 1000)).toBe(1);
  });
});

describe('rankRoutes input validation', () => {
  test.each([
    ['null', null],
    ['a string', 'routes'],
    ['an object', { length: 1 }],
  ])('throws TypeError with the array message when routes is %s', (_name, routes) => {
    expect(() => rankRoutes(routes)).toThrow(new TypeError('routes must be an array'));
  });

  test.each([
    ['routeRisk below 0', -0.01],
    ['routeRisk above 1', 1.01],
  ])('throws TypeError for a route with %s', (_name, routeRisk) => {
    expect(() => rankRoutes([ranked('a', 2000, routeRisk)])).toThrow(TypeError);
  });

  test('excludes a route at 2.1x the shortest and keeps one at exactly 2.0x', () => {
    const ordered = rankRoutes([
      ranked('short', 2000, 0.5),
      ranked('edge', 4000, 0.1),
      ranked('over', 4200, 0.1),
    ]);

    expect(ordered.find((r) => r.id === 'edge').excluded).toBe(false);
    expect(ordered.find((r) => r.id === 'over').excluded).toBe(true);
  });
});

describe('exposure', () => {
  // exposure = routeRisk * (lengthKm) ^ LENGTH_EXPOSURE_EXPONENT, with the exponent 0.5 from config.

  test('is routeRisk times the square root of length in kilometres', () => {
    // 0.5 * sqrt(2.0) = 0.70711
    expect(exposure(0.5, 2000)).toBeCloseTo(0.5 * Math.SQRT2, 12);
  });

  test('the 650 m route at risk 0.301 has lower exposure than the 383 m route at risk 0.775', () => {
    // 0.775 * sqrt(0.383) = 0.47962 and 0.301 * sqrt(0.650) = 0.24267.
    expect(exposure(0.775, 383)).toBeCloseTo(0.47962, 4);
    expect(exposure(0.301, 650)).toBeCloseTo(0.24267, 4);
    expect(exposure(0.301, 650)).toBeLessThan(exposure(0.775, 383));
  });

  test('is monotone: rises with routeRisk at fixed length and with length at fixed routeRisk', () => {
    const rand = createSeededRandom(7);

    for (let trial = 0; trial < 300; trial++) {
      const lengthM = 1 + rand() * 5000;
      const lowRisk = rand() * 0.5;
      const highRisk = lowRisk + rand() * (1 - lowRisk);
      expect(exposure(lowRisk, lengthM)).toBeLessThanOrEqual(exposure(highRisk, lengthM));

      const risk = rand();
      const shortM = 1 + rand() * 5000;
      const longM = shortM + rand() * 5000;
      expect(exposure(risk, shortM)).toBeLessThanOrEqual(exposure(risk, longM));
    }
  });

  test('is zero at zero risk for any length, and at zero length for any risk', () => {
    expect(exposure(0, 5000)).toBe(0);
    expect(exposure(0.9, 0)).toBe(0);
  });
});

describe('rankRoutes', () => {
  test('returns an empty list for no routes', () => {
    expect(rankRoutes([])).toEqual([]);
  });

  test('orders kept routes by exposure, not by routeRisk', () => {
    // Exposures: X = 0.5 * sqrt(1.0) = 0.5 and Y = 0.45 * sqrt(1.4) = 0.53245. Y has the lower
    // routeRisk but the higher exposure, so X ranks first.
    const ordered = rankRoutes([ranked('Y', 1400, 0.45), ranked('X', 1000, 0.5)]);

    expect(ordered.map((r) => r.id)).toEqual(['X', 'Y']);
  });

  test('breaks an exposure tie by lower routeRisk first', () => {
    // Both exposures equal exactly 1.3125: B = 0.875 * sqrt(2.25) = 0.875 * 1.5 and
    // A = 0.75 * sqrt(3.0625) = 0.75 * 1.75. A is 1.36x B, so both are within the 1.5x cap.
    // A has the lower routeRisk, so A ranks first.
    const ordered = rankRoutes([ranked('B', 2250, 0.875), ranked('A', 3062.5, 0.75)]);

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

  test('with equal risk the shorter route wins at every length up to 1.5x the shortest', () => {
    const rand = createSeededRandom(8);

    for (let trial = 0; trial < 100; trial++) {
      const risk = rand();
      const shortM = 500 + rand() * 1500;
      const longM = shortM * (1 + rand() * 0.5);
      const ordered = rankRoutes([ranked('long', longM, risk), ranked('short', shortM, risk)]);

      expect(ordered.map((r) => r.id)).toEqual(['short', 'long']);
    }
  });

  test('a route 1.4x longer wins when its risk is 15.5% lower (just inside the boundary)', () => {
    // 0.4225 * sqrt(1.4) = 0.49991 is below 0.5 * sqrt(1.0) = 0.5. 0.4225 is 15.50% below 0.5.
    // The break-even is 1 - 1/sqrt(1.4) = 15.48% lower.
    const ordered = rankRoutes([ranked('short', 1000, 0.5), ranked('long', 1400, 0.4225)]);

    expect(ordered.map((r) => r.id)).toEqual(['long', 'short']);
  });

  test('a route 1.4x longer loses when its risk is only 15.4% lower (just outside the boundary)', () => {
    // 0.423 * sqrt(1.4) = 0.50050 is above 0.5, so the shorter route stays first.
    // 0.423 is 15.40% below 0.5.
    const ordered = rankRoutes([ranked('short', 1000, 0.5), ranked('long', 1400, 0.423)]);

    expect(ordered.map((r) => r.id)).toEqual(['short', 'long']);
  });

  test('ranks a 650 m route at risk 0.301 ahead of a 500 m route at risk 0.775', () => {
    // A 500 m shorter route, so the 650 m route is 1.3x. The literal 383 m pair is in the next test.
    // Exposures: 0.775 * sqrt(0.5) = 0.54801 and 0.301 * sqrt(0.65) = 0.24267.
    const ordered = rankRoutes([ranked('dark', 500, 0.775), ranked('safe', 650, 0.301)]);

    expect(ordered.map((r) => r.id)).toEqual(['safe', 'dark']);
    expect(ordered.every((r) => r.excluded === false)).toBe(true);
  });

  test('the 650 m route at risk 0.301 is Safest beside the 383 m route at risk 0.775', () => {
    // 650 m is 1.70x the 383 m route, inside the 2.0x cap, so both are kept.
    // Exposures: 650 m = 0.301 * sqrt(0.650) = 0.24267 and 383 m = 0.775 * sqrt(0.383) = 0.47962.
    // The 650 m route has the lower exposure, so it ranks first and is not excluded.
    const ordered = rankRoutes([ranked('dark', 383, 0.775), ranked('safe', 650, 0.301)]);

    expect(ordered.map((r) => r.id)).toEqual(['safe', 'dark']);
    expect(ordered.every((r) => r.excluded === false)).toBe(true);
  });

  test('the Safest 650 m route reads as lowest exposure against the 383 m route', () => {
    // Displayed scores are 70 for 650 m and 22 for 383 m. 267 m is 0.17 mi, shown as 0.2 mi.
    // 70 - 22 = 48 points higher. The 650 m route is longer, so no "shorter" clause appears.
    const safe = candidate(1, 650, 0.301, 70);
    const dark = candidate(2, 383, 0.775, 22);

    expect(buildReason(safe, [safe, dark])).toBe(
      'Lowest overall exposure: 0.2 mi longer than Route 2, scores 48 higher than Route 2',
    );
  });

  test('excludes a route over 2.0x the shortest even when it is safer per metre, listing it last', () => {
    // 4500 m is 2.25x the 2000 m route, over the cap.
    const ordered = rankRoutes([ranked('far', 4500, 0.1), ranked('short', 2000, 0.5)]);

    expect(ordered.map((r) => r.id)).toEqual(['short', 'far']);
    expect(ordered[0].excluded).toBe(false);
    expect(ordered[1].excluded).toBe(true);
  });

  test('keeps a route exactly 2.0x the shortest', () => {
    const ordered = rankRoutes([ranked('short', 2000, 0.5), ranked('edge', 4000, 0.1)]);

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

    // 0.5 * sqrt(2.0) = 0.70711
    expect(ordered[0].exposure).toBeCloseTo(0.5 * Math.SQRT2, 12);
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
    // Exposures: best 0.3 * sqrt(2.0) = 0.42426 and alternative 0.25 * sqrt(2.9) = 0.42573, so best is lower.
    // 900 m is 0.56 mi, shown as 0.6 mi.
    const best = candidate(1, 2000, 0.3, 70);
    const alternative = candidate(2, 2900, 0.25, 75);

    expect(buildReason(best, [best, alternative])).toBe(
      'Lowest overall exposure: 0.6 mi shorter than Route 2, Route 2 scores 5 higher',
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
    // Exposures: Route 3 is 1.0 (1.0 * sqrt(1.0)) and Route 2 is 0.71 (0.5 * sqrt(2.0)).
    // Route 3 is listed first but has the higher exposure, so Route 2 must be the runner-up.
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

  test('names an avoided dark stretch when the runner-up carries a longer poor stretch', () => {
    // Exposures: Route 2 is 0.4 * sqrt(1.8) = 0.53666 and Route 3 is 0.35 * sqrt(2.6) = 0.56436,
    // so Route 2 is the runner-up and its 240 m stretch is the one named.
    const best = candidate(1, 2000, 0.25, 75);
    const shorterAlternative = candidate(2, 1800, 0.4, 60, {
      start: ORIGIN,
      end: DESTINATION,
      lengthM: 240,
      cause: 'lighting',
    });
    const saferAlternative = candidate(3, 2600, 0.35, 65);

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

  test('names only the runner-up stretch, not a longer one on another alternative, in either order', () => {
    // Exposures: Route 2 is 0.53666 (the runner-up) and Route 3 is 0.56436. Route 3 carries the
    // longer (300 m) stretch, but it is not compared, so Route 2's 240 m dark stretch is named.
    const best = candidate(1, 2000, 0.25, 75);
    const runnerUp = candidate(2, 1800, 0.4, 60, {
      start: ORIGIN,
      end: DESTINATION,
      lengthM: 240,
      cause: 'lighting',
    });
    const other = candidate(3, 2600, 0.35, 65, {
      start: ORIGIN,
      end: DESTINATION,
      lengthM: 300,
      cause: 'crime',
    });

    const expected =
      'Lowest overall exposure: 0.1 mi longer than Route 2, scores 15 higher than Route 2, avoids a 240 m dark stretch';

    expect(buildReason(best, [runnerUp, other])).toBe(expected);
    expect(buildReason(best, [other, runnerUp])).toBe(expected);
  });

  test('does not name a stretch carried only by an alternative that is not the runner-up', () => {
    // Route 2 (exposure 0.53666) is the runner-up and has no poor stretch. Route 3 (0.56436)
    // carries a 300 m stretch but is not the runner-up, so the reason must not mention it.
    const best = candidate(1, 2000, 0.25, 75);
    const runnerUp = candidate(2, 1800, 0.4, 60);
    const other = candidate(3, 2600, 0.35, 65, {
      start: ORIGIN,
      end: DESTINATION,
      lengthM: 300,
      cause: 'crime',
    });

    expect(buildReason(best, [runnerUp, other])).toBe(
      'Lowest overall exposure: 0.1 mi longer than Route 2, scores 15 higher than Route 2',
    );
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

  test('decides "Safest and shortest" on routeRisk, not on the rounded score', () => {
    // Both round to a score of 80, but Route 2 has the lower routeRisk, so Route 1 is not the safest.
    const best = candidate(1, 2000, 0.2001, 80);
    const alternative = candidate(2, 2500, 0.2, 80);

    expect(buildReason(best, [best, alternative])).toBe(
      'Lowest overall exposure: 0.3 mi shorter than Route 2',
    );
  });

  test('is "Safest and shortest" when routeRisk ties and the route is shortest', () => {
    const best = candidate(1, 2000, 0.2, 80);
    const alternative = candidate(2, 2500, 0.2, 80);

    expect(buildReason(best, [best, alternative])).toBe('Safest and shortest');
  });

  test('is "Safest and shortest" when the lengths tie and the route is safer', () => {
    const best = candidate(1, 2000, 0.2, 80);
    const alternative = candidate(2, 2000, 0.3, 70);

    expect(buildReason(best, [best, alternative])).toBe('Safest and shortest');
  });

  test('omits the "avoids" clause when the alternative stretch is the same length as the best stretch', () => {
    const best = candidate(1, 2000, 0.25, 75, {
      start: ORIGIN,
      end: DESTINATION,
      lengthM: 240,
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

  test('prints a gap of exactly one mile (1609.344 m) as 1.0 mi', () => {
    const best = candidate(1, 2609.344, 0.1, 90);
    const alternative = candidate(2, 1000, 0.5, 50);

    expect(buildReason(best, [best, alternative])).toBe(
      'Lowest overall exposure: 1.0 mi longer than Route 2, scores 40 higher than Route 2',
    );
  });

  test('rounds the length gap to the nearest tenth of a mile: 0.96 mi prints 1.0 and 0.94 mi prints 0.9', () => {
    const other = candidate(2, 1000, 0.5, 50);
    const near = candidate(1, 1000 + 0.96 * 1609.344, 0.1, 90);
    const less = candidate(1, 1000 + 0.94 * 1609.344, 0.1, 90);

    expect(buildReason(near, [near, other])).toMatch(/^Lowest overall exposure: 1\.0 mi longer than Route 2,/);
    expect(buildReason(less, [less, other])).toMatch(/^Lowest overall exposure: 0\.9 mi longer than Route 2,/);
  });

  test('leads with "Lowest overall exposure" when the best exposure ties the runner-up', () => {
    // Both exposures are exactly 0.75: best 0.5 * sqrt(2.25) = 0.5 * 1.5 and alternative 0.75 * sqrt(1.0).
    // 1250 m is 0.78 mi, shown as 0.8 mi.
    const best = candidate(1, 2250, 0.5, 50);
    const alternative = candidate(2, 1000, 0.75, 25);

    expect(buildReason(best, [best, alternative])).toBe(
      'Lowest overall exposure: 0.8 mi longer than Route 2, scores 25 higher than Route 2',
    );
  });

  test('the "Safest and shortest" stretch clause also uses only the runner-up', () => {
    // Route 2 (exposure 0.47434) is the runner-up and has no poor stretch. Route 3 (0.54222)
    // carries a 300 m stretch but is not compared, so no avoids clause is added.
    const best = candidate(1, 2000, 0.2, 80);
    const runnerUp = candidate(2, 2500, 0.3, 70);
    const other = candidate(3, 2400, 0.35, 65, {
      start: ORIGIN,
      end: DESTINATION,
      lengthM: 300,
      cause: 'lighting',
    });

    expect(buildReason(best, [runnerUp, other])).toBe('Safest and shortest');
  });

  test('says "scores 1 higher" for a one-point gap', () => {
    const best = candidate(1, 2000, 0.24, 76);
    const alternative = candidate(2, 1500, 0.25, 75);

    expect(buildReason(best, [best, alternative])).toBe(
      'Route 1: 0.3 mi longer than Route 2, scores 1 higher than Route 2',
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

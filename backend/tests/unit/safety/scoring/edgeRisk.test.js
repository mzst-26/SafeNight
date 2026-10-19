const { edgeRisk } = require('../../../../src/safety/scoring/edgeRisk');
const { EPS, N0, CAUSE_MIN_RISK } = require('../../../../src/safety/scoring/config');
const { createSeededRandom } = require('./seededRandom');

const FACTORS = ['lighting', 'crime', 'road', 'activity', 'isolation'];
const WEIGHTS = { lighting: 0.3, crime: 0.25, road: 0.15, activity: 0.18, isolation: 0.12 };
const TOLERANCE = 1e-9;

function allFactors(safety, n = 10) {
  return Object.fromEntries(FACTORS.map((name) => [name, { safety, n }]));
}

function randomSafety(random) {
  return random() < 0.1 ? null : random();
}

function randomFactors(random) {
  return Object.fromEntries(
    FACTORS.map((name) => [name, { safety: randomSafety(random), n: random() * 50 }]),
  );
}

describe('edgeRisk', () => {
  test('all factors perfectly safe gives risk 0', () => {
    const result = edgeRisk({ factors: allFactors(1), weights: WEIGHTS });

    expect(result.risk).toBeCloseTo(0, 12);
    expect(result.dominantCause).toBeNull();
  });

  test('one factor at safety 0 with the rest at 1 gives risk 1 - eps^w, not 1', () => {
    const factors = { ...allFactors(1), crime: { safety: 0, n: 10 } };
    const result = edgeRisk({ factors, weights: WEIGHTS });

    expect(result.risk).toBeCloseTo(1 - Math.pow(EPS, WEIGHTS.crime), 12);
    expect(result.risk).toBeLessThan(1);
    expect(result.dominantCause).toBe('crime');
  });

  test('an unavailable (null) factor is skipped, not treated as 0 or 1', () => {
    const withNull = {
      ...allFactors(0.8),
      lighting: { safety: null, n: 0 },
    };
    const withoutLighting = { ...allFactors(0.8) };
    delete withoutLighting.lighting;

    const restricted = edgeRisk({ factors: withNull, weights: WEIGHTS });
    const missing = edgeRisk({ factors: withoutLighting, weights: WEIGHTS });

    expect(restricted.risk).toBeCloseTo(missing.risk, 12);
    expect(restricted.certainty).toBeCloseTo(missing.certainty, 12);
    // Every available factor has safety 0.8, so the renormalised exponents sum to 1.
    expect(restricted.risk).toBeCloseTo(0.2, 9);
  });

  test('renormalises weights over available factors', () => {
    const factors = { lighting: { safety: 0.2, n: 10 }, crime: { safety: 0.6, n: 10 } };
    const result = edgeRisk({ factors, weights: WEIGHTS });

    const expectedRisk = 1 - Math.pow(0.2, 0.3 / 0.55) * Math.pow(0.6, 0.25 / 0.55);
    expect(result.risk).toBeCloseTo(expectedRisk, 12);
  });

  test('no available factors gives risk 0.5 with certainty 0', () => {
    const factors = Object.fromEntries(FACTORS.map((name) => [name, { safety: null, n: 0 }]));
    const result = edgeRisk({ factors, weights: WEIGHTS });

    expect(result).toEqual({ risk: 0.5, certainty: 0, dominantCause: null });
  });

  test('empty factors object gives risk 0.5 with certainty 0', () => {
    const result = edgeRisk({ factors: {}, weights: WEIGHTS });

    expect(result).toEqual({ risk: 0.5, certainty: 0, dominantCause: null });
  });

  test('only zero-weight factors available (pure daylight lighting) behaves as none available', () => {
    const weights = { ...WEIGHTS, lighting: 0 };
    const factors = { lighting: { safety: 0, n: 100 } };
    const result = edgeRisk({ factors, weights });

    expect(result).toEqual({ risk: 0.5, certainty: 0, dominantCause: null });
  });

  test('daylight (lighting weight 0) makes lighting irrelevant to risk', () => {
    const daylightWeights = { lighting: 0, crime: 0.4, road: 0.25, activity: 0.2, isolation: 0.15 };
    const dark = { ...allFactors(0.7), lighting: { safety: 0, n: 1 } };
    const lit = { ...allFactors(0.7), lighting: { safety: 1, n: 50 } };

    const darkResult = edgeRisk({ factors: dark, weights: daylightWeights });
    const litResult = edgeRisk({ factors: lit, weights: daylightWeights });

    expect(darkResult.risk).toBeCloseTo(litResult.risk, 12);
    expect(darkResult.certainty).toBeCloseTo(litResult.certainty, 12);
    expect(darkResult.dominantCause).toBe(litResult.dominantCause);
  });

  test('certainty is the weight-averaged n / (n + N0) over available factors', () => {
    const factors = {
      lighting: { safety: 0.5, n: N0 },
      crime: { safety: 0.5, n: 0 },
    };
    const result = edgeRisk({ factors, weights: WEIGHTS });

    const expected = (0.3 * 0.5 + 0.25 * 0) / (0.3 + 0.25);
    expect(result.certainty).toBeCloseTo(expected, 12);
  });

  test('dominantCause is the factor with the largest weighted contribution to risk', () => {
    // road has the lowest raw safety, but crime's larger weight gives it the bigger contribution:
    // 0.25 * -ln(0.3) = 0.30 beats 0.15 * -ln(0.2) = 0.24.
    const factors = {
      lighting: { safety: 0.9, n: 10 },
      crime: { safety: 0.3, n: 10 },
      road: { safety: 0.2, n: 10 },
      activity: { safety: 0.9, n: 10 },
      isolation: { safety: 0.9, n: 10 },
    };
    const result = edgeRisk({ factors, weights: WEIGHTS });

    expect(result.dominantCause).toBe('crime');
  });

  test('dominantCause is null when risk is below CAUSE_MIN_RISK', () => {
    const result = edgeRisk({ factors: allFactors(0.95), weights: WEIGHTS });

    expect(result.risk).toBeLessThan(CAUSE_MIN_RISK);
    expect(result.dominantCause).toBeNull();
  });

  test('dominantCause is set once risk reaches CAUSE_MIN_RISK', () => {
    const result = edgeRisk({ factors: allFactors(0.5), weights: WEIGHTS });

    expect(result.risk).toBeGreaterThanOrEqual(CAUSE_MIN_RISK);
    expect(result.dominantCause).toBe('lighting');
  });

  test('property: risk is always within [0, 1]', () => {
    const random = createSeededRandom(7);

    for (let i = 0; i < 2000; i += 1) {
      const { risk } = edgeRisk({ factors: randomFactors(random), weights: WEIGHTS });

      expect(risk).toBeGreaterThanOrEqual(0);
      expect(risk).toBeLessThanOrEqual(1);
    }
  });

  test('property: certainty is always within [0, 1]', () => {
    const random = createSeededRandom(11);

    for (let i = 0; i < 2000; i += 1) {
      const { certainty } = edgeRisk({ factors: randomFactors(random), weights: WEIGHTS });

      expect(certainty).toBeGreaterThanOrEqual(0);
      expect(certainty).toBeLessThanOrEqual(1);
    }
  });

  test('property: raising any factor safety never raises risk', () => {
    const random = createSeededRandom(42);

    for (let i = 0; i < 1000; i += 1) {
      const factors = randomFactors(random);
      const name = FACTORS[Math.floor(random() * FACTORS.length)];
      if (factors[name].safety === null) continue;

      const lower = random() * (factors[name].safety === null ? 1 : factors[name].safety);
      const higher = lower + (1 - lower) * random();
      const riskAt = (safety) =>
        edgeRisk({
          factors: { ...factors, [name]: { ...factors[name], safety } },
          weights: WEIGHTS,
        }).risk;

      expect(riskAt(higher)).toBeLessThanOrEqual(riskAt(lower) + TOLERANCE);
    }
  });

  test('property: a factor at safety 1 never raises risk compared with it being unavailable', () => {
    const random = createSeededRandom(99);

    for (let i = 0; i < 500; i += 1) {
      const factors = randomFactors(random);
      const name = FACTORS[Math.floor(random() * FACTORS.length)];
      const withNull = { ...factors, [name]: { safety: null, n: 0 } };
      const withOne = { ...factors, [name]: { safety: 1, n: 0 } };

      const nullRisk = edgeRisk({ factors: withNull, weights: WEIGHTS }).risk;
      const oneRisk = edgeRisk({ factors: withOne, weights: WEIGHTS }).risk;

      expect(oneRisk).toBeLessThanOrEqual(nullRisk + TOLERANCE);
    }
  });

  test('all-unavailable (every factor null) gives risk 0.5 and certainty 0', () => {
    const random = createSeededRandom(3);

    for (let i = 0; i < 100; i += 1) {
      const factors = Object.fromEntries(
        FACTORS.map((name) => [name, { safety: null, n: random() * 100 }]),
      );
      const result = edgeRisk({ factors, weights: WEIGHTS });

      expect(result.risk).toBe(0.5);
      expect(result.certainty).toBe(0);
    }
  });
});

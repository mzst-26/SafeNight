const {
  severityOf,
  recencyWeight,
  weightedCrimeCount,
  crimeRisk,
  RATE_SCALE,
} = require('../../../../src/safety/scoring/crimeRisk');

/** Deterministic PRNG so property tests are reproducible. */
function makeRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

describe('severityOf', () => {
  test('returns the table severity for a known category', () => {
    expect(severityOf('violent-crime')).toBe(1.0);
    expect(severityOf('shoplifting')).toBe(0.2);
  });

  test('unknown category falls back to 0.3', () => {
    expect(severityOf('not-a-category')).toBe(0.3);
    expect(severityOf(undefined)).toBe(0.3);
  });

  test('does not resolve inherited object keys as categories', () => {
    expect(severityOf('constructor')).toBe(0.3);
    expect(severityOf('toString')).toBe(0.3);
  });

  test('violent crime is more severe than shoplifting', () => {
    expect(severityOf('violent-crime')).toBeGreaterThan(severityOf('shoplifting'));
  });
});

describe('recencyWeight', () => {
  test('is 1 for a crime in the current month', () => {
    expect(recencyWeight(0)).toBe(1);
  });

  test('halves after exactly one half-life', () => {
    expect(recencyWeight(4, 4)).toBeCloseTo(0.5, 12);
    expect(recencyWeight(6, 6)).toBeCloseTo(0.5, 12);
  });

  test('defaults the half-life to 4 months', () => {
    expect(recencyWeight(4)).toBeCloseTo(0.5, 12);
    expect(recencyWeight(8)).toBeCloseTo(0.25, 12);
  });

  test('an infinite half-life gives weight 1 at any age', () => {
    expect(recencyWeight(0, Infinity)).toBe(1);
    expect(recencyWeight(12, Infinity)).toBe(1);
  });

  test('weight decreases as the crime gets older', () => {
    const ages = [0, 1, 2, 3, 6, 12];
    const weights = ages.map((age) => recencyWeight(age, 4));
    for (let i = 1; i < weights.length; i += 1) {
      expect(weights[i]).toBeLessThan(weights[i - 1]);
    }
  });

  test('throws TypeError on negative or non-finite age', () => {
    expect(() => recencyWeight(-1)).toThrow(TypeError);
    expect(() => recencyWeight(NaN)).toThrow(TypeError);
    expect(() => recencyWeight(Infinity)).toThrow(TypeError);
  });

  test('throws TypeError on non-positive or NaN half-life', () => {
    expect(() => recencyWeight(1, 0)).toThrow(TypeError);
    expect(() => recencyWeight(1, -4)).toThrow(TypeError);
    expect(() => recencyWeight(1, NaN)).toThrow(TypeError);
  });
});

describe('weightedCrimeCount', () => {
  test('is 0 for no crimes', () => {
    expect(weightedCrimeCount([])).toBe(0);
  });

  test('sums severity multiplied by recency weight', () => {
    const crimes = [
      { category: 'violent-crime', monthsAgo: 0 },
      { category: 'shoplifting', monthsAgo: 4 },
    ];
    const expected = 1.0 * 1 + 0.2 * 0.5;
    expect(weightedCrimeCount(crimes)).toBeCloseTo(expected, 12);
  });

  test('uses halfLifeMonths from options', () => {
    const crimes = [{ category: 'burglary', monthsAgo: 4 }];
    expect(weightedCrimeCount(crimes, { halfLifeMonths: 2 })).toBeCloseTo(0.5 * 0.25, 12);
  });

  test('an infinite half-life counts every crime at full recency weight', () => {
    const crimes = [
      { category: 'violent-crime', monthsAgo: 0 },
      { category: 'violent-crime', monthsAgo: 11 },
    ];
    expect(weightedCrimeCount(crimes, { halfLifeMonths: Infinity })).toBeCloseTo(2, 12);
  });

  test('skips entries with non-finite monthsAgo', () => {
    const crimes = [
      { category: 'violent-crime', monthsAgo: 0 },
      { category: 'violent-crime', monthsAgo: NaN },
      { category: 'violent-crime', monthsAgo: Infinity },
      { category: 'violent-crime', monthsAgo: undefined },
    ];
    expect(weightedCrimeCount(crimes)).toBe(1);
  });

  test('unknown categories contribute the fallback severity', () => {
    expect(weightedCrimeCount([{ category: 'mystery', monthsAgo: 0 }])).toBeCloseTo(0.3, 12);
  });

  test('throws TypeError when crimes is not an array', () => {
    expect(() => weightedCrimeCount(null)).toThrow(TypeError);
    expect(() => weightedCrimeCount({})).toThrow(TypeError);
  });
});

describe('crimeRisk', () => {
  test('computes the empirical-Bayes rate and risk for an ok cell', () => {
    // rate = (weightedCount + k*priorRate) / (exposureKm + k) = (6 + 2*1) / (2 + 2) = 2
    const result = crimeRisk({ weightedCount: 6, exposureKm: 2, priorRate: 1, priorStrength: 2, status: 'ok' });
    expect(result.lambda).toBeCloseTo(2, 12);
    expect(result.risk).toBeCloseTo(1 - Math.exp(-2 / RATE_SCALE), 12);
    expect(result.n).toBeCloseTo(0.5, 12);
    expect(result.status).toBe('ok');
  });

  test('risk is about 0.63 when the rate equals RATE_SCALE', () => {
    const result = crimeRisk({ weightedCount: 12, exposureKm: 0, priorRate: 0, priorStrength: 2, status: 'ok' });
    expect(result.lambda).toBeCloseTo(RATE_SCALE, 12);
    expect(result.risk).toBeCloseTo(1 - Math.exp(-1), 12);
  });

  test('defaults priorStrength to 2', () => {
    const withDefault = crimeRisk({ weightedCount: 4, exposureKm: 1, priorRate: 3, status: 'ok' });
    const explicit = crimeRisk({ weightedCount: 4, exposureKm: 1, priorRate: 3, priorStrength: 2, status: 'ok' });
    expect(withDefault).toEqual(explicit);
  });

  test('zero crimes and zero exposure shrink fully to the prior', () => {
    const result = crimeRisk({ weightedCount: 0, exposureKm: 0, priorRate: 3, priorStrength: 2, status: 'ok' });
    expect(result.lambda).toBeCloseTo(3, 12);
    expect(result.n).toBe(0);
  });

  test('zero crimes, zero prior is zero risk', () => {
    const result = crimeRisk({ weightedCount: 0, exposureKm: 1, priorRate: 0, status: 'ok' });
    expect(result).toEqual({ risk: 0, lambda: 0, n: 1 / 3, status: 'ok' });
  });

  test('unavailable uses only the prior, with n = 0', () => {
    const result = crimeRisk({ weightedCount: 50, exposureKm: 10, priorRate: 2, priorStrength: 2, status: 'unavailable' });
    expect(result.lambda).toBe(2);
    expect(result.n).toBe(0);
    expect(result.risk).toBeCloseTo(1 - Math.exp(-2 / RATE_SCALE), 12);
    expect(result.status).toBe('unavailable');
  });

  test('unavailable is never lower risk than ok with zero crimes when priorRate > 0', () => {
    const okZero = crimeRisk({ weightedCount: 0, exposureKm: 5, priorRate: 2, status: 'ok' });
    const unavailable = crimeRisk({ weightedCount: 0, exposureKm: 5, priorRate: 2, status: 'unavailable' });
    expect(unavailable.risk).toBeGreaterThan(okZero.risk);
  });

  test('rejects negative or non-finite exposure', () => {
    expect(() => crimeRisk({ weightedCount: 1, exposureKm: -1, priorRate: 1 })).toThrow(TypeError);
    expect(() => crimeRisk({ weightedCount: 1, exposureKm: NaN, priorRate: 1 })).toThrow(TypeError);
    expect(() => crimeRisk({ weightedCount: 1, exposureKm: Infinity, priorRate: 1 })).toThrow(TypeError);
  });

  test('rejects negative or non-finite weightedCount and priorRate', () => {
    expect(() => crimeRisk({ weightedCount: -1, exposureKm: 1, priorRate: 1 })).toThrow(TypeError);
    expect(() => crimeRisk({ weightedCount: NaN, exposureKm: 1, priorRate: 1 })).toThrow(TypeError);
    expect(() => crimeRisk({ weightedCount: 1, exposureKm: 1, priorRate: -1 })).toThrow(TypeError);
    expect(() => crimeRisk({ weightedCount: 1, exposureKm: 1, priorRate: NaN })).toThrow(TypeError);
  });

  test('rejects non-positive priorStrength', () => {
    expect(() => crimeRisk({ weightedCount: 1, exposureKm: 1, priorRate: 1, priorStrength: 0 })).toThrow(TypeError);
    expect(() => crimeRisk({ weightedCount: 1, exposureKm: 1, priorRate: 1, priorStrength: -2 })).toThrow(TypeError);
  });

  test('rejects an unknown status', () => {
    expect(() => crimeRisk({ weightedCount: 1, exposureKm: 1, priorRate: 1, status: 'stale' })).toThrow(TypeError);
  });

  describe('properties', () => {
    const rng = makeRng(20261019);
    const randomBetween = (lo, hi) => lo + (hi - lo) * rng();

    test('risk is monotone non-decreasing in weightedCount', () => {
      const base = { exposureKm: 1.5, priorRate: 2, priorStrength: 2, status: 'ok' };
      let previous = -Infinity;
      for (let count = 0; count <= 60; count += 0.5) {
        const { risk } = crimeRisk({ ...base, weightedCount: count });
        expect(risk).toBeGreaterThanOrEqual(previous);
        previous = risk;
      }
    });

    test('risk stays within [0, 1) for moderate inputs', () => {
      for (let i = 0; i < 500; i += 1) {
        const { risk } = crimeRisk({
          weightedCount: randomBetween(0, 50),
          exposureKm: randomBetween(0.5, 10),
          priorRate: randomBetween(0, 5),
          priorStrength: randomBetween(0.1, 5),
          status: 'ok',
        });
        expect(risk).toBeGreaterThanOrEqual(0);
        expect(risk).toBeLessThan(1);
      }
    });

    test('unavailable never lowers risk versus ok with zero crimes, and never claims n > 0', () => {
      for (let i = 0; i < 500; i += 1) {
        const exposureKm = randomBetween(0, 10);
        const priorRate = randomBetween(0.01, 5);
        const priorStrength = randomBetween(0.1, 5);
        const okZero = crimeRisk({ weightedCount: 0, exposureKm, priorRate, priorStrength, status: 'ok' });
        const unavailable = crimeRisk({ weightedCount: randomBetween(0, 50), exposureKm, priorRate, priorStrength, status: 'unavailable' });
        expect(unavailable.risk).toBeGreaterThanOrEqual(okZero.risk);
        expect(unavailable.n).toBe(0);
      }
    });

    test('for ok cells, n is strictly between 0 and 1 when exposure is positive', () => {
      for (let i = 0; i < 200; i += 1) {
        const { n } = crimeRisk({
          weightedCount: randomBetween(0, 20),
          exposureKm: randomBetween(0.01, 10),
          priorRate: randomBetween(0, 5),
          status: 'ok',
        });
        expect(n).toBeGreaterThan(0);
        expect(n).toBeLessThan(1);
      }
    });

    test('more exposure with the same count lowers the rate', () => {
      const base = { weightedCount: 3, priorRate: 1.5, priorStrength: 2, status: 'ok' };
      let previous = Infinity;
      for (let exposureKm = 0; exposureKm <= 10; exposureKm += 0.5) {
        const { lambda } = crimeRisk({ ...base, exposureKm });
        expect(lambda).toBeLessThan(previous);
        previous = lambda;
      }
    });
  });
});

const { edgeRisk } = require('../../../../src/safety/scoring/edgeRisk');
const {
  MIN_FACTOR_SAFETY,
  EVIDENCE_PSEUDO_COUNT,
  CAUSE_MIN_RISK,
  PRIOR_SAFETY,
  BASE_WEIGHTS,
  UNCERTAINTY_RISK_LOAD,
} = require('../../../../src/safety/scoring/config');
const { createSeededRandom } = require('./seededRandom');

const FACTORS = ['lighting', 'crime', 'road', 'activity', 'isolation'];
const WEIGHTS = { lighting: 0.3, crime: 0.25, road: 0.15, activity: 0.18, isolation: 0.12 };
const TOLERANCE = 1e-9;

// Blend of the neutral priors with every factor unavailable (base risk, before the uncertainty load):
// 1 - exp(-sum_i w_i * -ln(prior_i)) with the priors in config PRIOR_SAFETY.
// The uncertainty load then applies in full (certainty 0): risk = base + load * (1 - base).
const ALL_PRIOR_BASE_RISK = 0.486165497;
const ALL_PRIOR_RISK = ALL_PRIOR_BASE_RISK + UNCERTAINTY_RISK_LOAD * (1 - ALL_PRIOR_BASE_RISK);

function allFactors(safety, n = 10) {
  return Object.fromEntries(FACTORS.map((name) => [name, { safety, n }]));
}

function allUnavailable() {
  return Object.fromEntries(FACTORS.map((name) => [name, { safety: null, n: 0 }]));
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
    const result = edgeRisk({ factors: allFactors(1, 1e12), weights: WEIGHTS });

    expect(result.risk).toBeCloseTo(0, 9);
    expect(result.dominantCause).toBeNull();
  });

  test('one factor at safety 0 with the rest at 1 gives risk 1 - eps^w, not 1', () => {
    const factors = { ...allFactors(1, 1e12), crime: { safety: 0, n: 1e12 } };
    const result = edgeRisk({ factors, weights: WEIGHTS });

    expect(result.risk).toBeCloseTo(1 - Math.pow(MIN_FACTOR_SAFETY, WEIGHTS.crime), 9);
    expect(result.risk).toBeLessThan(1);
    expect(result.dominantCause).toBe('crime');
  });

  describe('unavailable factors (null safety) are substituted, never dropped', () => {
    test('a null factor scores exactly like its config prior with n = 0', () => {
      const withNull = { ...allFactors(0.8), lighting: { safety: null, n: 0 } };
      const withPrior = { ...allFactors(0.8), lighting: { safety: PRIOR_SAFETY.lighting, n: 0 } };

      const a = edgeRisk({ factors: withNull, weights: WEIGHTS });
      const b = edgeRisk({ factors: withPrior, weights: WEIGHTS });

      expect(a.risk).toBeCloseTo(b.risk, 12);
      expect(a.certainty).toBeCloseTo(b.certainty, 12);
    });

    test('a missing factor key is treated exactly like a null factor', () => {
      const missing = allFactors(0.8);
      delete missing.crime;
      const withNull = { ...allFactors(0.8), crime: { safety: null, n: 0 } };

      expect(edgeRisk({ factors: missing, weights: WEIGHTS }))
        .toEqual(edgeRisk({ factors: withNull, weights: WEIGHTS }));
    });

    test('missing data is never silently good: {lighting .95, crime null} sits between crime .95 and crime .05', () => {
      const lighting = { safety: 0.95, n: 10 };
      const others = {
        road: { safety: null, n: 0 },
        activity: { safety: null, n: 0 },
        isolation: { safety: null, n: 0 },
      };
      const riskWithCrime = (crime) =>
        edgeRisk({ factors: { lighting, ...others, crime }, weights: WEIGHTS }).risk;

      const nullCrime = riskWithCrime({ safety: null, n: 0 });

      expect(nullCrime).toBeGreaterThan(riskWithCrime({ safety: 0.95, n: 10 }));
      expect(nullCrime).toBeLessThanOrEqual(riskWithCrime({ safety: 0.05, n: 10 }));
    });

    test('a null factor contributes zero certainty even if it carries an n', () => {
      const factors = { ...allUnavailable(), lighting: { safety: null, n: 100 } };

      expect(edgeRisk({ factors, weights: WEIGHTS }).certainty).toBe(0);
    });

    test('all factors unavailable blends the priors with certainty 0 and no cause', () => {
      const result = edgeRisk({ factors: allUnavailable(), weights: WEIGHTS });

      expect(result.risk).toBeCloseTo(ALL_PRIOR_RISK, 9);
      expect(result.certainty).toBe(0);
      expect(result.dominantCause).toBeNull();
    });

    test('an empty factors object is the same as all factors unavailable', () => {
      expect(edgeRisk({ factors: {}, weights: WEIGHTS }))
        .toEqual(edgeRisk({ factors: allUnavailable(), weights: WEIGHTS }));
    });

    test('a zero-weight factor (daylight lighting) is ignored whether observed or missing', () => {
      const daylight = { lighting: 0, crime: 0.4, road: 0.25, activity: 0.2, isolation: 0.15 };
      const observed = { ...allFactors(0.7), lighting: { safety: 0, n: 100 } };
      const missing = { ...allFactors(0.7) };
      delete missing.lighting;

      expect(edgeRisk({ factors: observed, weights: daylight }).risk)
        .toBeCloseTo(edgeRisk({ factors: missing, weights: daylight }).risk, 12);
    });
  });

  test('a factor whose safety is undefined is unavailable, exactly like null', () => {
    const undefinedSafety = { ...allFactors(0.8), lighting: { safety: undefined, n: 5 } };
    const nullSafety = { ...allFactors(0.8), lighting: { safety: null, n: 0 } };

    expect(edgeRisk({ factors: undefinedSafety, weights: WEIGHTS }))
      .toEqual(edgeRisk({ factors: nullSafety, weights: WEIGHTS }));
  });

  describe('weight scale', () => {
    test('scaling every weight by 2 leaves risk and certainty unchanged', () => {
      const doubled = Object.fromEntries(Object.entries(WEIGHTS).map(([name, w]) => [name, 2 * w]));
      const base = edgeRisk({ factors: allFactors(0.7), weights: WEIGHTS });
      const scaled = edgeRisk({ factors: allFactors(0.7), weights: doubled });

      expect(scaled.risk).toBeCloseTo(base.risk, 12);
      expect(scaled.certainty).toBeCloseTo(base.certainty, 12);
    });

    test('weights whose sum overflows a float are scaled by their peak, not read as zero risk', () => {
      // Five values of 1e308 sum to Infinity; the ratios are still all equal, so risk must match equal weights.
      const equal = Object.fromEntries(FACTORS.map((name) => [name, 1]));
      const huge = Object.fromEntries(FACTORS.map((name) => [name, 1e308]));
      const expected = edgeRisk({ factors: allFactors(0.7), weights: equal });
      const actual = edgeRisk({ factors: allFactors(0.7), weights: huge });

      expect(actual.risk).toBeCloseTo(expected.risk, 12);
      expect(actual.risk).toBeGreaterThan(0);
      expect(actual.certainty).toBeCloseTo(expected.certainty, 12);
    });
  });

  describe('factor keys come from BASE_WEIGHTS and must match PRIOR_SAFETY', () => {
    // Loads edgeRisk.js against a config whose exports are overridden, and returns the load error if any.
    function loadEdgeRiskWith(overrides) {
      const configPath = '../../../../src/safety/scoring/config';
      let loaded = null;
      let thrown = null;
      jest.isolateModules(() => {
        jest.doMock(configPath, () => ({ ...jest.requireActual(configPath), ...overrides }));
        try {
          loaded = require('../../../../src/safety/scoring/edgeRisk');
        } catch (error) {
          thrown = error;
        }
      });
      jest.dontMock(configPath);
      return { loaded, thrown };
    }

    test('loads when BASE_WEIGHTS and PRIOR_SAFETY have the same keys', () => {
      const { loaded, thrown } = loadEdgeRiskWith({});

      expect(thrown).toBeNull();
      expect(typeof loaded.edgeRisk).toBe('function');
    });

    test('throws a plain Error at load when PRIOR_SAFETY has a key BASE_WEIGHTS does not', () => {
      const { thrown } = loadEdgeRiskWith({
        PRIOR_SAFETY: { ...PRIOR_SAFETY, extra: 0.5 },
      });

      expect(thrown).toBeInstanceOf(Error);
      expect(thrown.constructor).toBe(Error);
      expect(thrown.message).toMatch(/factor keys/);
    });

    test('throws a plain Error at load when BASE_WEIGHTS lacks a key PRIOR_SAFETY has', () => {
      const withoutIsolation = Object.fromEntries(
        Object.entries(BASE_WEIGHTS).filter(([name]) => name !== 'isolation'),
      );
      const { thrown } = loadEdgeRiskWith({ BASE_WEIGHTS: withoutIsolation });

      expect(thrown).toBeInstanceOf(Error);
      expect(thrown.constructor).toBe(Error);
      expect(thrown.message).toMatch(/factor keys/);
    });
  });

  describe('input validation', () => {
    test.each([
      ['NaN safety', { safety: NaN, n: 1 }],
      ['safety above 1', { safety: 1.01, n: 1 }],
      ['negative safety', { safety: -0.1, n: 1 }],
      ['string safety', { safety: '0.5', n: 1 }],
      ['NaN n', { safety: 0.5, n: NaN }],
      ['negative n', { safety: 0.5, n: -1 }],
    ])('throws TypeError for a factor with %s', (_name, factor) => {
      const factors = { ...allFactors(0.5), crime: factor };

      expect(() => edgeRisk({ factors, weights: WEIGHTS })).toThrow(TypeError);
    });

    test('throws TypeError when factors is not an object', () => {
      expect(() => edgeRisk({ factors: null, weights: WEIGHTS })).toThrow(TypeError);
      expect(() => edgeRisk({ factors: 'lighting', weights: WEIGHTS })).toThrow(TypeError);
    });

    test.each([
      ['eps 0', 0],
      ['eps 1', 1],
      ['eps NaN', NaN],
      ['eps negative', -0.1],
      ['eps above 1', 1.5],
    ])('throws TypeError for %s', (_name, eps) => {
      expect(() => edgeRisk({ factors: allFactors(0.5), weights: WEIGHTS, eps })).toThrow(TypeError);
    });

    test.each([
      ['negative weight', { ...WEIGHTS, crime: -0.1 }],
      ['NaN weight', { ...WEIGHTS, road: NaN }],
      ['infinite weight', { ...WEIGHTS, activity: Infinity }],
      ['missing weight', { lighting: 0.3, crime: 0.25, road: 0.15, activity: 0.18 }],
    ])('throws TypeError for a %s', (_name, weights) => {
      expect(() => edgeRisk({ factors: allFactors(0.5), weights })).toThrow(TypeError);
    });

    test('throws TypeError when every weight is zero, rather than reporting risk 0', () => {
      const zeros = Object.fromEntries(FACTORS.map((name) => [name, 0]));

      expect(() => edgeRisk({ factors: allFactors(0.5), weights: zeros })).toThrow(TypeError);
    });

    test.each([
      ['null', null],
      ['a string', 'lighting'],
    ])('throws TypeError when weights is %s', (_name, weights) => {
      expect(() => edgeRisk({ factors: allFactors(0.5), weights })).toThrow(TypeError);
    });
  });

  test('certainty is the weight-averaged n / (n + pseudo-count) over all factors, unavailable ones counting zero', () => {
    const factors = {
      lighting: { safety: 0.5, n: EVIDENCE_PSEUDO_COUNT },
      crime: { safety: 0.5, n: 0 },
    };
    const result = edgeRisk({ factors, weights: WEIGHTS });

    expect(result.certainty).toBeCloseTo(WEIGHTS.lighting * 0.5, 12);
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

  test('dominantCause only names a factor with data, never a prior', () => {
    // Priors alone would make lighting (0.5 prior) the largest contributor; the cause must be crime.
    const factors = {
      lighting: { safety: null, n: 0 },
      crime: { safety: 0.3, n: 10 },
      road: { safety: null, n: 0 },
      activity: { safety: null, n: 0 },
      isolation: { safety: null, n: 0 },
    };
    const result = edgeRisk({ factors, weights: WEIGHTS });

    expect(result.risk).toBeGreaterThanOrEqual(CAUSE_MIN_RISK);
    expect(result.dominantCause).toBe('crime');
  });

  test('dominantCause is null when risk is below CAUSE_MIN_RISK', () => {
    const result = edgeRisk({ factors: allFactors(0.95, 1e12), weights: WEIGHTS });

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

      const lower = random() * factors[name].safety;
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

  test('property: a null factor always scores as its prior with n = 0, whatever the others are', () => {
    const random = createSeededRandom(3);

    for (let i = 0; i < 300; i += 1) {
      const factors = randomFactors(random);
      const name = FACTORS[Math.floor(random() * FACTORS.length)];
      const withNull = { ...factors, [name]: { safety: null, n: random() * 100 } };
      const withPrior = { ...factors, [name]: { safety: PRIOR_SAFETY[name], n: 0 } };

      expect(edgeRisk({ factors: withNull, weights: WEIGHTS }).risk)
        .toBeCloseTo(edgeRisk({ factors: withPrior, weights: WEIGHTS }).risk, 12);
    }
  });
});

describe('edgeRisk prudent uncertainty load (we price what we do not know)', () => {
  const certain = (safety) => Object.fromEntries(FACTORS.map((name) => [name, { safety, n: 1e9 }]));

  test('UNCERTAINTY_RISK_LOAD is a fraction in (0, 1)', () => {
    expect(UNCERTAINTY_RISK_LOAD).toBeGreaterThan(0);
    expect(UNCERTAINTY_RISK_LOAD).toBeLessThan(1);
  });

  test('same safeties, lower evidence: strictly higher risk', () => {
    const strong = edgeRisk({ factors: allFactors(0.8, 40), weights: WEIGHTS });
    const weak = edgeRisk({ factors: allFactors(0.8, 2), weights: WEIGHTS });
    expect(weak.certainty).toBeLessThan(strong.certainty);
    expect(weak.risk).toBeGreaterThan(strong.risk);
  });

  test('certainty 1 leaves the risk unchanged by the load', () => {
    const result = edgeRisk({ factors: certain(0.8), weights: WEIGHTS });
    const share = (name) => WEIGHTS[name] / Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
    const base = 1 - FACTORS.reduce((p, name) => p * Math.pow(0.8, share(name)), 1);
    expect(result.certainty).toBeCloseTo(1, 6);
    expect(result.risk).toBeCloseTo(base, 6);
  });

  test('risk equals base + load * (1 - certainty) * (1 - base)', () => {
    const n = 4; // certainty 0.5
    const result = edgeRisk({ factors: allFactors(0.8, n), weights: WEIGHTS });
    const total = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
    const base = 1 - FACTORS.reduce((p, name) => p * Math.pow(0.8, WEIGHTS[name] / total), 1);
    expect(result.risk).toBeCloseTo(base + UNCERTAINTY_RISK_LOAD * (1 - result.certainty) * (1 - base), 9);
  });

  test('risk stays in [0, 1] and is never above 1 even when everything is unknown and unsafe', () => {
    const r = edgeRisk({ factors: allFactors(0, 0), weights: WEIGHTS });
    expect(r.risk).toBeLessThanOrEqual(1);
    expect(r.risk).toBeGreaterThan(0);
  });
});

const { getWeights } = require('../../../../src/safety/scoring/weights');
const { BASE_WEIGHTS } = require('../../../../src/safety/scoring/config');
const { SAFETY_LEVEL_STANDARD, SAFETY_LEVEL_EXTRA } = require('../../../../src/safety/services/safetyLevels');
const { createSeededRandom } = require('./seededRandom');

const FACTORS = ['lighting', 'crime', 'road', 'activity', 'isolation'];
const SUM_TOLERANCE = 1e-9;

function sum(weights) {
  return FACTORS.reduce((total, name) => total + weights[name], 0);
}

describe('getWeights', () => {
  test('BASE_WEIGHTS sum to 1', () => {
    expect(sum(BASE_WEIGHTS)).toBeCloseTo(1, 9);
  });

  test('full darkness at extra level keeps the base weights (already sum to 1)', () => {
    const weights = getWeights({ darkness: 1, safetyLevel: SAFETY_LEVEL_EXTRA });

    for (const name of FACTORS) {
      expect(weights[name]).toBeCloseTo(BASE_WEIGHTS[name], 12);
    }
  });

  test('daylight (darkness 0) gives lighting zero weight and the rest still sum to 1', () => {
    const weights = getWeights({ darkness: 0, safetyLevel: SAFETY_LEVEL_EXTRA });

    expect(weights.lighting).toBe(0);
    expect(sum(weights)).toBeCloseTo(1, 9);
    expect(weights.crime).toBeGreaterThan(0);
    expect(weights.road).toBeGreaterThan(0);
  });

  test('partial darkness scales lighting before renormalising', () => {
    const weights = getWeights({ darkness: 0.5, safetyLevel: SAFETY_LEVEL_EXTRA });
    const raw = { ...BASE_WEIGHTS, lighting: BASE_WEIGHTS.lighting * 0.5 };
    const rawTotal = FACTORS.reduce((total, name) => total + raw[name], 0);

    for (const name of FACTORS) {
      expect(weights[name]).toBeCloseTo(raw[name] / rawTotal, 12);
    }
  });

  test('standard level drops activity weight and renormalises', () => {
    const weights = getWeights({ darkness: 1, safetyLevel: SAFETY_LEVEL_STANDARD });

    expect(weights.activity).toBe(0);
    expect(sum(weights)).toBeCloseTo(1, 9);
    expect(weights.lighting).toBeCloseTo(BASE_WEIGHTS.lighting / (1 - BASE_WEIGHTS.activity), 12);
  });

  test('darkness outside [0, 1] or non-numeric throws TypeError', () => {
    for (const darkness of [-0.01, 1.01, NaN, Infinity, '0.5', null, undefined]) {
      expect(() => getWeights({ darkness, safetyLevel: SAFETY_LEVEL_EXTRA })).toThrow(TypeError);
    }
  });

  test('property: weights sum to 1 and are non-negative for random inputs', () => {
    const random = createSeededRandom(20261019);
    const levels = [SAFETY_LEVEL_STANDARD, SAFETY_LEVEL_EXTRA];

    for (let i = 0; i < 2000; i += 1) {
      const darkness = random();
      const safetyLevel = levels[Math.floor(random() * levels.length)];
      const weights = getWeights({ darkness, safetyLevel });

      expect(Math.abs(sum(weights) - 1)).toBeLessThanOrEqual(SUM_TOLERANCE);
      for (const name of FACTORS) {
        expect(weights[name]).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

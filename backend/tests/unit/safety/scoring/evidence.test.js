const { evidenceStrength } = require('../../../../src/safety/scoring/evidence');
const { EVIDENCE_PSEUDO_COUNT } = require('../../../../src/safety/scoring/config');
const { lightingCertainty } = require('../../../../src/safety/scoring/lightingInference');

describe('evidenceStrength', () => {
  test('is 0 with no observations', () => {
    expect(evidenceStrength(0)).toBe(0);
  });

  test('is one half at n equal to the pseudo-count', () => {
    expect(EVIDENCE_PSEUDO_COUNT).toBe(4);
    expect(evidenceStrength(EVIDENCE_PSEUDO_COUNT)).toBe(0.5);
  });

  test('is n / (n + pseudo-count) for other values', () => {
    expect(evidenceStrength(12)).toBeCloseTo(0.75, 12);
    expect(evidenceStrength(1)).toBeCloseTo(1 / 5, 12);
  });

  test('stays in [0, 1) and rises with n', () => {
    let previous = -1;
    for (const n of [0, 0.5, 1, 3, 10, 100, 1e6]) {
      const strength = evidenceStrength(n);
      expect(strength).toBeGreaterThanOrEqual(0);
      expect(strength).toBeLessThan(1);
      expect(strength).toBeGreaterThan(previous);
      previous = strength;
    }
  });

  test.each([
    ['negative n', -1],
    ['NaN n', NaN],
    ['infinite n', Infinity],
    ['string n', '3'],
  ])('throws TypeError for %s', (_name, n) => {
    expect(() => evidenceStrength(n)).toThrow(TypeError);
  });

  test('lightingCertainty is the same shared formula', () => {
    for (const n of [0, 2, 4, 9]) {
      expect(lightingCertainty({ n })).toBe(evidenceStrength(n));
    }
  });
});

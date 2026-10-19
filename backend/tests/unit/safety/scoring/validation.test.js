const {
  assertFinite,
  assertNonNegative,
  assertNonNegativeInteger,
  assertInRange,
} = require('../../../../src/safety/scoring/validation');

describe('validation helpers', () => {
  test('assertFinite returns the value for a finite number and throws TypeError otherwise', () => {
    expect(assertFinite('x', 2.5)).toBe(2.5);
    for (const value of [NaN, Infinity, '1', null, undefined]) {
      expect(() => assertFinite('x', value)).toThrow(TypeError);
    }
  });

  test('assertNonNegative accepts zero and rejects negatives', () => {
    expect(assertNonNegative('x', 0)).toBe(0);
    expect(() => assertNonNegative('x', -0.5)).toThrow(TypeError);
  });

  test('assertInRange accepts both bounds and rejects values outside them', () => {
    expect(assertInRange('x', 0, 0, 1)).toBe(0);
    expect(assertInRange('x', 1, 0, 1)).toBe(1);
    expect(() => assertInRange('x', 1.01, 0, 1)).toThrow(TypeError);
  });

  describe('assertNonNegativeInteger', () => {
    test('returns the value for an integer >= 0', () => {
      expect(assertNonNegativeInteger('count', 0)).toBe(0);
      expect(assertNonNegativeInteger('count', 7)).toBe(7);
    });

    test.each([
      ['a fraction', 1.5],
      ['a negative integer', -1],
      ['a numeric string', '3'],
      ['NaN', NaN],
      ['Infinity', Infinity],
      ['undefined', undefined],
    ])('throws TypeError naming the field for %s', (_name, value) => {
      expect(() => assertNonNegativeInteger('count', value)).toThrow(TypeError);
      expect(() => assertNonNegativeInteger('count', value)).toThrow(/count/);
    });
  });
});

const {
  blockKeyOf,
  assignFolds,
  mulberry32,
  shuffleInPlace,
} = require('../../../../scripts/eval/lib/spatial');

const ORIGIN = { south: 50.3, west: -4.25 };

describe('blockKeyOf (1 km grid)', () => {
  test('points in the same 1 km cell share a key', () => {
    const a = blockKeyOf(50.3001, -4.2499, ORIGIN);
    const b = blockKeyOf(50.3050, -4.2450, ORIGIN);
    expect(a).toBe(b);
  });

  test('points either side of a 1 km boundary get different keys', () => {
    // 1000 m north is about 0.008993 deg of latitude.
    const southOfEdge = blockKeyOf(50.3 + 0.0089, -4.2, ORIGIN);
    const northOfEdge = blockKeyOf(50.3 + 0.0091, -4.2, ORIGIN);
    expect(southOfEdge).not.toBe(northOfEdge);
  });

  test('the cell size is in metres, so east-west cells shrink with latitude', () => {
    const cellWidthDeg = 1000 / (111320 * Math.cos(50.3 * Math.PI / 180));
    const at = (cells) => blockKeyOf(50.3, ORIGIN.west + cells * cellWidthDeg, ORIGIN);
    expect(at(3.5)).toBe('0,3');
    expect(at(3.99)).toBe('0,3');
    expect(at(4.01)).toBe('0,4');
  });
});

describe('assignFolds', () => {
  const keys = Array.from({ length: 23 }, (_, i) => `b${i}`);

  test('assigns every block to exactly one fold in 0..k-1', () => {
    const folds = assignFolds(keys, 5, 7);
    expect(folds.size).toBe(keys.length);
    for (const fold of folds.values()) {
      expect(fold).toBeGreaterThanOrEqual(0);
      expect(fold).toBeLessThan(5);
    }
  });

  test('balances block counts across folds (sizes differ by at most one)', () => {
    const folds = assignFolds(keys, 5, 7);
    const sizes = [0, 0, 0, 0, 0];
    for (const fold of folds.values()) sizes[fold]++;
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
  });

  test('is deterministic for a seed and changes with the seed', () => {
    const first = assignFolds(keys, 5, 7);
    const again = assignFolds(keys, 5, 7);
    const other = assignFolds(keys, 5, 8);
    expect([...first.entries()]).toEqual([...again.entries()]);
    expect([...first.entries()]).not.toEqual([...other.entries()]);
  });

  test('does not depend on the input order of the keys', () => {
    const shuffled = [...keys].reverse();
    expect([...assignFolds(keys, 5, 3).entries()].sort())
      .toEqual([...assignFolds(shuffled, 5, 3).entries()].sort());
  });

  test('rejects fewer blocks than folds', () => {
    expect(() => assignFolds(['a', 'b'], 5, 1)).toThrow(RangeError);
  });
});

describe('mulberry32 / shuffleInPlace', () => {
  test('the same seed gives the same sequence', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  test('values lie in [0, 1)', () => {
    const rng = mulberry32(1);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  test('shuffleInPlace keeps the same elements', () => {
    const arr = [1, 2, 3, 4, 5, 6];
    shuffleInPlace(arr, mulberry32(9));
    expect([...arr].sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

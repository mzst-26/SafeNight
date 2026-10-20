const path = require('path');
const iso = require(path.resolve(__dirname, '../../../../../src/safety/services/graph/isolationStage'));

describe('graph/isolationStage isDeadEnd', () => {
  const degree = new Map([[1, 1], [2, 3], [3, 2], [4, 0]]);
  test('either end with degree at most 1 (or unknown) is a dead end', () => {
    expect(iso.isDeadEnd(degree, 1, 2)).toBe(true);
    expect(iso.isDeadEnd(degree, 2, 1)).toBe(true);
    expect(iso.isDeadEnd(degree, 2, 3)).toBe(false);
    expect(iso.isDeadEnd(degree, 2, 99)).toBe(true);
    expect(iso.isDeadEnd(degree, 4, 3)).toBe(true);
  });
});

describe('graph/isolationStage isUnlitPath', () => {
  test('a path class with no lamp nearby, not lit=yes and not a sidewalk is unlit', () => {
    expect(iso.isUnlitPath('footway', {}, 0, false)).toBe(true);
    expect(iso.isUnlitPath('path', {}, 0, undefined)).toBe(true);
  });

  test.each([
    ['a lamp within reach', 'footway', {}, 1, false],
    ['lit=yes', 'footway', { lit: 'yes' }, 0, false],
    ['a sidewalk beside a road', 'footway', {}, 0, true],
    ['a road class', 'residential', {}, 0, undefined],
  ])('%s is not an unlit path', (_name, highway, tags, lamps, nearRoad) => {
    expect(iso.isUnlitPath(highway, tags, lamps, nearRoad)).toBe(false);
  });

  test('lit=no still counts as unlit', () => {
    expect(iso.isUnlitPath('steps', { lit: 'no' }, 0, false)).toBe(true);
  });
});

describe('graph/isolationStage isolationSafetyOf', () => {
  test('applies the dead-end (0.5) and unlit-path (0.95) penalties and clamps at 0', () => {
    expect(iso.isolationSafetyOf(false, false)).toBe(1);
    expect(iso.isolationSafetyOf(true, false)).toBe(0.5);
    expect(iso.isolationSafetyOf(false, true)).toBeCloseTo(0.05, 12);
    expect(iso.isolationSafetyOf(true, true)).toBe(0);
  });
});

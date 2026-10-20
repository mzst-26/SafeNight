const path = require('path');
const {
  ramp, remotenessOf, hazardOf, safetyMultiplier,
} = require(path.resolve(__dirname, '../../../../src/safety/scoring/remoteness'));
const { REMOTENESS: { HAZARD_STRENGTH } } = require(path.resolve(__dirname, '../../../../src/safety/scoring/config'));

describe('ramp', () => {
  test('is 0 below the start, 1 above the end, linear between', () => {
    expect(ramp(10, 25, 150)).toBe(0);
    expect(ramp(25, 25, 150)).toBe(0);
    expect(ramp(87.5, 25, 150)).toBeCloseTo(0.5, 9);
    expect(ramp(500, 25, 150)).toBe(1);
  });
});

describe('remotenessOf', () => {
  test('is 0.8 at most: far from roads, no ways, no places', () => {
    expect(remotenessOf({ nearestRoadM: 200, waysNear: 0, placesNear: 0 })).toBeCloseTo(0.8, 9);
  });

  test('is 0 on a busy street (road underfoot, 10+ ways and places)', () => {
    expect(remotenessOf({ nearestRoadM: 0, waysNear: 12, placesNear: 10 })).toBe(0);
  });

  test('infinite or missing distance counts as far', () => {
    expect(remotenessOf({ nearestRoadM: Infinity, waysNear: 0, placesNear: 0 })).toBeCloseTo(0.8, 9);
  });

  test('each term contributes with its own weight', () => {
    expect(remotenessOf({ nearestRoadM: 150, waysNear: 10, placesNear: 10 })).toBeCloseTo(0.4, 9);
    expect(remotenessOf({ nearestRoadM: 0, waysNear: 0, placesNear: 10 })).toBeCloseTo(0.3, 9);
    expect(remotenessOf({ nearestRoadM: 0, waysNear: 10, placesNear: 0 })).toBeCloseTo(0.1, 9);
  });
});

describe('hazardOf', () => {
  test('H = R * (1 - P) * darkness, lit reduces by 35%', () => {
    expect(hazardOf({ remoteness: 0.8, presence: 0, darkness: 1, lightingEffective: 0 })).toBeCloseTo(0.8, 9);
    expect(hazardOf({ remoteness: 0.8, presence: 0.5, darkness: 1, lightingEffective: 0 })).toBeCloseTo(0.4, 9);
    expect(hazardOf({ remoteness: 0.8, presence: 0, darkness: 1, lightingEffective: 1 })).toBeCloseTo(0.8 * 0.65, 9);
  });

  test('remoteness at or below the free level (suburban streets) causes no hazard', () => {
    expect(hazardOf({ remoteness: 0.3, presence: 0, darkness: 1, lightingEffective: 0 })).toBe(0);
    expect(hazardOf({ remoteness: 0.19, presence: 0, darkness: 1, lightingEffective: 0 })).toBe(0);
    expect(hazardOf({ remoteness: 0.55, presence: 0, darkness: 1, lightingEffective: 0 })).toBeCloseTo(0.4, 9);
  });

  test('is zero in daylight', () => {
    expect(hazardOf({ remoteness: 0.8, presence: 0, darkness: 0, lightingEffective: 0.5 })).toBe(0);
  });
});

describe('safetyMultiplier', () => {
  test('is 1 - HAZARD_STRENGTH * hazard', () => {
    expect(safetyMultiplier(0)).toBe(1);
    expect(safetyMultiplier(0.5)).toBeCloseTo(1 - 0.5 * HAZARD_STRENGTH, 9);
    expect(safetyMultiplier(1)).toBeCloseTo(1 - HAZARD_STRENGTH, 9);
  });
});

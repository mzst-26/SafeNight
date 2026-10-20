const path = require('path');
const { remotenessOf } = require(path.resolve(__dirname, '../../../../src/safety/scoring/remoteness'));

// Literal distances and weights, so a change to REMOTENESS.ROAD_NEAR_M / ROAD_FAR_M / weights in config.js fails here.
// Ways and places are held at their full ramp (10 each) so only the road-distance term varies: 0.4 * ramp(d, 25, 150).
const full = { waysNear: 10, placesNear: 10 };

describe('remoteness road-distance ramp 25 m -> 150 m (literal)', () => {
  test('zero at 25 m or closer: a path that close to a street is overlooked by it', () => {
    expect(remotenessOf({ nearestRoadM: 25, ...full })).toBeCloseTo(0, 12);
    expect(remotenessOf({ nearestRoadM: 10, ...full })).toBeCloseTo(0, 12);
  });

  test('100 m from the nearest road gets 0.4 * (75 / 125) = 0.24, not the full 0.4', () => {
    expect(remotenessOf({ nearestRoadM: 100, ...full })).toBeCloseTo(0.24, 12);
  });

  test('exactly full road term at 150 m', () => {
    expect(remotenessOf({ nearestRoadM: 150, ...full })).toBeCloseTo(0.4, 12);
  });

  test('the road term is linear between 25 m and 150 m (87.5 m is halfway: 0.2)', () => {
    expect(remotenessOf({ nearestRoadM: 87.5, ...full })).toBeCloseTo(0.2, 12);
  });
});

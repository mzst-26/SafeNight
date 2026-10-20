const path = require('path');
const activity = require(path.resolve(__dirname, '../../../../../src/safety/services/graph/activityStage'));
const { ACTIVITY_FLOOR } = require(path.resolve(__dirname, '../../../../../src/safety/scoring/config'));

const LAT = 51.5;
const LNG = -0.1;
const NOW = new Date('2026-10-19T11:00:00Z');
const noTick = () => {};
const sourcesFor = (places, hour) => activity.collectActivitySources(null, places, null, { hour, now: NOW }, noTick);

describe('graph/activityStage only open places count', () => {
  // OSM pub: the heuristic opens evening venues at 10:00, so at 09:00 it is closed.
  const pub = { elements: [{ lat: LAT, lon: LNG, tags: { amenity: 'pub' } }] };

  test('a closed pub does not count toward activity, and an open one does', () => {
    const closedAt = activity.activityAt(sourcesFor(pub, 9), LAT, LNG, 9);
    expect(closedAt.placeScore).toBe(0);
    expect(closedAt.activitySafety).toBeCloseTo(ACTIVITY_FLOOR, 12);

    const openAt = activity.activityAt(sourcesFor(pub, 12), LAT, LNG, 12);
    expect(openAt.placeScore).toBeCloseTo(0.15, 12);
    expect(openAt.activitySafety).toBeGreaterThan(ACTIVITY_FLOOR);
  });
});

describe('graph/activityStage night discount in the activity load', () => {
  test('a place counts for less at 23:00 than at midday in the activity safety itself', () => {
    // A hospital is always open, so only the time-of-day discount differs between the two hours.
    const hospital = { elements: [{ lat: LAT, lon: LNG, tags: { amenity: 'hospital' } }] };
    const day = activity.activityAt(sourcesFor(hospital, 12), LAT, LNG, 12);
    const late = activity.activityAt(sourcesFor(hospital, 23), LAT, LNG, 23);

    // Load = 0.15 * 1 open place * discount: 0.15 by day, 0.15 * 0.4 = 0.06 late at night.
    expect(day.activitySafety).toBeCloseTo(ACTIVITY_FLOOR + (1 - ACTIVITY_FLOOR) * (1 - Math.exp(-0.15)), 12);
    expect(late.activitySafety).toBeCloseTo(ACTIVITY_FLOOR + (1 - ACTIVITY_FLOOR) * (1 - Math.exp(-0.06)), 12);
    expect(late.activitySafety).toBeLessThan(day.activitySafety);
  });
});

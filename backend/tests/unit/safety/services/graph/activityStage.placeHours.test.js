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
    const closedAt = activity.activityAt(sourcesFor(pub, 9), LAT, LNG, 9, { darkness: 0 });
    expect(closedAt.placeScore).toBe(0);
    expect(closedAt.activitySafety).toBeCloseTo(ACTIVITY_FLOOR, 12);

    const openAt = activity.activityAt(sourcesFor(pub, 12), LAT, LNG, 12, { darkness: 0 });
    expect(openAt.placeScore).toBeCloseTo(0.15 * activity.placeWeightFor(openAt.presence, 0), 12);
    expect(openAt.activitySafety).toBeGreaterThan(ACTIVITY_FLOOR);
  });
});

describe('graph/activityStage presence weight in the activity load', () => {
  test('a place counts for less at 23:00 than at midday in the activity safety itself', () => {
    // A hospital is always open, so only the time-of-day presence differs between the two hours.
    const hospital = { elements: [{ lat: LAT, lon: LNG, tags: { amenity: 'hospital' } }] };
    const day = activity.activityAt(sourcesFor(hospital, 12), LAT, LNG, 12, { darkness: 0 });
    const late = activity.activityAt(sourcesFor(hospital, 23), LAT, LNG, 23, { darkness: 1 });
    const loadOf = (a, darkness) => 0.15 * activity.placeWeightFor(a.presence, darkness);

    expect(day.activitySafety).toBeCloseTo(day.floor + (1 - day.floor) * (1 - Math.exp(-loadOf(day, 0))), 12);
    expect(late.activitySafety).toBeCloseTo(late.floor + (1 - late.floor) * (1 - Math.exp(-loadOf(late, 1))), 12);
    expect(late.activitySafety).toBeLessThan(day.activitySafety);
  });
});

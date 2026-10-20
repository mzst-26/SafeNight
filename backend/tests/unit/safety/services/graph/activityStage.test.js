const path = require('path');
const activity = require(path.resolve(__dirname, '../../../../../src/safety/services/graph/activityStage'));
const { ACTIVITY_FLOOR } = require(path.resolve(__dirname, '../../../../../src/safety/scoring/config'));

const LAT = 51.5;
const LNG = -0.1;
const NOW = new Date('2026-10-19T11:00:00Z');
const noTick = () => {};
const sourcesFor = (cctv, places, transit, hour = 12) => activity.collectActivitySources(cctv, places, transit, { hour, now: NOW }, noTick);

describe('graph/activityStage pointOf', () => {
  test('reads a node, a way centre, and returns null without coordinates', () => {
    expect(activity.pointOf({ lat: 1, lon: 2 })).toEqual({ lat: 1, lng: 2 });
    expect(activity.pointOf({ center: { lat: 3, lon: 4 } })).toEqual({ lat: 3, lng: 4 });
    expect(activity.pointOf({ id: 5 })).toBeNull();
    expect(activity.pointOf({ lat: 0, lon: 0 })).toBeNull();
  });
});

describe('graph/activityStage collectActivitySources', () => {
  test('keeps only CCTV and transit nodes with coordinates, and only open places', () => {
    const s = sourcesFor(
      { elements: [{ type: 'node', lat: LAT, lon: LNG }, { type: 'way', id: 1 }, { type: 'node', id: 2 }] },
      { elements: [{ lat: LAT, lon: LNG, tags: { amenity: 'hospital' } }, { lat: LAT, lon: LNG, tags: { amenity: 'pub' } }, { id: 9 }] },
      { elements: [{ type: 'node', lat: LAT, lon: LNG }] },
      5,
    );
    expect(s.cctvNodes).toEqual([{ lat: LAT, lng: LNG }]);
    expect(s.transitNodes).toEqual([{ lat: LAT, lng: LNG }]);
    // At 05:00 the pub is closed and the hospital open.
    expect(activity.activityAt(s, LAT, LNG, 5, { darkness: 1 }).activity.safety).not.toBeNull();
    expect(s.activityAvailable).toBe(true);
  });

  test('missing datasets give an unavailable activity factor', () => {
    const s = sourcesFor(null, null, null);
    expect(s.activityAvailable).toBe(false);
    expect(s.cctvNodes).toEqual([]);
    expect(activity.activityAt(s, LAT, LNG, 12, { darkness: 0 })).toMatchObject({
      cctvCount: 0, transitCount: 0, cctvScore: 0, placeScore: 0, activity: { safety: null, n: 0, prior: ACTIVITY_FLOOR },
      activitySafety: null,
    });
  });

  test('any raw element makes activity available, even one that is filtered out (closed place)', () => {
    const s = sourcesFor(null, { elements: [{ lat: LAT, lon: LNG, tags: { amenity: 'pub' } }] }, null, 5);
    expect(s.activityAvailable).toBe(true);
  });

  test('ticks once per element it reads', () => {
    const tick = jest.fn();
    activity.collectActivitySources(
      { elements: [{}, {}] }, { elements: [{}] }, { elements: [{}, {}, {}] }, { hour: 12, now: NOW }, tick,
    );
    expect(tick).toHaveBeenCalledTimes(6);
  });
});

describe('graph/activityStage activityAt', () => {
  const cctv = { elements: [{ type: 'node', lat: LAT, lon: LNG }] };

  test('nothing nearby but data present gives exactly the floor', () => {
    const s = sourcesFor({ elements: [{ type: 'node', lat: LAT + 0.01, lon: LNG }] }, null, null);
    const a = activity.activityAt(s, LAT, LNG, 12, { darkness: 0 });
    expect(a.activitySafety).toBeCloseTo(ACTIVITY_FLOOR, 12);
    expect(a.activity.n).toBe(8);
    expect(a.cctvCount).toBe(0);
  });

  test('a camera on the spot: load 0.4, score min(1, 0.4), safety from the saturating curve', () => {
    const a = activity.activityAt(sourcesFor(cctv, null, null), LAT, LNG, 12, { darkness: 0 });
    expect(a.cctvCount).toBe(1);
    expect(a.cctvScore).toBeCloseTo(0.4, 12);
    expect(a.activitySafety).toBeCloseTo(ACTIVITY_FLOOR + (1 - ACTIVITY_FLOOR) * (1 - Math.exp(-0.4)), 12);
  });

  test('an open place counts 0.15 times a presence weight that is lower at 23:00 than at midday', () => {
    const places = { elements: [{ lat: LAT, lon: LNG, tags: { amenity: 'hospital' } }] };
    const day = activity.activityAt(sourcesFor(null, places, null, 12), LAT, LNG, 12, { darkness: 0 });
    const night = activity.activityAt(sourcesFor(null, places, null, 23), LAT, LNG, 23, { darkness: 1 });
    expect(day.placeScore).toBeCloseTo(0.15 * activity.placeWeightFor(day.presence, 0), 12);
    expect(night.placeScore).toBeCloseTo(0.15 * activity.placeWeightFor(night.presence), 12);
    expect(night.placeScore).toBeLessThan(day.placeScore);
  });

  test('transit within 150 m adds 0.1 to the load but is not part of the CCTV or place scores', () => {
    const transit = { elements: [{ type: 'node', lat: LAT + 0.001, lon: LNG }] }; // ~111 m
    const a = activity.activityAt(sourcesFor(null, null, transit), LAT, LNG, 12, { darkness: 0 });
    expect(a.transitCount).toBe(1);
    expect(a.cctvScore).toBe(0);
    expect(a.activitySafety).toBeCloseTo(ACTIVITY_FLOOR + (1 - ACTIVITY_FLOOR) * (1 - Math.exp(-0.1)), 12);
  });
});

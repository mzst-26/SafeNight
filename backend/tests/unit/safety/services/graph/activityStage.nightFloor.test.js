const path = require('path');
const activity = require(path.resolve(__dirname, '../../../../../src/safety/services/graph/activityStage'));

const LAT = 51.5;
const LNG = -0.1;
const NOW = new Date('2026-10-19T22:00:00Z');
const noTick = () => {};
// 'rural' has the lowest settlement base (0.08), so presence stays under 0.1 at 23:00 with no venues.
const ruralAt = () => ({ class: 'rural' });

// Data is present (so activity is available) but nothing is within reach: a CCTV about 5.5 km away.
const farCctv = { elements: [{ type: 'node', lat: LAT + 0.05, lon: LNG, tags: {} }] };

function emptyStreetSources(hour) {
  return activity.collectActivitySources(farCctv, null, null, { hour, now: NOW, settlementClassAt: ruralAt }, noTick);
}

// Literal floors: 0.25 at night, 0.4 by day. The mutants change ACTIVITY_FLOOR_NIGHT / ACTIVITY_FLOOR in config.js.
describe('graph/activityStage night floor (literal values)', () => {
  test('activityFloorFor with nobody about in the dark is 0.25', () => {
    expect(activity.activityFloorFor({ presence: 0, darkness: 1 })).toBeCloseTo(0.25, 12);
  });

  test('activityFloorFor by day is 0.4 whatever the presence', () => {
    expect(activity.activityFloorFor({ presence: 0, darkness: 0 })).toBeCloseTo(0.4, 12);
  });

  // Presence is never exactly 0 (a settlement base is always > 0), so the floor sits just above 0.25 here:
  // 0.25 + 0.15 * (presence / 0.1). The exact 0.25 is pinned by activityFloorFor(presence 0) above.
  test('an empty low-presence street at 23:00 with data but nothing nearby sits on the 0.25 night floor', () => {
    const a = activity.activityAt(emptyStreetSources(23), LAT, LNG, 23, { darkness: 1, remoteness: 0 });
    expect(a.presence).toBeLessThan(0.1);
    expect(a.placesOpen).toBe(0);
    expect(a.cctvCount).toBe(0);
    expect(a.floor).toBeGreaterThanOrEqual(0.25);
    expect(a.floor).toBeLessThan(0.25 + 0.15 * (a.presence / 0.1) + 1e-9);
    expect(a.floor).toBeCloseTo(0.25, 1);
    expect(a.activitySafety).toBeCloseTo(a.floor, 12);
  });

  test('the same empty street by day scores exactly 0.4', () => {
    const a = activity.activityAt(emptyStreetSources(12), LAT, LNG, 12, { darkness: 0, remoteness: 0 });
    expect(a.floor).toBeCloseTo(0.4, 12);
    expect(a.activitySafety).toBeCloseTo(0.4, 12);
  });
});

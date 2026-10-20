const path = require('path');
const activity = require(path.resolve(__dirname, '../../../../../src/safety/services/graph/activityStage'));
const cfg = require(path.resolve(__dirname, '../../../../../src/safety/scoring/config'));
const { presenceAt, venueFactor } = require(path.resolve(__dirname, '../../../../../src/safety/scoring/presence'));

const LAT = 51.5;
const LNG = -0.1;
const NOW = new Date('2026-10-19T11:00:00Z');
const noTick = () => {};
const cityOf = (klass) => () => ({ class: klass });

function sources(places, { hour = 23, klass = 'city', cctv = null } = {}) {
  return activity.collectActivitySources(cctv, places, null, { hour, now: NOW, settlementClassAt: cityOf(klass) }, noTick);
}
const pubAt = (dLat = 0) => ({ lat: LAT + dLat, lon: LNG, tags: { amenity: 'pub' } });
const manyPubs = (n) => ({ elements: Array.from({ length: n }, (_, i) => pubAt((i % 10) * 0.0002 + Math.floor(i / 10) * 0.0001)) });

describe('placeWeightFor (replaces the global night discount)', () => {
  test('is 0.25 + 1.5 P, capped at 1', () => {
    expect(activity.placeWeightFor(0)).toBeCloseTo(0.25, 12);
    expect(activity.placeWeightFor(0.1)).toBeCloseTo(0.4, 12);
    expect(activity.placeWeightFor(1)).toBe(1);
  });

  test('by day an open place counts in full whatever the presence, and dusk blends the two', () => {
    expect(activity.placeWeightFor(0, 0)).toBe(1);
    expect(activity.placeWeightFor(0.1, 0.5)).toBeCloseTo(0.5 * 0.4 + 0.5, 12);
  });
});

describe('activityFloorFor (hour and presence dependent)', () => {
  test('daytime is always the full floor; an empty night street gets the lower floor', () => {
    expect(activity.activityFloorFor({ presence: 0, darkness: 0 })).toBeCloseTo(cfg.ACTIVITY_FLOOR, 12);
    expect(activity.activityFloorFor({ presence: 0, darkness: 1 })).toBeCloseTo(cfg.ACTIVITY_FLOOR_NIGHT, 12);
    expect(activity.activityFloorFor({ presence: 0.1, darkness: 1 })).toBeCloseTo(cfg.ACTIVITY_FLOOR, 12);
    expect(activity.activityFloorFor({ presence: 0.9, darkness: 1 })).toBeCloseTo(cfg.ACTIVITY_FLOOR, 12);
  });
  test('rises with presence between the two floors', () => {
    const mid = activity.activityFloorFor({ presence: 0.05, darkness: 1 });
    expect(mid).toBeGreaterThan(cfg.ACTIVITY_FLOOR_NIGHT);
    expect(mid).toBeLessThan(cfg.ACTIVITY_FLOOR);
  });
});

describe('graph/activityStage presence in activityAt', () => {
  test('reports presence from the settlement class, venue density and the hour', () => {
    const s = sources({ elements: [pubAt(), pubAt(0.0001)] });
    const a = activity.activityAt(s, LAT, LNG, 23, { darkness: 1, remoteness: 0 });
    const expected = presenceAt({
      settlementClass: 'city', venueDensity: 2, type: 'residential', hour: 23, lateVenuesNearby: 2,
    });
    expect(a.presence).toBeCloseTo(expected, 12);
    expect(a.venues).toBe(2);
    expect(a.placesOpen).toBe(2);
  });

  test('venue density counts food and drink venues within 1 km even when closed now, and ignores others', () => {
    const places = { elements: [pubAt(), pubAt(0.002), { lat: LAT, lon: LNG, tags: { shop: 'supermarket' } }, pubAt(0.02)] };
    const s = sources(places, { hour: 5 });
    expect(activity.activityAt(s, LAT, LNG, 5, { darkness: 1 }).venues).toBe(2);
  });

  test('a city centre (40+ venues) at 23:00 has far more presence than a village street', () => {
    const places = manyPubs(45);
    const centre = activity.activityAt(sources(places, { klass: 'city' }), LAT, LNG, 23, { darkness: 1 });
    const village = activity.activityAt(sources(places, { klass: 'village' }), LAT, LNG, 23, { darkness: 1 });
    expect(centre.type).toBe('centre');
    expect(centre.presence).toBeGreaterThan(village.presence * 2);
    expect(centre.activitySafety).toBeGreaterThan(village.activitySafety);
  });

  test('remoteness >= 0.6 makes the type a park', () => {
    const a = activity.activityAt(sources({ elements: [pubAt()] }), LAT, LNG, 23, { darkness: 1, remoteness: 0.7 });
    expect(a.type).toBe('park');
  });

  test('a place counts for less at 23:00 than at midday in a residential street', () => {
    const hospital = { elements: [{ lat: LAT, lon: LNG, tags: { amenity: 'hospital' } }] };
    const day = activity.activityAt(sources(hospital, { hour: 12 }), LAT, LNG, 12, { darkness: 0 });
    const late = activity.activityAt(sources(hospital, { hour: 23 }), LAT, LNG, 23, { darkness: 1 });
    expect(late.placeScore).toBeLessThan(day.placeScore + 1e-12);
    const w = activity.placeWeightFor(late.presence);
    expect(late.placeScore).toBeCloseTo(cfg.GRAPH.PLACE_WEIGHT * w, 12);
  });

  test('empty village street at night is worse than an empty day street, and never below the unknown prior', () => {
    const farCctv = { elements: [{ type: 'node', lat: LAT + 0.01, lon: LNG }] };
    const s = sources(null, { klass: 'village', cctv: farCctv });
    const night = activity.activityAt(s, LAT, LNG, 23, { darkness: 1 });
    const day = activity.activityAt(s, LAT, LNG, 12, { darkness: 0 });
    expect(night.activitySafety).toBeLessThan(day.activitySafety);
    expect(day.activitySafety).toBeCloseTo(cfg.ACTIVITY_FLOOR, 12);
    expect(night.activitySafety).toBeCloseTo(night.floor, 12);

    const none = sources(null, { klass: 'village' });
    const unknown = activity.activityAt(none, LAT, LNG, 23, { darkness: 1 });
    expect(unknown.activity.safety).toBeNull();
    expect(unknown.activity.prior).toBeCloseTo(unknown.floor, 12);
    expect(night.activitySafety).toBeGreaterThanOrEqual(unknown.activity.prior - 1e-12);
  });

  test('the same floor is the unknown prior by day', () => {
    const unknown = activity.activityAt(sources(null), LAT, LNG, 12, { darkness: 0 });
    expect(unknown.activity.prior).toBeCloseTo(cfg.ACTIVITY_FLOOR, 12);
  });

  test('guardian counts are returned for the crime stage', () => {
    const s = sources({ elements: [pubAt(), pubAt(0.0001)] }, { cctv: { elements: [{ type: 'node', lat: LAT, lon: LNG }] } });
    const a = activity.activityAt(s, LAT, LNG, 23, { darkness: 1 });
    expect(a.cctvCount).toBe(1);
    expect(a.placesOpen).toBe(2);
  });
});

describe('graph/activityStage settlement lookup', () => {
  test('falls back to city when no lookup is provided or it throws, and caches per ~1 km cell', () => {
    const calls = [];
    const lookup = activity.createSettlementLookup((lat, lng) => { calls.push([lat, lng]); return { class: 'town' }; });
    expect(lookup(LAT, LNG)).toBe('town');
    expect(lookup(LAT + 0.0005, LNG)).toBe('town');
    expect(calls).toHaveLength(1);
    expect(lookup(LAT + 0.05, LNG)).toBe('town');
    expect(calls).toHaveLength(2);
    expect(activity.createSettlementLookup(() => { throw new Error('x'); })(LAT, LNG)).toBe('city');
    expect(activity.createSettlementLookup(() => ({ class: 'galaxy' }))(LAT, LNG)).toBe('city');
  });
});
void venueFactor;

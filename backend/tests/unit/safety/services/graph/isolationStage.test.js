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

describe('graph/isolationStage remoteness lookup and hazard multiplier', () => {
  const { REMOTENESS: { HAZARD_STRENGTH } } = require(path.resolve(__dirname, '../../../../../src/safety/scoring/config'));
  const { toLatLon } = require('../../scoring/fixtures/calibrationScenes');
  const seg = (highway, a, b) => {
    const nA = { ...toLatLon(a), lng: toLatLon(a).lon };
    const nB = { ...toLatLon(b), lng: toLatLon(b).lon };
    return { highway, nA, nB, midLat: (nA.lat + nB.lat) / 2, midLng: (nA.lng + nB.lng) / 2 };
  };
  const at = (e, n) => { const p = toLatLon([e, n]); return [p.lat, p.lon]; };
  const noPlaces = [];

  test('a path 200 m from the only road, with no places, has remoteness 0.8', () => {
    const lookup = iso.createRemotenessLookup([seg('residential', [-300, 200], [300, 200]), seg('footway', [-50, 0], [50, 0])], noPlaces);
    const r = lookup(...at(0, 0));
    expect(r.nearestRoadM).toBeGreaterThan(190);
    expect(r.remoteness).toBeCloseTo(0.8, 6);
  });

  test('a point on a residential street has no distance term; many nearby ways remove the ways term', () => {
    const roads = [];
    for (let i = 0; i < 12; i++) roads.push(seg('residential', [-30 + i * 5, -20], [-30 + i * 5 + 5, -20]));
    roads.push(seg('residential', [-100, 0], [100, 0]));
    const r = iso.createRemotenessLookup(roads, noPlaces)(...at(0, 0));
    expect(r.nearestRoadM).toBeLessThan(2);
    expect(r.waysNear).toBe(10); // capped where the ramp saturates
    expect(r.remoteness).toBeCloseTo(0.1, 6); // only the no-places term remains
  });

  test('onRoad skips the search and treats the point as on a road', () => {
    const lookup = iso.createRemotenessLookup([seg('residential', [-300, 200], [300, 200])], noPlaces);
    expect(lookup(...at(0, 0), true).nearestRoadM).toBe(0);
    expect(lookup(...at(0, 0), false).nearestRoadM).toBe(Infinity);
  });

  test('paths do not count as roads or ways', () => {
    const r = iso.createRemotenessLookup([seg('footway', [-50, 5], [50, 5]), seg('path', [-50, -5], [50, -5])], noPlaces)(...at(0, 0));
    expect(r.nearestRoadM).toBe(Infinity);
    expect(r.waysNear).toBe(0);
  });

  test('open places within 100 m lower remoteness', () => {
    const places = Array.from({ length: 10 }, (_, i) => ({ lat: at(i, 10)[0], lng: at(i, 10)[1] }));
    const roads = [seg('residential', [-300, 200], [300, 200])];
    const without = iso.createRemotenessLookup(roads, noPlaces)(...at(0, 0)).remoteness;
    const withPlaces = iso.createRemotenessLookup(roads, places)(...at(0, 0));
    expect(withPlaces.placesNear).toBe(10);
    expect(withPlaces.remoteness).toBeCloseTo(without - 0.1, 6);
  });

  test('remotenessHazardMultiplier combines hazard and strength: 1 with no hazard, below 1 when remote, dark and unlit', () => {
    expect(iso.remotenessMultiplier({ remoteness: 0.8, presence: 0, darkness: 0, lightingEffective: 0 })).toBe(1);
    const dark = iso.remotenessMultiplier({ remoteness: 0.8, presence: 0, darkness: 1, lightingEffective: 0 });
    const lit = iso.remotenessMultiplier({ remoteness: 0.8, presence: 0, darkness: 1, lightingEffective: 1 });
    expect(dark).toBeCloseTo(1 - HAZARD_STRENGTH * 0.8, 9);
    expect(lit).toBeGreaterThan(dark);
    expect(lit).toBeCloseTo(1 - HAZARD_STRENGTH * 0.8 * 0.65, 9);
  });
});

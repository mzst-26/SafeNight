const {
  buildRoadProximityIndex,
  isNearRoad,
  ROAD_HIGHWAYS,
} = require('../../../../src/safety/scoring/roadProximity');

const LAT = 50.4;
const LNG = -4.1;
const M_LAT = 1 / 111320;
const M_LNG = 1 / (111320 * Math.cos(LAT * Math.PI / 180));
const at = (east, north) => ({ lat: LAT + north * M_LAT, lng: LNG + east * M_LNG });
const segment = (a, b) => {
  const pa = at(...a);
  const pb = at(...b);
  return { aLat: pa.lat, aLng: pa.lng, bLat: pb.lat, bLng: pb.lng };
};

describe('ROAD_HIGHWAYS', () => {
  test('is every road class from trunk to service and no footway-like or path class', () => {
    ['trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service']
      .forEach((h) => expect(ROAD_HIGHWAYS.has(h)).toBe(true));
    ['footway', 'cycleway', 'steps', 'pedestrian', 'path', 'track', 'bridleway']
      .forEach((h) => expect(ROAD_HIGHWAYS.has(h)).toBe(false));
  });
});

describe('isNearRoad', () => {
  // One 400 m road along north = 0, far longer than the 10 m sampling step.
  const index = buildRoadProximityIndex([segment([-200, 0], [200, 0])]);

  test('is true within 25 m of the middle of a long segment that has no vertex there', () => {
    const p = at(0, 20);
    expect(isNearRoad(index, p.lat, p.lng)).toBe(true);
  });

  test('is false beyond 25 m of the road', () => {
    const p = at(0, 30);
    expect(isNearRoad(index, p.lat, p.lng)).toBe(false);
  });

  test('is true just inside the radius (24 m) and false just outside it (27 m)', () => {
    const inside = at(3, 24);
    const outside = at(3, 27);
    expect(isNearRoad(index, inside.lat, inside.lng)).toBe(true);
    expect(isNearRoad(index, outside.lat, outside.lng)).toBe(false);
  });

  test('is false past the end of the road', () => {
    const p = at(260, 0);
    expect(isNearRoad(index, p.lat, p.lng)).toBe(false);
  });

  test('works along a diagonal segment', () => {
    const diagonal = buildRoadProximityIndex([segment([0, 0], [300, 300])]);
    const near = at(150 + 14, 150 - 14); // 20 m perpendicular from the middle
    const far = at(150 + 40, 150 - 40); // 56 m
    expect(isNearRoad(diagonal, near.lat, near.lng)).toBe(true);
    expect(isNearRoad(diagonal, far.lat, far.lng)).toBe(false);
  });

  test('honours a custom radius', () => {
    const p = at(0, 40);
    expect(isNearRoad(index, p.lat, p.lng, 45)).toBe(true);
    expect(isNearRoad(index, p.lat, p.lng, 35)).toBe(false);
  });

  test('an empty index is never near a road', () => {
    expect(isNearRoad(buildRoadProximityIndex([]), LAT, LNG)).toBe(false);
  });

  test('handles a degenerate zero-length segment', () => {
    const point = buildRoadProximityIndex([segment([0, 0], [0, 0])]);
    const p = at(0, 10);
    expect(isNearRoad(point, p.lat, p.lng)).toBe(true);
  });

  test('does not mutate the segments it is given', () => {
    const segs = [segment([-50, 0], [50, 0])];
    const snapshot = JSON.parse(JSON.stringify(segs));
    buildRoadProximityIndex(segs);
    expect(segs).toEqual(snapshot);
  });

  test('throws TypeError for non-finite coordinates or a bad radius', () => {
    expect(() => isNearRoad(index, NaN, LNG)).toThrow(TypeError);
    expect(() => isNearRoad(index, LAT, LNG, -1)).toThrow(TypeError);
  });
});

describe('isNearRoad performance shape', () => {
  test('answers 20,000 queries against 5,000 segments well under a second (no O(n*m) scan)', () => {
    const segs = [];
    for (let i = 0; i < 5000; i++) {
      const x = (i % 100) * 150;
      const y = Math.floor(i / 100) * 150;
      segs.push(segment([x, y], [x + 100, y]));
    }
    const dense = buildRoadProximityIndex(segs);
    const started = Date.now();
    let near = 0;
    for (let q = 0; q < 20000; q++) {
      const p = at((q * 37) % 15000, (q * 53) % 7500);
      if (isNearRoad(dense, p.lat, p.lng)) near++;
    }
    expect(Date.now() - started).toBeLessThan(1000);
    expect(near).toBeGreaterThan(0);
  });
});

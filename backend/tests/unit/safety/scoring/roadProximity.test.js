const {
  buildRoadProximityIndex,
  isNearRoad,
  ROAD_HIGHWAYS,
  BARRIER_HIGHWAYS,
  classifyWayContext,
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
  test('is every road class from primary to service and no footway-like, path or motorway/trunk class', () => {
    ['primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service']
      .forEach((h) => expect(ROAD_HIGHWAYS.has(h)).toBe(true));
    ['footway', 'cycleway', 'steps', 'pedestrian', 'path', 'track', 'bridleway']
      .forEach((h) => expect(ROAD_HIGHWAYS.has(h)).toBe(false));
    // A footway beside or over a motorway/trunk is not a sidewalk: those roads are barriers, not street context.
    ['motorway', 'motorway_link', 'trunk', 'trunk_link']
      .forEach((h) => expect(ROAD_HIGHWAYS.has(h)).toBe(false));
  });

  test('BARRIER_HIGHWAYS is exactly motorway, trunk and their links', () => {
    expect([...BARRIER_HIGHWAYS].sort()).toEqual(['motorway', 'motorway_link', 'trunk', 'trunk_link']);
  });
});

describe('classifyWayContext (way level: alongside, crossing or isolated)', () => {
  // A 400 m residential street along north = 0 and a 400 m dual carriageway along north = 100.
  const street = buildRoadProximityIndex([segment([-200, 0], [200, 0])]);
  const trunk = buildRoadProximityIndex([segment([-300, 100], [300, 100])]);
  const empty = buildRoadProximityIndex([]);
  const way = (...pts) => pts.slice(1).map((b, i) => ({ a: at(...pts[i]), b: at(...b) }));
  const classify = (segs, roads = street, barriers = trunk) => classifyWayContext(segs, roads, barriers);

  test('a footway running along a street 12 m away is alongside', () => {
    expect(classify(way([-100, 12], [100, 12]))).toBe('alongside');
  });

  test('a way that is near the street at only one end (under 60% of its length) is isolated', () => {
    // 240 m path leaving the street: only the first ~25 m (about 10%) is within 25 m of it.
    expect(classify(way([0, 20], [0, 55], [0, 260]), street, empty)).toBe('isolated');
  });

  test('a long way at a right angle to the street is not alongside, though 62% of it is within 25 m', () => {
    expect(classify(way([0, -40], [0, 40]), street, empty)).toBe('isolated');
  });

  test('bridge=yes plus a barrier road below is an extra crossing signal; without the tag the same way is isolated', () => {
    const slanting = way([0, 60], [22, 82]);
    expect(classify(slanting, empty)).toBe('isolated');
    expect(classifyWayContext(slanting, empty, trunk, { bridge: true })).toBe('crossing');
    expect(classifyWayContext(slanting, empty, trunk, { bridge: false })).toBe('isolated');
    expect(classifyWayContext(slanting, empty, trunk, {})).toBe('isolated');
  });

  test('bridge=yes far from any barrier does not become a crossing', () => {
    expect(classifyWayContext(way([0, -300], [22, -280]), empty, trunk, { bridge: true })).toBe('isolated');
  });

  test('a short link (under 40 m) ending at a street is still alongside', () => {
    expect(classify(way([0, 2], [0, 30]), street, empty)).toBe('alongside');
  });

  test('a way geometrically crossing a trunk is crossing, even with a street within 25 m', () => {
    const asBridge = way([-40, 90], [-40, 110]);
    expect(classify(asBridge, buildRoadProximityIndex([segment([-200, 80], [200, 80])]), trunk)).toBe('crossing');
  });

  test('a footbridge over a trunk is crossing and not sidewalk-like even when its midpoint is near a road', () => {
    // Trunk at north = 100 is also the only "road": the old midpoint test called this sidewalk-like.
    expect(classify(way([0, 60], [0, 140]), empty, trunk)).toBe('crossing');
  });

  test('a path passing a trunk 10 m away in parallel is not crossing, and a trunk is not street context', () => {
    expect(classify(way([-100, 110], [100, 110]), empty, trunk)).toBe('isolated');
  });

  test('a shallow geometric crossing of a trunk still counts as crossing', () => {
    expect(classify(way([-100, 60], [100, 140]), empty, trunk)).toBe('crossing');
  });

  test('a path ending within 15 m of the trunk at a right angle (no intersection) is crossing', () => {
    expect(classify(way([0, 40], [0, 90]), empty, trunk)).toBe('crossing');
  });

  test('an end 30 m from the trunk is not crossing', () => {
    expect(classify(way([0, 20], [0, 70]), empty, trunk)).toBe('isolated');
  });

  test('empty way is isolated, and missing barrier index means no crossing', () => {
    expect(classify([])).toBe('isolated');
    expect(classifyWayContext(way([0, 60], [0, 140]), empty, null)).toBe('isolated');
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
  test('answers 20,000 queries against 5,000 segments', () => {
    const segs = [];
    for (let i = 0; i < 5000; i++) {
      const x = (i % 100) * 150;
      const y = Math.floor(i / 100) * 150;
      segs.push(segment([x, y], [x + 100, y]));
    }
    const dense = buildRoadProximityIndex(segs);
    let near = 0;
    for (let q = 0; q < 20000; q++) {
      const p = at((q * 37) % 15000, (q * 53) % 7500);
      if (isNearRoad(dense, p.lat, p.lng)) near++;
    }
    expect(near).toBeGreaterThan(0);
  });
});

const path = require('path');
const osm = require(path.resolve(__dirname, '../../../../../src/safety/services/graph/osmIndex'));
const { ROAD_TYPE_SCORES } = require(path.resolve(__dirname, '../../../../../src/safety/scoring/config'));

const node = (id, lat, lon) => ({ type: 'node', id, lat, lon });
const way = (id, nodes, tags) => ({ type: 'way', id, nodes, tags });

const DATA = {
  elements: [
    node(1, 51.5, -0.1), node(2, 51.5, -0.098), node(3, 51.5, -0.098), node(4, 51.5, -0.096),
    way(10, [1, 2, 3], { highway: 'residential' }),
    way(11, [3, 4], { highway: 'footway' }),
    way(12, [2, 4], { highway: 'motorway' }),
    way(13, [1, 99], { highway: 'residential' }),
    way(14, [1, 2]),
    { type: 'way', id: 15, tags: { highway: 'residential' } },
  ],
};

describe('graph/osmIndex', () => {
  test('WALKABLE_HIGHWAYS is exactly the classes with a road score', () => {
    expect([...osm.WALKABLE_HIGHWAYS].sort()).toEqual(Object.keys(ROAD_TYPE_SCORES).sort());
    expect(osm.WALKABLE_HIGHWAYS.has('motorway')).toBe(false);
  });

  test('indexNodes keys nodes by id with lng from lon, and ticks once per element', () => {
    const tick = jest.fn();
    const nodes = osm.indexNodes(DATA, tick);
    expect(nodes.size).toBe(4);
    expect(nodes.get(2)).toEqual({ lat: 51.5, lng: -0.098, id: 2 });
    expect(tick).toHaveBeenCalledTimes(DATA.elements.length);
    expect(osm.indexNodes({ elements: [] }).size).toBe(0);
  });

  test('buildNodeGrid supports lookups near a node', () => {
    const grid = osm.buildNodeGrid(osm.indexNodes(DATA));
    expect(grid).toBeDefined();
    const { findNearby } = require(path.resolve(__dirname, '../../../../../src/safety/services/geo'));
    expect(findNearby(grid, 51.5, -0.1, 20).map((n) => n.id)).toEqual([1]);
  });

  test('isHighwayWay needs a way with nodes and a highway tag', () => {
    expect(osm.isHighwayWay(DATA.elements[4])).toBe(true);
    expect(osm.isHighwayWay(DATA.elements[8])).toBe(false);
    expect(osm.isHighwayWay(DATA.elements[9])).toBe(false);
    expect(osm.isHighwayWay(DATA.elements[0])).toBe(false);
  });

  test('computeNodeDegree counts every highway segment, walkable or not, with both nodes known', () => {
    const degree = osm.computeNodeDegree(DATA, osm.indexNodes(DATA));
    // way 10: 1-2, 2-3. way 11: 3-4. way 12 (motorway): 2-4. way 13: 1-99 ignored (99 unknown).
    expect(degree.get(1)).toBe(1);
    expect(degree.get(2)).toBe(3);
    expect(degree.get(3)).toBe(2);
    expect(degree.get(4)).toBe(2);
    expect(degree.has(99)).toBe(false);
  });

  test('segmentLengthM never returns less than the 0.5 m floor', () => {
    expect(osm.segmentLengthM({ lat: 51.5, lng: -0.1 }, { lat: 51.5, lng: -0.1 })).toBe(0.5);
    expect(osm.segmentLengthM({ lat: 51.5, lng: -0.1 }, { lat: 51.5, lng: -0.1 + 0.000001 })).toBe(0.5);
    expect(osm.segmentLengthM({ lat: 51.5, lng: -0.1 }, { lat: 51.5, lng: -0.098 })).toBeGreaterThan(100);
  });

  test('forEachWalkableSegment visits walkable pairs with known nodes, in order, including the zero-length one', () => {
    const visited = [];
    osm.forEachWalkableSegment(DATA, osm.indexNodes(DATA), (el, i, nA, nB, dist) => {
      visited.push([el.id, i, nA.id, nB.id, dist]);
    });
    expect(visited.map(([w, i, a, b]) => [w, i, a, b])).toEqual([[10, 0, 1, 2], [10, 1, 2, 3], [11, 0, 3, 4]]);
    expect(visited[1][4]).toBe(0.5);
  });

  test('collectWalkableSegments adds index, midpoint, tags and highway', () => {
    const segments = osm.collectWalkableSegments(DATA, osm.indexNodes(DATA));
    expect(segments).toHaveLength(3);
    expect(segments.map((s) => s.idx)).toEqual([0, 1, 2]);
    expect(segments[0]).toMatchObject({ from: 1, to: 2, highway: 'residential', tags: { highway: 'residential' } });
    expect(segments[0].midLat).toBeCloseTo(51.5, 12);
    expect(segments[0].midLng).toBeCloseTo(-0.099, 12);
    expect(segments[2].highway).toBe('footway');
  });
});

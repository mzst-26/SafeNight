const path = require('path');
const builder = require(path.resolve(__dirname, '../../../../../src/safety/services/graph/edgeBuilder'));
const { PRIOR_SAFETY, ACTIVITY_FLOOR } = require(path.resolve(__dirname, '../../../../../src/safety/scoring/config'));

const LAT = 51.5;
const LNG = -0.1;
const D = 0.0016;
const NIGHT = { hour: 23, now: new Date('2026-10-19T22:30:00Z'), crimeStatus: 'ok' };
const BBOX = { south: LAT - 0.002, north: LAT + 0.002, west: LNG - 0.002, east: LNG + 0.008 };

const node = (id, lat, lon) => ({ type: 'node', id, lat, lon });

// Straight residential street 1-2-3-4: edges 0 (1->2), 1 (2->3), 2 (3->4). Node 1 and node 4 are the ends.
function street() {
  return {
    elements: [
      node(1, LAT, LNG), node(2, LAT, LNG + D), node(3, LAT, LNG + 2 * D), node(4, LAT, LNG + 3 * D),
      { type: 'way', id: 10, nodes: [1, 2, 3, 4], tags: { highway: 'residential' } },
    ],
  };
}

describe('graph/edgeBuilder dead ends at either end of a segment', () => {
  test('a segment is a dead end when only its far (to) node has degree 1', async () => {
    const g = await builder.buildGraph(street(), null, null, null, null, [], BBOX, NIGHT);
    expect(g.nodeDegree.get(3)).toBe(2);
    expect(g.nodeDegree.get(4)).toBe(1);
    expect(g.edges[2]).toMatchObject({ from: 3, to: 4, isDeadEnd: true });
  });

  test('a segment between two degree-2 nodes is not a dead end', async () => {
    const g = await builder.buildGraph(street(), null, null, null, null, [], BBOX, NIGHT);
    expect(g.edges[1]).toMatchObject({ from: 2, to: 3, isDeadEnd: false });
  });
});

describe('graph/edgeBuilder crime score during an outage', () => {
  test('an unavailable crime status leaves crimeScore at the prior, never at fully safe', async () => {
    const g = await builder.buildGraph(street(), null, null, null, null, [], BBOX, { ...NIGHT, crimeStatus: 'unavailable' });
    for (const edge of g.edges) expect(edge.crimeScore).toBe(PRIOR_SAFETY.crime);
    expect(PRIOR_SAFETY.crime).toBe(0.6);
  });
});

describe('graph/edgeBuilder trafficScore', () => {
  test('is the mean of road safety and activity safety when activity is known', async () => {
    // One camera exactly at the midpoint of edge 1 (2 -> 3): load 0.4, so activity safety is the saturating curve.
    const cctv = { elements: [node(99, LAT, LNG + 1.5 * D)] };
    const g = await builder.buildGraph(street(), null, cctv, null, null, [], BBOX, NIGHT);
    const roadSafety = 0.5; // residential, no surface penalty
    const activitySafety = ACTIVITY_FLOOR + (1 - ACTIVITY_FLOOR) * (1 - Math.exp(-0.4));
    expect(g.edges[1].nearbyCctvCount).toBe(1);
    expect(g.edges[1].trafficScore).toBeCloseTo((roadSafety + activitySafety) / 2, 12);
  });

  test('falls back to road safety alone when no activity data exists', async () => {
    const g = await builder.buildGraph(street(), null, null, null, null, [], BBOX, NIGHT);
    expect(g.edges[1].trafficScore).toBe(0.5);
  });
});

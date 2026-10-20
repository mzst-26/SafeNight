const path = require('path');
const builder = require(path.resolve(__dirname, '../../../../../src/safety/services/graph/edgeBuilder'));

const LAT = 51.5;
const LNG = -0.1;
const D = 0.0016;
const NIGHT = { hour: 23, now: new Date('2026-10-19T22:30:00Z'), crimeStatus: 'ok' };
const BBOX = { south: LAT - 0.002, north: LAT + 0.002, west: LNG - 0.002, east: LNG + 0.008 };

const node = (id, lat, lon) => ({ type: 'node', id, lat, lon });

function street(tags = { highway: 'residential' }) {
  return {
    elements: [
      node(1, LAT, LNG), node(2, LAT, LNG + D), node(3, LAT, LNG + 2 * D), node(4, LAT, LNG + 3 * D),
      { type: 'way', id: 10, nodes: [1, 2, 3, 4], tags },
    ],
  };
}

describe('graph/edgeBuilder roadFactorOf', () => {
  test('is the class score minus the surface penalty, clamped to [0, 1]', () => {
    expect(builder.roadFactorOf('residential', {})).toEqual({ roadSafety: 0.5, surfacePenalty: 0 });
    expect(builder.roadFactorOf('residential', { surface: 'gravel' })).toEqual({ roadSafety: 0.46, surfacePenalty: 0.04 });
    expect(builder.roadFactorOf('steps', { surface: 'mud' }).roadSafety).toBe(0);
    expect(builder.roadFactorOf('primary', { surface: 'asphalt' }).roadSafety).toBe(0.95);
  });

  test('an inherited property name is not a surface penalty, and an unknown class uses the fallback', () => {
    expect(builder.roadFactorOf('residential', { surface: 'constructor' }).surfacePenalty).toBe(0);
    expect(builder.roadFactorOf('bridleway', {}).roadSafety).toBe(0.3);
  });
});

describe('graph/edgeBuilder buildGraph', () => {
  test('returns the graph structure with the scored edge fields', async () => {
    const g = await builder.buildGraph(street({ highway: 'residential', name: 'High St', sidewalk: 'both', surface: 'dirt', maxspeed: '30 mph' }),
      null, null, null, null, [], BBOX, { level: 'extra', ...NIGHT });
    expect(Object.keys(g).sort()).toEqual([
      'adjacency', 'cctvNodes', 'darkness', 'edges', 'nodeDegree', 'nodeGrid', 'osmNodes', 'transitNodes', 'weights',
    ]);
    expect(g.edges).toHaveLength(3);
    expect(g.edges[1]).toMatchObject({
      idx: 1, from: 2, to: 3, highway: 'residential', roadName: 'High St', hasSidewalk: true,
      surfaceType: 'dirt', surfacePenalty: 0.06, maxspeed: '30 mph', isTunnel: false, isLit: false, litTag: null,
      isDeadEnd: false, penalty: 0,
    });
    expect(g.edges[0].isDeadEnd).toBe(true);
    expect(g.edges[1].start).toEqual({ lat: LAT, lng: LNG + D });
    expect(g.edges[1].safetyScore).toBeCloseTo(1 - g.edges[1].risk, 12);
    expect(g.adjacency.get(2)).toEqual([{ edgeIdx: 0, neighborId: 1 }, { edgeIdx: 1, neighborId: 3 }]);
    expect(g.darkness).toBeGreaterThan(0.99);
  });

  test('explicit lit and tunnel tags are carried to the edge', async () => {
    const g = await builder.buildGraph(street({ highway: 'service', lit: 'yes', tunnel: 'yes' }), null, null, null, null, [], BBOX, NIGHT);
    expect(g.edges[1]).toMatchObject({ isLit: true, litTag: 'yes', isTunnel: true, litEstimate: 'lit' });
  });

  test('lightsCacheByEdgeIdx is read by edge index', async () => {
    const plain = await builder.buildGraph(street(), null, null, null, null, [], BBOX, NIGHT);
    const cached = await builder.buildGraph(street(), null, null, null, null, [], BBOX, {
      ...NIGHT, lightsCacheByEdgeIdx: new Map([[1, { lit_status: 'unlit', confidence: 0.9 }]]),
    });
    expect(cached.edges[1].litEstimate).toBe('unlit');
    expect(cached.edges[0].risk).toBe(plain.edges[0].risk);
    expect(cached.edges[1].risk).toBeGreaterThan(plain.edges[1].risk);
  });

  test('cancels from the first long loop', async () => {
    const elements = Array.from({ length: 3000 }, (_, i) => node(i + 1, LAT, LNG));
    await expect(builder.buildGraph({ elements }, null, null, null, null, [], BBOX, { ...NIGHT, shouldCancel: () => true }))
      .rejects.toMatchObject({ code: 'SEARCH_CANCELLED' });
  });

  test('an empty network builds an empty graph', async () => {
    const g = await builder.buildGraph({ elements: [] }, null, null, null, null, [], BBOX, NIGHT);
    expect(g.edges).toEqual([]);
    expect(g.adjacency.size).toBe(0);
  });
});

describe('graph/edgeBuilder prepareContext and scoreSegments', () => {
  test('the context exposes the stage products in dependency order', () => {
    const ctx = builder.prepareContext(street(), null, null, null, null, [], BBOX, { level: 'extra', ...NIGHT }, () => {});
    expect(ctx.segments).toHaveLength(3);
    expect(ctx.osmNodes.size).toBe(4);
    expect(ctx.nodeDegree.get(2)).toBe(2);
    expect(ctx.crimeStatus).toBe('ok');
    expect(typeof ctx.roadIndex).toBe('function');
    expect(ctx.areaStats.size).toBeGreaterThan(0);
  });

  test('scoreSegments pairs every segment with an edge and links both directions', () => {
    const ctx = builder.prepareContext(street(), null, null, null, null, [], BBOX, NIGHT, () => {});
    const { edges, adjacency } = builder.scoreSegments(ctx, {}, () => {});
    expect(edges.map((e) => e.idx)).toEqual([0, 1, 2]);
    expect(adjacency.get(1)).toEqual([{ edgeIdx: 0, neighborId: 2 }]);
    expect(adjacency.get(4)).toEqual([{ edgeIdx: 2, neighborId: 3 }]);
  });

  test('scoreSegment returns the same edge as the graph holds', () => {
    const ctx = builder.prepareContext(street(), null, null, null, null, [], BBOX, NIGHT, () => {});
    const edge = builder.scoreSegment(ctx.segments[1], ctx, null);
    const { edges } = builder.scoreSegments(ctx, {}, () => {});
    expect(edge).toEqual(edges[1]);
  });
});

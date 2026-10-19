/**
 * safetyGraph v2: the lighting features buildGraph feeds to inferLighting.
 * Spec section 11.3 (sidewalk-like footways, neighbouring lit ways, absence only for isolated paths).
 * Tiny synthetic scenes in metres east/north of a point, so every result is deterministic.
 */

const path = require('path');
const { buildGraph } = require(path.resolve(__dirname, '../../../../src/safety/services/safetyGraph'));
const { effectiveLit } = require(path.resolve(__dirname, '../../../../src/safety/scoring/lightingInference'));

const LAT0 = 50.3745;
const LNG0 = -4.1385;
const M_LAT = 1 / 111320;
const M_LNG = 1 / (111320 * Math.cos(LAT0 * Math.PI / 180));
const NIGHT = { hour: 23, now: new Date('2026-10-19T22:30:00Z') };

/** Scene builder: ways are {name, tags, points:[[e,n],...]}; vertices that coincide share a node. */
function scene({ ways, lamps = [], litWayNames = [] }) {
  const nodes = new Map();
  let nextId = 1;
  const idOf = ([e, n]) => {
    const key = `${e},${n}`;
    if (!nodes.has(key)) nodes.set(key, { id: nextId++, e, n });
    return nodes.get(key).id;
  };
  const wayEls = ways.map((w, i) => ({
    type: 'way', id: 100 + i, nodes: w.points.map(idOf), tags: { ...w.tags, name: w.name },
  }));
  const nodeEls = [...nodes.values()].map(({ id, e, n }) => ({
    type: 'node', id, lat: LAT0 + n * M_LAT, lon: LNG0 + e * M_LNG,
  }));
  const lightEls = lamps.map(([e, n]) => ({
    type: 'node', lat: LAT0 + n * M_LAT, lon: LNG0 + e * M_LNG, tags: { highway: 'street_lamp' },
  }));
  wayEls.filter((w) => litWayNames.includes(w.tags.name)).forEach((w) => lightEls.push({
    type: 'way', id: w.id, nodes: w.nodes, tags: { lit: 'yes' },
  }));
  const bbox = { south: LAT0 - 0.01, north: LAT0 + 0.01, west: LNG0 - 0.01, east: LNG0 + 0.01 };
  return { roadData: { elements: [...nodeEls, ...wayEls] }, lightData: { elements: lightEls }, bbox };
}

async function build(s) {
  return buildGraph(s.roadData, s.lightData, null, null, null, [], s.bbox, { level: 'extra', ...NIGHT });
}

const edgeNamed = (graph, name) => graph.edges.find((e) => e.roadName === name);
const road = (name, y, tags = { highway: 'residential' }) => ({ name, tags, points: [[0, y], [200, y]] });

describe('buildGraph v2: footway beside a road is sidewalk-like', () => {
  test('a footway 10 m from a residential road uses the sidewalk prior (0.72)', async () => {
    const graph = await build(scene({ ways: [road('main', 0), road('walk', 10, { highway: 'footway' })] }));
    expect(edgeNamed(graph, 'walk').pLit).toBeCloseTo(0.72, 6);
    expect(edgeNamed(graph, 'walk').litEstimate).toBe('estimated_lit');
  });

  test('a footway 100 m from any road is isolated (0.33)', async () => {
    const graph = await build(scene({ ways: [road('main', 0), road('park', 100, { highway: 'footway' })] }));
    expect(edgeNamed(graph, 'park').pLit).toBeCloseTo(0.33, 6);
    expect(edgeNamed(graph, 'park').litEstimate).toBe('estimated_unlit');
  });

  test('the boundary is about 25 m: 20 m is sidewalk-like, 30 m is isolated', async () => {
    const graph = await build(scene({
      ways: [road('main', 0), road('near', 20, { highway: 'cycleway' }), road('far', -30, { highway: 'steps' })],
    }));
    expect(edgeNamed(graph, 'near').pLit).toBeCloseTo(0.72, 6);
    expect(edgeNamed(graph, 'far').pLit).toBeCloseTo(0.33, 6);
  });

  test('another footway or a path next to it does not make a footway sidewalk-like', async () => {
    const graph = await build(scene({
      ways: [road('a', 0, { highway: 'footway' }), road('b', 8, { highway: 'path' }), road('c', 16, { highway: 'footway' })],
    }));
    expect(edgeNamed(graph, 'a').pLit).toBeCloseTo(0.33, 6);
    expect(edgeNamed(graph, 'c').pLit).toBeCloseTo(0.33, 6);
  });

  test('every road class from service to trunk makes a footway beside it sidewalk-like', async () => {
    const classes = ['trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service'];
    const ways = [];
    classes.forEach((highway, i) => {
      ways.push({ name: `r${i}`, tags: { highway }, points: [[0, i * 200], [100, i * 200]] });
      ways.push({ name: `f${i}`, tags: { highway: 'footway' }, points: [[0, i * 200 + 10], [100, i * 200 + 10]] });
    });
    const graph = await build(scene({ ways }));
    classes.forEach((highway, i) => expect(edgeNamed(graph, `f${i}`).pLit).toBeCloseTo(0.72, 6));
  });

  test('a path or track is low even beside a road (0.12)', async () => {
    const graph = await build(scene({ ways: [road('main', 0), road('trail', 10, { highway: 'path' })] }));
    expect(edgeNamed(graph, 'trail').pLit).toBeCloseTo(0.12, 6);
  });

  test('a footway beside a road is less risky than the same footway far from any road', async () => {
    const graph = await build(scene({ ways: [road('main', 0), road('walk', 10, { highway: 'footway' })] }));
    const isolated = await build(scene({ ways: [road('main', 0), road('walk', 100, { highway: 'footway' })] }));
    expect(edgeNamed(graph, 'walk').risk).toBeLessThan(edgeNamed(isolated, 'walk').risk);
  });
});

describe('buildGraph v2: the unlit-path isolation penalty is for isolated paths, not sidewalks', () => {
  // A lamp 40 m from the footway midpoint: outside the 30 m lamp radius, inside the 60 m isolation radius.
  const lampNear = [[100, 50]];

  test('a sidewalk footway beside a road scores the same with or without a lamp within 60 m', async () => {
    const ways = [road('main', 0), road('walk', 10, { highway: 'footway' })];
    const bare = await build(scene({ ways }));
    const lamped = await build(scene({ ways, lamps: lampNear }));
    expect(edgeNamed(lamped, 'walk').risk).toBeCloseTo(edgeNamed(bare, 'walk').risk, 12);
  });

  test('an isolated footway scores worse without a lamp within 60 m than with one', async () => {
    const ways = [road('main', 0), road('park', 100, { highway: 'footway' })];
    const bare = await build(scene({ ways }));
    const lamped = await build(scene({ ways, lamps: [[100, 140]] }));
    expect(edgeNamed(bare, 'park').risk).toBeGreaterThan(edgeNamed(lamped, 'park').risk);
  });
});

describe('buildGraph v2: absence of mapped lamps applies only to isolated paths', () => {
  // A mapped-lamp-rich cell: lamps along a lit-looking road elsewhere, none near the ways under test.
  const farLamps = Array.from({ length: 12 }, (_, i) => [i * 15, 160]);

  test('an isolated footway in a lamp-mapped area is lowered (0.33 * 0.6)', async () => {
    const graph = await build(scene({
      ways: [road('park', 0, { highway: 'footway' }), road('park2', 60, { highway: 'footway' }), road('park3', 120, { highway: 'footway' })],
      lamps: farLamps,
    }));
    expect(edgeNamed(graph, 'park').pLit).toBeCloseTo(0.33 * 0.6, 6);
  });

  test('a road in the same lamp-mapped area keeps its prior: no mapped lamp nearby does not lower it', async () => {
    const graph = await build(scene({
      ways: [road('res', 0), road('res2', 60), road('res3', 120)],
      lamps: farLamps,
    }));
    expect(edgeNamed(graph, 'res').pLit).toBeCloseTo(0.88, 6);
  });

  test('a sidewalk footway in a lamp-mapped area keeps the sidewalk prior', async () => {
    const graph = await build(scene({
      ways: [road('main', 0), road('walk', 10, { highway: 'footway' }), road('main2', 60), road('main3', 120)],
      lamps: farLamps,
    }));
    expect(edgeNamed(graph, 'walk').pLit).toBeCloseTo(0.72, 6);
  });
});

describe('buildGraph v2: neighbouring lit=yes ways are weaker evidence than lamps', () => {
  const lane = { name: 'lane', tags: { highway: 'service' }, points: [[0, 0], [200, 0]] };
  const litNext = { name: 'litnext', tags: { highway: 'residential', lit: 'yes' }, points: [[100, 20], [300, 20]] };

  test('a service lane next to a lit=yes way takes the neighbour-lit estimate, not the lamp one', async () => {
    const graph = await build(scene({ ways: [lane, litNext], litWayNames: ['litnext'] }));
    const edge = edgeNamed(graph, 'lane');
    expect(edge.pLit).toBeCloseTo(0.85, 6);
    expect(edge.lightScore).toBeCloseTo(effectiveLit({ pLit: 0.85, n: 6 }), 6); // service n3 + 3
  });

  test('a real lamp on the same lane gives more evidence than the lit neighbour', async () => {
    const neighbour = await build(scene({ ways: [lane, litNext], litWayNames: ['litnext'] }));
    const lamp = await build(scene({ ways: [lane], lamps: [[100, 5]] }));
    expect(edgeNamed(lamp, 'lane').lightScore).toBeGreaterThan(edgeNamed(neighbour, 'lane').lightScore);
    expect(edgeNamed(lamp, 'lane').lightScore).toBeCloseTo(effectiveLit({ pLit: 0.85, n: 9 }), 6);
  });

  test('a lit neighbour beyond 30 m has no effect', async () => {
    const far = { ...litNext, points: [[100, 90], [300, 90]] };
    const graph = await build(scene({ ways: [lane, far], litWayNames: ['litnext'] }));
    expect(edgeNamed(graph, 'lane').pLit).toBeCloseTo(0.62, 6);
  });
});

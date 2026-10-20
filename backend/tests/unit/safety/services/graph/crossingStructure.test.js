/**
 * Owner feedback, real location: the footbridge over the A38 'The Parkway' (Plymouth) between Culver Way and
 * Reddington Road read green. Cause: sidewalk-like was decided at one sample (the way midpoint within 25 m of ANY
 * non-path road, trunk included), so a bridge over a trunk road counted as that road's sidewalk (prior 0.72).
 *
 * These scenes replicate it synthetically (no lamp data, no places, no crime, woods-like emptiness) and run the
 * REAL buildGraph. Scores are round(100 * (1 - edge.risk)) at 23:00, the value the API shows.
 */
const path = require('path');
const { buildGraph } = require(path.resolve(__dirname, '../../../../../src/safety/services/safetyGraph'));
const { NIGHT, buildScene } = require('../../scoring/fixtures/calibrationScenes');

const OPTIONS = { level: 'extra', crimeStatus: 'ok', ...NIGHT };
const score = (edge) => Math.round(100 * (1 - edge.risk));

async function build(scene) {
  return buildGraph(scene.roadData, scene.lightData, scene.cctvData, scene.placeData,
    scene.transitData, scene.crimes, scene.bbox, OPTIONS);
}
const named = (graph, name) => graph.edges.filter((e) => e.roadName === name);

const TRUNK = { highway: 'trunk', maxspeed: '60 mph', lit: 'yes', oneway: 'yes' };
const STREET = { highway: 'residential', maxspeed: '30 mph' };

/** 150 m footway running north across an E-W trunk road, joined to a quiet street at each end. */
function footbridgeScene(footwayTags = { highway: 'footway' }) {
  return buildScene({
    ways: [
      { name: 'target', tags: footwayTags, points: [[0, -75], [0, 75]] },
      { name: 'trunk', tags: TRUNK, points: [[-300, 0], [300, 0]] },
      { name: 'culver', tags: STREET, points: [[-150, 75], [0, 75], [150, 75]] },
      { name: 'reddington', tags: STREET, points: [[-150, -75], [0, -75], [150, -75]] },
    ],
  });
}

describe('footbridge over a trunk road with no lamp or lit-tag data', () => {
  test('is a crossing structure: isolated, uncertain prior 0.30 (n 3)', async () => {
    const [edge] = named(await build(footbridgeScene()), 'target');
    expect(edge.pLit).toBeCloseTo(0.3, 9);
    expect(edge.litEstimate).toBe('estimated_unlit');
  });

  test('scores below 35 (Use Caution), not green', async () => {
    const [edge] = named(await build(footbridgeScene()), 'target');
    expect(score(edge)).toBeLessThan(35);
  });

  test('takes the unlit isolated-path penalty (nobody passes, nothing lit)', async () => {
    const [edge] = named(await build(footbridgeScene()), 'target');
    expect(edge.isDeadEnd).toBe(false);
    const withoutPenalty = await build(footbridgeScene({ highway: 'footway', lit: 'yes' }));
    expect(score(named(withoutPenalty, 'target')[0])).toBeGreaterThan(score(edge) + 20);
  });

  test('an explicit lit=yes tag still wins (ground truth), no crossing override', async () => {
    const [edge] = named(await build(footbridgeScene({ highway: 'footway', lit: 'yes' })), 'target');
    expect(edge.pLit).toBeCloseTo(0.95, 9);
  });

  test('a footway of the same length beside a quiet street (sidewalk) is not penalised as a crossing', async () => {
    const scene = buildScene({
      ways: [
        { name: 'target', tags: { highway: 'footway' }, points: [[-75, 12], [75, 12]] },
        { name: 'street', tags: STREET, points: [[-150, 0], [-75, 0], [75, 0], [150, 0]] },
        { name: 'linkW', tags: { highway: 'footway' }, points: [[-75, 12], [-75, 0]] },
        { name: 'linkE', tags: { highway: 'footway' }, points: [[75, 12], [75, 0]] },
      ],
    });
    const [edge] = named(await build(scene), 'target');
    expect(edge.pLit).toBeCloseTo(0.72, 9);
  });

  test('a footway beside a trunk road (not crossing) is not a sidewalk of the trunk', async () => {
    const scene = buildScene({
      ways: [
        { name: 'target', tags: { highway: 'footway' }, points: [[-75, 10], [75, 10]] },
        { name: 'trunk', tags: TRUNK, points: [[-300, 0], [300, 0]] },
      ],
    });
    const [edge] = named(await build(scene), 'target');
    expect(edge.pLit).toBeCloseTo(0.33, 9);
  });
});

describe('sidewalk-like is decided for the whole way, not at one sample', () => {
  test('a long path that leaves a street is isolated on every segment, including the one beside the street', async () => {
    const scene = buildScene({
      ways: [
        { name: 'street', tags: STREET, points: [[-150, 0], [0, 0], [150, 0]] },
        { name: 'trail', tags: { highway: 'footway' }, points: [[0, 0], [0, 40], [0, 200], [0, 400]] },
      ],
    });
    const edges = named(await build(scene), 'trail');
    expect(edges).toHaveLength(3);
    for (const edge of edges) expect(edge.pLit).toBeCloseTo(0.33, 9);
  });

  test('every segment of one way gets the same context (no mix of 0.72 and 0.33)', async () => {
    const scene = buildScene({
      ways: [
        { name: 'street', tags: STREET, points: [[-300, 0], [300, 0]] },
        { name: 'verge', tags: { highway: 'footway' }, points: [[-250, 10], [-100, 10], [0, 10], [100, 10], [250, 10]] },
      ],
    });
    const pLits = named(await build(scene), 'verge').map((e) => e.pLit);
    expect(new Set(pLits).size).toBe(1);
    expect(pLits[0]).toBeCloseTo(0.72, 9);
  });
});

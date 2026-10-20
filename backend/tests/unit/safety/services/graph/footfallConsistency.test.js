/**
 * "More crimes is not less safe" (owner feedback, spec section 12): the Hoe, a busy lit centre with CCTV and open
 * venues, records far more non-violent crime than a quiet residential street, yet is the safer place to walk at 22:00.
 * Two parallel routes (centre vs quiet) go through the REAL buildGraph and aggregateRoute.
 */
const path = require('path');
const { buildGraph } = require(path.resolve(__dirname, '../../../../../src/safety/services/safetyGraph'));
const { aggregateRoute } = require(path.resolve(__dirname, '../../../../../src/safety/scoring/routeAggregate'));
const {
  buildScene, CITY, TARGET_LENGTH_M,
} = require('../../scoring/fixtures/calibrationScenes');

const OPTIONS = {
  level: 'extra', crimeStatus: 'ok', settlementClassAt: CITY, hour: 22, now: new Date('2026-10-19T21:30:00Z'),
};
const LIT = { highway: 'residential', maxspeed: '30 mph', lit: 'yes', sidewalk: 'both' };
const CENTRE_NORTH = -800;
const QUIET_NORTH = 800;
const SEGMENTS = 5;

/** Five 150 m segments along `north`, joined to each other by a link road so both routes are reachable. */
function chain(prefix, north) {
  return Array.from({ length: SEGMENTS }, (_, i) => ({
    name: `${prefix}${i}`,
    tags: LIT,
    points: [[i * TARGET_LENGTH_M, north], [(i + 1) * TARGET_LENGTH_M, north]],
  }));
}

/** Places along the centre route: `count` pubs and restaurants spread over the middle three segments. */
function centrePlaces(count) {
  return Array.from({ length: count }, (_, i) => ({
    at: [TARGET_LENGTH_M * 1.5 + (i % 6) * 40 + 5, CENTRE_NORTH + (i % 2 === 0 ? 10 : -10)],
    tags: { amenity: i % 2 === 0 ? 'pub' : 'restaurant' },
  }));
}

function scene({ centreCrimes, quietCrimes, centreCategory }) {
  const at = (east, north) => [east, north];
  const crimes = [
    ...Array.from({ length: centreCrimes }, (_, i) => ({ at: at(300 + (i % 5) * 20, CENTRE_NORTH), category: centreCategory })),
    ...Array.from({ length: quietCrimes }, () => ({ at: at(400, QUIET_NORTH), category: 'anti-social-behaviour' })),
  ];
  const lampsOf = (north) => Array.from({ length: 16 }, (_, i) => at(i * 50, north + 12));
  return buildScene({
    ways: [
      ...chain('c', CENTRE_NORTH),
      ...chain('q', QUIET_NORTH),
      { name: 'linkW', tags: LIT, points: [[0, CENTRE_NORTH], [0, QUIET_NORTH]] },
      { name: 'linkE', tags: LIT, points: [[SEGMENTS * TARGET_LENGTH_M, CENTRE_NORTH], [SEGMENTS * TARGET_LENGTH_M, QUIET_NORTH]] },
    ],
    places: centrePlaces(12),
    cctv: [at(330, CENTRE_NORTH + 6), at(400, CENTRE_NORTH - 6), at(470, CENTRE_NORTH + 6)],
    lamps: [...lampsOf(CENTRE_NORTH), ...lampsOf(QUIET_NORTH)],
    crimes,
    backgroundEastMax: 1000,
  });
}

async function routeRisks(sceneSpec) {
  const s = scene(sceneSpec);
  const graph = await buildGraph(s.roadData, s.lightData, s.cctvData, s.placeData, s.transitData, s.crimes, s.bbox, OPTIONS);
  const risk = (prefix) => aggregateRoute(
    graph.edges.filter((e) => e.roadName.startsWith(prefix)).map((e) => ({ ...e, lengthM: e.distance })),
  ).routeRisk;
  const edgeOf = (name) => graph.edges.find((e) => e.roadName === name);
  return { centre: risk('c'), quiet: risk('q'), graph, edgeOf };
}

describe('crime vs footfall consistency (the Hoe example, 22:00, city)', () => {
  test('a centre route with many non-violent crimes, 12 open places, 3 CCTV and lamps is at least as safe as the quiet route', async () => {
    const { centre, quiet } = await routeRisks({ centreCrimes: 60, quietCrimes: 2, centreCategory: 'anti-social-behaviour' });
    expect(centre).toBeLessThanOrEqual(quiet);
  });

  test('the centre cell really does record far more crime (so the result is not an artefact)', async () => {
    const { edgeOf } = await routeRisks({ centreCrimes: 60, quietCrimes: 2, centreCategory: 'anti-social-behaviour' });
    expect(edgeOf('c2').crimeScore).toBeLessThan(edgeOf('q2').crimeScore);
    expect(edgeOf('c2').presence).toBeGreaterThan(edgeOf('q2').presence * 2);
  });

  test('if the centre cell is violent crime it is not discounted and the centre route is riskier than the quiet one', async () => {
    const violent = await routeRisks({ centreCrimes: 60, quietCrimes: 2, centreCategory: 'violent-crime' });
    expect(violent.centre).toBeGreaterThan(violent.quiet);
    // Same crime counts, non-violent vs violent: violent keeps its full weight, so its crime safety is lower.
    const petty = await routeRisks({ centreCrimes: 60, quietCrimes: 2, centreCategory: 'anti-social-behaviour' });
    expect(violent.edgeOf('c2').crimeScore).toBeLessThan(petty.edgeOf('c2').crimeScore);
  });
});

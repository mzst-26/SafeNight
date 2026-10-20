/**
 * Calibration spec for the v2 scoring model (spec section 11).
 *
 * Each archetype is one ~150 m street in a synthetic scene (fixtures/calibrationScenes.js),
 * run through the REAL buildGraph at 23:00 London, unless stated. Its score is
 * round(100 * (1 - edge.risk)), the same value the API shows. Ranges are the product targets:
 * a failure means the model's calibration is off, not that the range should move.
 */

const path = require('path');
const { buildGraph, routeSafetyBreakdown } = require(path.resolve(__dirname, '../../../../src/safety/services/safetyGraph'));
const { safetyLabel } = require(path.resolve(__dirname, '../../../../src/safety/routes/safeRoutesUtils'));
const {
  NIGHT, DAY, ARCHETYPES, RANGES, ROUTES, routeEdgeIdxs, CITY, ARCHETYPE_OPTIONS,
} = require('./fixtures/calibrationScenes');

// crimeStatus is explicit: a missing status is an outage (fail closed), and the archetype ranges assume crime data.
// The settlement class is injected (Plymouth is a city) so the calibration never depends on the shipped gazetteer.
const OPTIONS = {
  level: 'extra', crimeStatus: 'ok', settlementClassAt: CITY, ...NIGHT,
};

async function graphOf(scene, options = OPTIONS) {
  return buildGraph(scene.roadData, scene.lightData, scene.cctvData, scene.placeData,
    scene.transitData, scene.crimes, scene.bbox, options);
}

/** The archetype's own street edge (the way named 'target'). */
function targetEdge(graph) {
  const edge = graph.edges.find((e) => e.roadName === 'target');
  if (!edge) throw new Error('target edge not found');
  return edge;
}

function scoreOf(edge) {
  return Math.round(100 * (1 - edge.risk));
}

/** Scores every archetype once (the graph build is the slow part). */
const scoreCache = {};
async function archetypeScore(letter, baseOptions = OPTIONS) {
  const options = { ...baseOptions, ...(ARCHETYPE_OPTIONS[letter] || {}) };
  const key = `${letter}:${JSON.stringify(options, (k, v) => (k === 'now' ? String(v) : v))}`;
  if (!scoreCache[key]) {
    const graph = await graphOf(ARCHETYPES[letter](), options);
    scoreCache[key] = { graph, edge: targetEdge(graph), score: scoreOf(targetEdge(graph)) };
  }
  return scoreCache[key];
}

describe('v2 calibration: single-street archetypes at night', () => {
  const DESCRIPTIONS = {
    A: 'lit residential 30 mph with sidewalk, no crime, 2 open places',
    B: 'lit secondary high street with CCTV, 3 open places, bus stop, 1 crime nearby',
    C: 'unmapped residential 30 mph, no lamps in area, no crime',
    D: 'lit footway between houses with lamps nearby, no crime',
    E: 'unlit isolated park path, lamps mapped elsewhere in the area',
    F: 'residential with lit=no, no crime',
    G: 'lit residential in a crime hotspot (20 violent crimes in its cell)',
    H1: 'dead-end service lane, lighting unknown, no places',
    H2: 'dead-end service lane tagged lit=no',
    K: 'tertiary lit=yes with sidewalk, quiet',
    P: 'lit=yes footway through the middle of a park, 150 m from any street, no places, city class',
    Q: 'lit secondary high street in a city centre: 8 open places, 2 CCTV, bus stop',
    T: 'lit residential street, no venue nearby, in a town',
    M: 'the same street in a metropolis',
  };

  test('every archetype scene has a description and a range, and no more', () => {
    expect(Object.keys(DESCRIPTIONS).sort()).toEqual(Object.keys(ARCHETYPES).sort());
    expect(Object.keys(RANGES).sort()).toEqual(Object.keys(ARCHETYPES).sort());
  });

  test.each(Object.keys(DESCRIPTIONS).map((l) => [l, DESCRIPTIONS[l], RANGES[l][0], RANGES[l][1]]))(
    '%s: %s scores %i to %i',
    async (letter, _description, low, high) => {
      const { score } = await archetypeScore(letter);
      expect(score).toBeGreaterThanOrEqual(low);
      expect(score).toBeLessThanOrEqual(high);
    },
  );

  // Darkness can only add hazard: by day a lit street scores at least what it scores at night, and not much more.
  // (Earlier the lighting weight dropped to 0 by day, certainty fell with it and the uncertainty load made day up to
  // 5 points WORSE than night. Certainty now uses the unscaled weights, and day risk is capped at the dark risk.)
  test('I: street A in full daylight is never below A at night and within 8 points above it', async () => {
    const a = await archetypeScore('A');
    const { score: day, graph } = await archetypeScore('A', { ...OPTIONS, ...DAY });
    expect(graph.darkness).toBeCloseTo(0, 6);
    expect(day).toBeGreaterThanOrEqual(a.score);
    expect(day).toBeLessThanOrEqual(a.score + 8);
  });

  test.each(['A', 'B', 'C', 'D', 'K', 'T', 'M'])('daylight %s scores at least as high as at night (never lower)', async (letter) => {
    const night = await archetypeScore(letter);
    const day = await archetypeScore(letter, { ...OPTIONS, ...DAY });
    expect(day.edge.risk).toBeLessThanOrEqual(night.edge.risk + 1e-12);
    expect(day.score).toBeGreaterThanOrEqual(night.score);
  });

  test('J: crime data unavailable on street A sits between G (hotspot) and A (ok crime data)', async () => {
    const a = await archetypeScore('A');
    const g = await archetypeScore('G');
    const { score: j } = await archetypeScore('A', { ...OPTIONS, crimeStatus: 'unavailable' });
    expect(j).toBeGreaterThanOrEqual(52);
    expect(j).toBeLessThanOrEqual(72);
    expect(j).toBeGreaterThan(g.score);
    expect(j).toBeLessThan(a.score);
  });

  test('unmapped residential (C) scores at least 8 points below lit residential (A) and is still Safe', async () => {
    const a = await archetypeScore('A');
    const c = await archetypeScore('C');
    expect(a.score - c.score).toBeGreaterThanOrEqual(8);
    expect(c.score).toBeGreaterThanOrEqual(55);
    expect(c.edge.certainty).toBeLessThan(a.edge.certainty);
  });

  test('archetype sanity: the scenes produce the lighting source each archetype is meant to test', async () => {
    const [a, c, e, f, h1, h2] = await Promise.all(['A', 'C', 'E', 'F', 'H1', 'H2'].map((l) => archetypeScore(l)));
    expect(a.edge.litEstimate).toBe('lit');
    expect(c.edge.pLit).toBeCloseTo(0.9, 6); // 30 mph urban speed prior, no lamps mapped
    expect(h1.edge.pLit).toBeCloseTo(0.62, 6); // service prior: lighting unknown
    expect(h2.edge.litEstimate).toBe('unlit');
    expect(e.edge.pLit).toBeCloseTo(0.33 * 0.6, 6); // isolated footway prior 0.33 times the absence factor 0.6
    expect(f.edge.litEstimate).toBe('unlit');
  });
});

describe('v2 calibration: presence, remoteness and settlement size (spec section 12)', () => {
  // By day a lit park path is fine: footway-like road-class scores were raised (config ROAD_TYPE_SCORES), and the
  // remoteness hazard is zero in daylight. Daytime range 60 to 80; at night the same path stays Moderate (range P).
  test('P: the same lit park path at 14:00 scores 60 to 80 (remoteness is a night hazard only) and above P at night', async () => {
    const day = await archetypeScore('P', {
      ...OPTIONS, hour: 14, now: new Date('2026-06-21T13:00:00Z'),
    });
    const night = await archetypeScore('P');
    expect(day.graph.darkness).toBeCloseTo(0, 6);
    expect(day.score).toBeGreaterThanOrEqual(60);
    expect(day.score).toBeLessThanOrEqual(80);
    expect(day.score).toBeGreaterThan(night.score);
  });

  test('P at night is far below P by day, and below the lit sidewalk D that sits beside streets', async () => {
    const night = await archetypeScore('P');
    const d = await archetypeScore('D');
    expect(night.edge.remoteness).toBeGreaterThanOrEqual(0.75);
    expect(night.score).toBeLessThan(d.score - 8);
    expect(night.edge.cause).toBe('isolation');
  });

  test('Q: a lit city-centre street scores at least 10 points above a quiet lit residential street (A)', async () => {
    const q = await archetypeScore('Q');
    const a = await archetypeScore('A');
    expect(q.score).toBeGreaterThanOrEqual(a.score + 10);
  });

  test('T and M: the same lit residential street is Safe in a town, and scores below the metropolis one', async () => {
    const town = await archetypeScore('T');
    const metropolis = await archetypeScore('M');
    expect(safetyLabel(town.score).label).toMatch(/Safe/);
    expect(town.score).toBeGreaterThanOrEqual(60);
    expect(town.edge.risk).toBeGreaterThan(metropolis.edge.risk);
    expect(town.edge.presence).toBeLessThan(metropolis.edge.presence);
  });

  test('a Plymouth-like suburb street (A) stays within 4 points of its pre-presence score (68)', async () => {
    const a = await archetypeScore('A');
    expect(Math.abs(a.score - 68)).toBeLessThanOrEqual(4);
  });

  test('the same street is never safer in a smaller settlement (rural <= village <= town <= city <= metropolis)', async () => {
    const order = ['rural', 'village', 'town', 'largeTown', 'city', 'metropolis'];
    const risks = [];
    for (const klass of order) {
      const { edge } = await archetypeScore('A', { ...OPTIONS, settlementClassAt: () => ({ class: klass }) });
      risks.push(edge.risk);
    }
    for (let i = 1; i < risks.length; i++) expect(risks[i]).toBeLessThanOrEqual(risks[i - 1] + 1e-12);
  });
});

describe('v2 calibration: ordering invariants', () => {
  test('known-dark <= unknown <= known-lit for the same residential street', async () => {
    const dark = await archetypeScore('F');
    const unknown = await archetypeScore('C');
    const lit = await archetypeScore('A');
    expect(dark.edge.risk).toBeGreaterThanOrEqual(unknown.edge.risk);
    expect(unknown.edge.risk).toBeGreaterThanOrEqual(lit.edge.risk);
  });

  test('crime data unavailable is never better than crime data ok, on the same street', async () => {
    const ok = await archetypeScore('A');
    const down = await archetypeScore('A', { ...OPTIONS, crimeStatus: 'unavailable' });
    expect(down.edge.risk).toBeGreaterThanOrEqual(ok.edge.risk);
  });
});

describe('v2 calibration: route level', () => {
  async function routeScore(name) {
    const graph = await graphOf(ROUTES[name]());
    const idxs = routeEdgeIdxs(graph);
    const breakdown = routeSafetyBreakdown(graph.edges, idxs);
    return { score: Math.round(100 * breakdown.overall), breakdown, label: safetyLabel(Math.round(100 * breakdown.overall)).label };
  }

  test('a route that is 80% A and 20% E scores 8 to 25 points below the all-A route', async () => {
    const allA = await routeScore('allA');
    const mixed = await routeScore('mixedAE');
    const drop = allA.score - mixed.score;
    expect(drop).toBeGreaterThanOrEqual(8);
    expect(drop).toBeLessThanOrEqual(25);
  });

  test.each(['allA', 'allC', 'mixedAE'])('route %s scores at least as high by day as at night', async (name) => {
    const night = await routeScore(name);
    const graph = await graphOf(ROUTES[name](), { ...OPTIONS, ...DAY });
    const day = Math.round(100 * routeSafetyBreakdown(graph.edges, routeEdgeIdxs(graph)).overall);
    expect(day).toBeGreaterThanOrEqual(night.score);
  });

  test('an all-A route is Safe or better', async () => {
    const allA = await routeScore('allA');
    expect(['Very Safe', 'Safe']).toContain(allA.label);
  });

  test('an all-C route is Safe', async () => {
    const allC = await routeScore('allC');
    expect(allC.label).toBe('Safe');
  });

  test('an all-E route is Use Caution', async () => {
    const allE = await routeScore('allE');
    expect(allE.label).toBe('Use Caution');
  });
});

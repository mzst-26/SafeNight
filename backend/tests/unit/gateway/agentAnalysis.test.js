const { analyseRoutes, decide } = require('../../../src/gateway/agent/analysis');

const EVEN = { roadType: 50, lighting: 50, crime: 50, cctv: 50, openPlaces: 50, traffic: 50 };

const route = (routeId, overrides = {}) => ({
  routeId,
  distanceMeters: 1000,
  durationSeconds: 600,
  score: 80,
  breakdown: { ...EVEN },
  ...overrides,
});

/** A route with a 200 m unlit stretch: a risk finding. */
const withRisk = (routeId, score) =>
  route(routeId, { score, worstStretch: { lengthM: 200, cause: 'lighting' } });

const riskIds = (findings) => findings.filter((f) => f.severity === 'risk').map((f) => f.id);

describe('analyseRoutes', () => {
  test('treats an unlit stretch of 150 m or more as a risk, and a shorter one as no risk', () => {
    const atThreshold = analyseRoutes([route('a', { worstStretch: { lengthM: 150, cause: 'lighting' } })]);
    const below = analyseRoutes([route('a', { worstStretch: { lengthM: 149, cause: 'lighting' } })]);

    expect(riskIds(atThreshold.routes[0].findings)).toEqual(['long_stretch']);
    expect(riskIds(below.routes[0].findings)).toEqual([]);
  });

  test('treats dark at start, dead ends and missing crime data as risks', () => {
    const result = analyseRoutes([
      route('a', { darknessAtStart: 0.9, darknessAtArrival: 0.9, deadEnds: 2, crimeDataUnavailable: true }),
    ]);

    expect(riskIds(result.routes[0].findings)).toEqual(['dark_at_start', 'dead_end', 'crime_unavailable']);
  });

  test('treats dark at arrival as a risk only when the route is not already dark at the start', () => {
    const result = analyseRoutes([route('a', { darknessAtStart: 0.1, darknessAtArrival: 0.9 })]);

    expect(riskIds(result.routes[0].findings)).toEqual(['dark_at_arrival']);
  });

  test('estimated street lighting is a caution, not a risk', () => {
    const result = analyseRoutes([route('a', { lightingQuality: 'estimated' })]);
    const findings = result.routes[0].findings;

    expect(findings).toEqual([expect.objectContaining({ id: 'lighting_estimated', severity: 'caution' })]);
    expect(riskIds(findings)).toEqual([]);
  });

  test('gives the same output for the same input and does not change the input', () => {
    const input = [withRisk('a', 80), route('b', { score: 76 })];
    const copy = JSON.parse(JSON.stringify(input));

    expect(analyseRoutes(input)).toEqual(analyseRoutes(input));
    expect(input).toEqual(copy);
  });
});

describe('decide', () => {
  test('keeps the recommended route when it has no risk', () => {
    const result = decide([route('a', { score: 80 }), route('b', { score: 85 })], 'a');

    expect(result).toEqual(expect.objectContaining({ kind: 'keep', routeId: 'a' }));
  });

  test('switches when the recommended route has a risk, another has none, and it scores within 5 points', () => {
    const result = decide([withRisk('a', 80), route('b', { score: 76 })], 'a');

    expect(result).toEqual(expect.objectContaining({ kind: 'switch', routeId: 'b' }));
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  test('allows a score exactly 5 points below the recommended route', () => {
    const result = decide([withRisk('a', 80), route('b', { score: 75 })], 'a');

    expect(result).toEqual(expect.objectContaining({ kind: 'switch', routeId: 'b' }));
  });

  test('refuses to switch when the alternative scores more than 5 points below', () => {
    const result = decide([withRisk('a', 80), route('b', { score: 74 })], 'a');

    expect(result).toEqual(expect.objectContaining({ kind: 'keep', routeId: 'a' }));
  });

  test('refuses to switch when the alternative also has a risk', () => {
    const result = decide([withRisk('a', 80), withRisk('b', 79)], 'a');

    expect(result).toEqual(expect.objectContaining({ kind: 'keep', routeId: 'a' }));
  });

  test('keeps the route when there is no other route to switch to', () => {
    const result = decide([withRisk('a', 80)], 'a');

    expect(result).toEqual(expect.objectContaining({ kind: 'keep', routeId: 'a' }));
  });

  test('switches to the highest scoring risk-free alternative', () => {
    const result = decide([withRisk('a', 80), route('b', { score: 76 }), route('c', { score: 79 })], 'a');

    expect(result).toEqual(expect.objectContaining({ kind: 'switch', routeId: 'c' }));
  });

  test('gives the same decision every time for the same input', () => {
    const input = [withRisk('a', 80), route('b', { score: 76 })];
    const first = decide(input, 'a');

    for (let i = 0; i < 5; i += 1) {
      expect(decide(input, 'a')).toEqual(first);
    }
  });

  test('reasons are fixed sentences that name the risk from the findings', () => {
    const result = decide([withRisk('a', 80), route('b', { score: 76 })], 'a');

    expect(result.reasons.join(' ')).toMatch(/200 m stretch with poor or unconfirmed street lighting/);
  });

  // Contract G2 counts only a long UNLIT stretch as a risk for the switch rule.
  test('a long stretch with a non-lighting cause does not, on its own, trigger a switch', () => {
    const recommended = route('r1', { score: 95, worstStretch: { lengthM: 200, cause: 'traffic' } });
    const other = route('r2', { score: 92 });
    expect(decide([recommended, other], 'r1').kind).toBe('keep');
  });

  test('keep-with-risk reasons start with a plain warning, and a single route says so plainly', () => {
    const keepRisk = decide([route('r1', { score: 80, darknessAtStart: 0.9 }), route('r2', { score: 80, darknessAtStart: 0.9 })], 'r1');
    expect(keepRisk.reasons[0]).toMatch(/^Be careful: Route 1 has risks/);
    const single = decide([route('r1', { score: 80, darknessAtStart: 0.9 })], 'r1');
    expect(single.reasons.join(' ')).toContain('This is the only route found.');
  });

  test('scores in the walker reasons say out of 100', () => {
    const result = decide([route('r1', { score: 80, darknessAtStart: 0.9 }), route('r2', { score: 84 })], 'r1');
    expect(result.reasons.join(' ')).toContain('out of 100');
  });
});

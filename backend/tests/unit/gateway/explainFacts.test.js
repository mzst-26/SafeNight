const { buildComparisonFacts, buildExplainMessages } = require('../../../src/gateway/lib/explainFacts');

const route = (routeId, overrides = {}) => ({
  routeId,
  distanceMeters: 1000,
  durationSeconds: 600,
  score: 60,
  breakdown: { roadType: 50, lighting: 50, crime: 50, cctv: 50, openPlaces: 50, traffic: 50 },
  ...overrides,
});

describe('buildComparisonFacts', () => {
  test('uses bestRouteId as the chosen route and labels alternatives in input order', () => {
    const facts = buildComparisonFacts([route('a'), route('b'), route('c')], 'a');

    expect(facts.chosen.routeId).toBe('a');
    expect(facts.alternatives.map((alt) => alt.label)).toEqual(['Route 2', 'Route 3']);
  });

  test('reports distance, time and score as chosen minus alternative', () => {
    const chosen = route('a', { distanceMeters: 1500, durationSeconds: 900, score: 80 });
    const alt = route('b', { distanceMeters: 1000, durationSeconds: 600, score: 60 });

    const [delta] = buildComparisonFacts([chosen, alt], 'a').alternatives;

    expect(delta.distanceDeltaM).toBe(500);
    expect(delta.durationDeltaMin).toBe(5);
    expect(delta.scoreDelta).toBe(20);
  });

  test('lists factors where the chosen route is at least 5 points safer as advantages', () => {
    const chosen = route('a', { breakdown: { ...route('x').breakdown, lighting: 80 } });
    const alt = route('b', { breakdown: { ...route('x').breakdown, lighting: 50 } });

    const [delta] = buildComparisonFacts([chosen, alt], 'a').alternatives;

    expect(delta.advantages).toEqual([{ factor: 'lighting', delta: 30 }]);
    expect(delta.disadvantages).toEqual([]);
  });

  test('lists factors where the alternative is safer as disadvantages', () => {
    const chosen = route('a', { breakdown: { ...route('x').breakdown, traffic: 20 } });
    const alt = route('b', { breakdown: { ...route('x').breakdown, traffic: 70 } });

    const [delta] = buildComparisonFacts([chosen, alt], 'a').alternatives;

    expect(delta.disadvantages).toEqual([{ factor: 'traffic', delta: -50 }]);
  });

  test('ignores differences smaller than 5 points', () => {
    const chosen = route('a', { breakdown: { ...route('x').breakdown, crime: 52 } });
    const alt = route('b', { breakdown: { ...route('x').breakdown, crime: 50 } });

    const [delta] = buildComparisonFacts([chosen, alt], 'a').alternatives;

    expect(delta.advantages).toEqual([]);
    expect(delta.disadvantages).toEqual([]);
  });

  test('sorts advantages by largest gain first and disadvantages by largest loss first', () => {
    const chosen = route('a', { breakdown: { roadType: 90, lighting: 70, crime: 50, cctv: 10, openPlaces: 50, traffic: 50 } });
    const alt = route('b', { breakdown: { roadType: 60, lighting: 60, crime: 50, cctv: 60, openPlaces: 50, traffic: 50 } });

    const [delta] = buildComparisonFacts([chosen, alt], 'a').alternatives;

    expect(delta.advantages.map((x) => x.factor)).toEqual(['roadType', 'lighting']);
    expect(delta.disadvantages.map((x) => x.factor)).toEqual(['cctv']);
  });

  test('returns empty factor lists when a route has no breakdown', () => {
    const chosen = route('a', { breakdown: undefined });
    const alt = route('b', { breakdown: undefined });

    const [delta] = buildComparisonFacts([chosen, alt], 'a').alternatives;

    expect(delta.advantages).toEqual([]);
    expect(delta.disadvantages).toEqual([]);
  });

  test('falls back to the first route when bestRouteId is not in the list', () => {
    const facts = buildComparisonFacts([route('a'), route('b')], 'zzz');

    expect(facts.chosen.routeId).toBe('a');
  });

  test('has no alternatives when only one route is given', () => {
    const facts = buildComparisonFacts([route('a')], 'a');

    expect(facts.alternatives).toEqual([]);
  });
});


describe('risks on the recommended route', () => {
  const alone = (extra) => buildComparisonFacts([route('a', extra), route('b')], 'a').chosen;

  test('names a long unlit stretch, rounded to 10 m', () => {
    const chosen = alone({ worstStretch: { lengthM: 324, cause: 'lighting' } });
    expect(chosen.risks).toContain('a 320 m stretch with no street lighting');
  });

  test('a long stretch with another cause is named as higher risk, not as unlit', () => {
    const chosen = alone({ worstStretch: { lengthM: 200, cause: 'crime' } });
    expect(chosen.risks).toContain('a 200 m stretch of higher risk');
  });

  test('ignores short stretches', () => {
    const chosen = alone({ worstStretch: { lengthM: 80, cause: 'lighting' } });
    expect(chosen.risks.some((r) => r.includes('stretch'))).toBe(false);
  });

  test('says it is already dark when you set off', () => {
    expect(alone({ darknessAtStart: 0.9, darknessAtArrival: 0.9 }).risks).toContain('it is already dark when you set off');
  });

  test('says it gets dark during the walk when only the arrival is dark', () => {
    const chosen = alone({ darknessAtStart: 0.1, darknessAtArrival: 0.8 });
    expect(chosen.risks).toContain('it gets dark during the walk');
  });

  test('mentions dead ends, missing crime data and estimated lighting', () => {
    const chosen = alone({ deadEnds: 2, crimeDataUnavailable: true, lightingQuality: 'estimated' });
    expect(chosen.risks).toEqual(expect.arrayContaining([
      'the route includes a dead end',
      'crime data is missing for this area, so the score may be too high',
      'street lighting on this route is estimated, not confirmed',
    ]));
  });

  test('no risks when the route has no risk data', () => {
    expect(alone({}).risks).toEqual([]);
  });
});

describe('strengths of the recommended route', () => {
  test('lists a factor only when it is ahead of every alternative by the gap', () => {
    const chosen = route('a', { breakdown: { ...route('x').breakdown, roadType: 90, traffic: 80 } });
    const b = route('b', { breakdown: { ...route('x').breakdown, roadType: 60, traffic: 50 } });
    const c = route('c', { breakdown: { ...route('x').breakdown, roadType: 70, traffic: 78 } });

    const { strengths } = buildComparisonFacts([chosen, b, c], 'a').chosen;

    expect(strengths).toEqual(['stronger main roads and paved paths']);
  });

  test('is empty when there is only one route', () => {
    expect(buildComparisonFacts([route('a')], 'a').chosen.strengths).toEqual([]);
  });
});

describe('buildExplainMessages', () => {
  const twoRoutes = () =>
    buildComparisonFacts(
      [
        route('a', { durationSeconds: 1020, score: 63, breakdown: { ...route('x').breakdown, roadType: 90 }, worstStretch: { lengthM: 320, cause: 'lighting' } }),
        route('b', { durationSeconds: 900, score: 58, breakdown: { ...route('x').breakdown, roadType: 60, cctv: 80 } }),
      ],
      'a',
    );

  test('system message asks for plain reasons, a caution, and no comparison with other routes', () => {
    const [system] = buildExplainMessages(twoRoutes());
    expect(system.role).toBe('system');
    expect(system.content).toMatch(/simple|plain/i);
    expect(system.content).toMatch(/do not compare/i);
    expect(system.content).toMatch(/be careful/i);
    expect(system.content).toMatch(/under 100 words/i);
    expect(system.content).toContain('Note: scores are estimates based on open data and may not reflect real-time conditions. Always stay aware of your surroundings.');
  });

  test('system message only lets the model mention darkness, lighting or crime when they are listed', () => {
    const [system] = buildExplainMessages(twoRoutes());
    expect(system.content).toMatch(/only talk about darkness, lighting or crime when they are listed/i);
  });

  test('user message gives reasons, risks and the walk time, but never names the other routes', () => {
    const [, user] = buildExplainMessages(twoRoutes());
    expect(user.role).toBe('user');
    expect(user.content).toContain('stronger main roads and paved paths');
    expect(user.content).toContain('a 320 m stretch with no street lighting');
    expect(user.content).toMatch(/about 17 min/);
    expect(user.content).not.toMatch(/Route 2|Route 1|longer|shorter|alternative/i);
  });

  test('user message says when no specific risks were found', () => {
    const facts = buildComparisonFacts([route('a'), route('b')], 'a');
    const [, user] = buildExplainMessages(facts);
    expect(user.content).toContain('No specific risks were found on this route.');
  });

  test('user message says when the routes are only slightly apart on safety', () => {
    const facts = buildComparisonFacts(
      [route('a', { score: 63 }), route('b', { score: 61 })],
      'a',
    );
    const [, user] = buildExplainMessages(facts);
    expect(user.content).toContain('only slightly safer');
  });
});

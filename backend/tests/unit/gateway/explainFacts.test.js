const { buildComparisonFacts } = require('../../../src/gateway/lib/explainFacts');

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

describe('buildExplainMessages', () => {
  const { buildExplainMessages } = require('../../../src/gateway/lib/explainFacts');

  const twoRouteFacts = () =>
    buildComparisonFacts(
      [
        route('a', { distanceMeters: 1500, durationSeconds: 900, score: 80, breakdown: { ...route('x').breakdown, lighting: 80 } }),
        route('b', { distanceMeters: 1000, durationSeconds: 600, score: 60, breakdown: { ...route('x').breakdown, lighting: 50 } }),
      ],
      'a',
    );

  test('returns a system message and a user message in that order', () => {
    const [system, user] = buildExplainMessages(twoRouteFacts());

    expect(system.role).toBe('system');
    expect(user.role).toBe('user');
  });

  test('system message tells the model that higher safety factor values mean safer', () => {
    const [system] = buildExplainMessages(twoRouteFacts());

    expect(system.content).toMatch(/higher .*safer/i);
  });

  test('system message forbids invented figures and raw factor keys and fixes the closing note', () => {
    const [system] = buildExplainMessages(twoRouteFacts());

    expect(system.content).toMatch(/only .*facts/i);
    expect(system.content).toMatch(/do not .*raw/i);
    expect(system.content).toContain('Note: scores are estimates based on open data and may not reflect real-time conditions.');
  });

  test('system message requires the time and distance trade-off and a plain-English answer under 100 words', () => {
    const [system] = buildExplainMessages(twoRouteFacts());

    expect(system.content).toMatch(/longer|shorter/i);
    expect(system.content).toMatch(/under 100 words/i);
  });

  test('system message says routes with a small score gap are similar', () => {
    const [system] = buildExplainMessages(twoRouteFacts());

    expect(system.content).toMatch(/similar/i);
  });

  test('user message gives the recommended route, the alternative label and the time gap in plain words', () => {
    const [, user] = buildExplainMessages(twoRouteFacts());

    expect(user.content).toContain('Recommended route');
    expect(user.content).toContain('Route 2');
    expect(user.content).toMatch(/5 min longer/);
  });

  test('user message names advantages in plain English and never uses raw factor keys', () => {
    const [, user] = buildExplainMessages(twoRouteFacts());

    expect(user.content).toContain('street lighting');
    expect(user.content).not.toMatch(/lighting=|roadType|openPlaces/);
  });

  test('user message describes a factor where the alternative is safer without saying it is worse', () => {
    const facts = buildComparisonFacts(
      [
        route('a', { breakdown: { ...route('x').breakdown, traffic: 20 } }),
        route('b', { breakdown: { ...route('x').breakdown, traffic: 70 } }),
      ],
      'a',
    );
    const [, user] = buildExplainMessages(facts);

    expect(user.content).toContain('This route is safer on: foot traffic');
    expect(user.content).not.toMatch(/worse/);
  });

  test('user message says when only one route was found', () => {
    const facts = buildComparisonFacts([route('a')], 'a');
    const [, user] = buildExplainMessages(facts);

    expect(user.content).toMatch(/only one route/i);
  });
});

describe('buildExplainMessages wording edge cases', () => {
  const { buildExplainMessages } = require('../../../src/gateway/lib/explainFacts');

  test('says factor details are unavailable when a route has no breakdown instead of claiming no advantage', () => {
    const facts = buildComparisonFacts(
      [route('a', { breakdown: undefined }), route('b', { breakdown: undefined })],
      'a',
    );
    const [, user] = buildExplainMessages(facts);

    expect(user.content).toContain('Factor details are not available for this comparison.');
    expect(user.content).not.toMatch(/no clear safety advantage/);
  });

  test('says "the same distance and time" instead of printing 0 m and 0 min', () => {
    const facts = buildComparisonFacts([route('a'), route('b')], 'a');
    const [, user] = buildExplainMessages(facts);

    expect(user.content).toContain('the same distance and time');
    expect(user.content).not.toMatch(/0 m /);
  });
});


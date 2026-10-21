const { validateActions, validateCandidates } = require('../../../src/gateway/agent/actions');

const ctx = { routeIds: ['r1', 'r2'], candidateIds: ['p1', 'p2'] };

describe('validateActions', () => {
  test('drops an action with an unknown type', () => {
    expect(validateActions([{ type: 'delete_route', routeId: 'r1' }], ctx)).toEqual([]);
  });

  test('drops pan_to with an unknown candidate id', () => {
    expect(validateActions([{ type: 'pan_to', candidateId: 'p9' }], ctx)).toEqual([]);
  });

  test('drops fit_route and show_findings with an unknown route id', () => {
    expect(
      validateActions(
        [
          { type: 'fit_route', routeId: 'r9' },
          { type: 'show_findings', routeId: 'nope' },
        ],
        ctx,
      ),
    ).toEqual([]);
  });

  test('keeps at most 4 valid actions and drops the rest', () => {
    const raw = Array.from({ length: 6 }, () => ({ type: 'zoom', delta: 1 }));

    expect(validateActions(raw, ctx)).toHaveLength(4);
  });

  test('coordinates from the model are not usable: only candidate ids are accepted', () => {
    const out = validateActions(
      [
        { type: 'pan_to', candidateId: 'p1', lat: 51.5, lng: -0.1 },
        { type: 'pan_to', candidateId: '51.5,-0.1' },
        { type: 'pan_to', lat: 51.5, lng: -0.1 },
      ],
      ctx,
    );

    expect(out).toEqual([{ type: 'pan_to', candidateId: 'p1' }]);
  });

  test('keeps zoom on pan_to only within 10 to 19', () => {
    expect(validateActions([{ type: 'pan_to', candidateId: 'p1', zoom: 25 }], ctx)).toEqual([]);
    expect(validateActions([{ type: 'pan_to', candidateId: 'p1', zoom: 15 }], ctx)).toEqual([
      { type: 'pan_to', candidateId: 'p1', zoom: 15 },
    ]);
  });

  test('keeps zoom delta only as an integer from -2 to 2', () => {
    expect(validateActions([{ type: 'zoom', delta: 3 }], ctx)).toEqual([]);
    expect(validateActions([{ type: 'zoom', delta: 1.5 }], ctx)).toEqual([]);
    expect(validateActions([{ type: 'zoom', delta: -1 }], ctx)).toEqual([{ type: 'zoom', delta: -1 }]);
  });

  test('propose_reroute_via always requires confirmation', () => {
    const out = validateActions(
      [{ type: 'propose_reroute_via', candidateId: 'p2', label: 'Via the park', requiresConfirmation: false }],
      ctx,
    );

    expect(out).toEqual([
      { type: 'propose_reroute_via', candidateId: 'p2', label: 'Via the park', requiresConfirmation: true },
    ]);
  });

  test('returns an empty list for input that is not an array, and drops non-object entries', () => {
    expect(validateActions('pan_to', ctx)).toEqual([]);
    expect(validateActions([null, 'zoom', 42], ctx)).toEqual([]);
  });
});

describe('validateCandidates', () => {
  // Box from the routes: lat 51.49 to 51.52, lng -0.12 to -0.08 (margin 0.01 on each side).
  const routes = [
    { routeId: 'r1', worstStretch: { start: { lat: 51.5, lng: -0.1 }, end: { lat: 51.52, lng: -0.08 } } },
    { routeId: 'r2', worstStretch: { start: { lat: 51.49, lng: -0.12 }, end: { lat: 51.51, lng: -0.09 } } },
  ];

  const cand = (id, overrides = {}) => ({
    id,
    label: `Point ${id}`,
    lat: 51.505,
    lng: -0.1,
    kind: 'stretch_midpoint',
    ...overrides,
  });

  test('keeps well-formed candidates inside the box of the routes', () => {
    const out = validateCandidates([cand('p1'), cand('p2', { kind: 'route_start' })], routes);

    expect(out).toEqual([
      { id: 'p1', label: 'Point p1', lat: 51.505, lng: -0.1, kind: 'stretch_midpoint' },
      { id: 'p2', label: 'Point p2', lat: 51.505, lng: -0.1, kind: 'route_start' },
    ]);
  });

  test('returns at most 12 candidates', () => {
    const list = Array.from({ length: 12 }, (_, i) => cand(`p${i + 1}`));
    list.push(cand('p13'));

    const out = validateCandidates(list, routes);

    expect(out).toHaveLength(12);
    expect(out.map((c) => c.id)).not.toContain('p13');
  });

  test('drops ids that are not p1 to p12', () => {
    const out = validateCandidates([cand('x1'), cand('p0'), cand('p13'), cand('P1')], routes);

    expect(out).toEqual([]);
  });

  test('drops duplicate ids after the first', () => {
    const out = validateCandidates([cand('p1'), cand('p1', { label: 'Again' })], routes);

    expect(out.map((c) => c.label)).toEqual(['Point p1']);
  });

  test('drops a candidate outside the box plus the 0.01 degree margin, and keeps one just inside it', () => {
    const inside = validateCandidates([cand('p1', { lat: 51.525 })], routes);
    const outside = validateCandidates([cand('p2', { lat: 51.54 })], routes);

    expect(inside).toHaveLength(1);
    expect(outside).toEqual([]);
  });

  test('drops candidates with non-finite coordinates or an unknown kind', () => {
    const out = validateCandidates(
      [
        cand('p1', { lat: Number.NaN }),
        cand('p2', { lng: 'abc' }),
        cand('p3', { kind: 'school' }),
      ],
      routes,
    );

    expect(out).toEqual([]);
  });

  test('drops every candidate when the routes carry no coordinates', () => {
    expect(validateCandidates([cand('p1')], [{ routeId: 'r1' }])).toEqual([]);
  });

  test('returns an empty list for input that is not an array', () => {
    expect(validateCandidates(undefined, routes)).toEqual([]);
  });
});

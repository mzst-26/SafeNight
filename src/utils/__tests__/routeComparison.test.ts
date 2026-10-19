import { buildRouteComparison, type RouteComparisonSource } from '@/src/utils/routeComparison';

function route(overrides: Partial<RouteComparisonSource> & { id: string }): RouteComparisonSource {
  return {
    score: 60,
    certainty: 0.5,
    reason: 'Some reason',
    dataQuality: { crime: 'ok', lighting: 'mixed' },
    durationSec: 900,
    distanceM: 1200,
    ...overrides,
  };
}

describe('buildRouteComparison', () => {
  it('returns an empty list for no routes', () => {
    expect(buildRouteComparison([])).toEqual([]);
  });

  it('passes the card fields through unchanged', () => {
    const [entry] = buildRouteComparison([
      route({
        id: 'a',
        score: 67,
        certainty: 0.62,
        reason: 'Darker than the alternative',
        dataQuality: { crime: 'unavailable', lighting: 'estimated' },
        durationSec: 840,
        distanceM: 1100,
      }),
    ]);
    expect(entry).toEqual({
      routeId: 'a',
      score: 67,
      certainty: 0.62,
      reason: 'Darker than the alternative',
      dataQuality: { crime: 'unavailable', lighting: 'estimated' },
      durationSec: 840,
      distanceM: 1100,
      deltaScoreVsFastest: 0,
      deltaDistanceVsFastest: 0,
    });
  });

  it('uses the fastest (minimum duration) route as the baseline', () => {
    const out = buildRouteComparison([
      route({ id: 'slow-safe', score: 80, durationSec: 1200, distanceM: 1600 }),
      route({ id: 'fast', score: 58, durationSec: 800, distanceM: 1000 }),
      route({ id: 'mid', score: 70, durationSec: 950, distanceM: 1300 }),
    ]);
    const byId = Object.fromEntries(out.map((r) => [r.routeId, r]));

    expect(byId['fast'].deltaScoreVsFastest).toBe(0);
    expect(byId['fast'].deltaDistanceVsFastest).toBe(0);
    expect(byId['slow-safe'].deltaScoreVsFastest).toBe(22);
    expect(byId['slow-safe'].deltaDistanceVsFastest).toBe(600);
    expect(byId['mid'].deltaScoreVsFastest).toBe(12);
    expect(byId['mid'].deltaDistanceVsFastest).toBe(300);
  });

  it('gives negative deltas for a route that scores lower or is shorter than the fastest', () => {
    const out = buildRouteComparison([
      route({ id: 'fast', score: 80, durationSec: 800, distanceM: 1200 }),
      route({ id: 'short', score: 55, durationSec: 900, distanceM: 1000 }),
    ]);
    expect(out[1].deltaScoreVsFastest).toBe(-25);
    expect(out[1].deltaDistanceVsFastest).toBe(-200);
  });

  it('breaks a duration tie by input order', () => {
    const out = buildRouteComparison([
      route({ id: 'first', score: 50, durationSec: 900, distanceM: 1000 }),
      route({ id: 'second', score: 70, durationSec: 900, distanceM: 1300 }),
    ]);
    expect(out[1].deltaScoreVsFastest).toBe(20);
    expect(out[1].deltaDistanceVsFastest).toBe(300);
  });

  it('nulls the score deltas when a score is missing, without hiding the duration baseline', () => {
    const out = buildRouteComparison([
      route({ id: 'fast', score: null, durationSec: 800, distanceM: 1000 }),
      route({ id: 'other', score: 70, durationSec: 900, distanceM: 1300 }),
    ]);
    expect(out[0].score).toBeNull();
    expect(out[0].deltaScoreVsFastest).toBeNull();
    expect(out[1].deltaScoreVsFastest).toBeNull();
    expect(out[1].deltaDistanceVsFastest).toBe(300);
  });

  it('nulls every delta when no route has a finite duration', () => {
    const out = buildRouteComparison([
      route({ id: 'a', durationSec: Number.NaN }),
      route({ id: 'b', durationSec: Number.NaN }),
    ]);
    expect(out.map((r) => r.deltaScoreVsFastest)).toEqual([null, null]);
    expect(out.map((r) => r.deltaDistanceVsFastest)).toEqual([null, null]);
  });

  it('normalises missing optional fields to null', () => {
    const [entry] = buildRouteComparison([
      route({ id: 'a', certainty: undefined, reason: undefined, dataQuality: undefined }),
    ]);
    expect(entry.certainty).toBeNull();
    expect(entry.reason).toBeNull();
    expect(entry.dataQuality).toBeNull();
  });

  it('turns non-finite certainty into null', () => {
    const [entry] = buildRouteComparison([route({ id: 'a', certainty: Number.NaN })]);
    expect(entry.certainty).toBeNull();
  });

  it('does not mutate its input', () => {
    const input = [route({ id: 'a' }), route({ id: 'b', durationSec: 100 })];
    const snapshot = JSON.parse(JSON.stringify(input));
    buildRouteComparison(input);
    expect(input).toEqual(snapshot);
  });
});

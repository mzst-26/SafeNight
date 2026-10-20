const path = require('path');
const breakdown = require(path.resolve(__dirname, '../../../../../src/safety/services/graph/breakdown'));
const { manualGraph } = require('./fixtures');

describe('graph/breakdown emptyBreakdown', () => {
  test('is all zeros with a null worst stretch', () => {
    const empty = breakdown.emptyBreakdown();
    expect(empty).toMatchObject({ overall: 0, routeRisk: 0, certainty: 0, worstStretch: null, roadTypes: {}, mainRoadRatio: 0 });
    expect(empty.riskVector).toEqual({ mean: 0, p95: 0, max: 0, uncertainty: 0 });
  });
});

describe('graph/breakdown roadTypeShares', () => {
  test('whole-percent shares by class and the main-road ratio (primary, secondary, tertiary, trunk)', () => {
    const segments = [
      { highway: 'primary', distance: 100 }, { highway: 'residential', distance: 200 },
      { highway: 'trunk', distance: 100 }, { highway: 'residential', distance: 100 },
    ];
    const { roadTypePct, mainRoadRatio } = breakdown.roadTypeShares(segments, 500);
    expect(roadTypePct).toEqual({ primary: 20, residential: 60, trunk: 20 });
    expect(mainRoadRatio).toBeCloseTo(0.4, 12);
  });

  test('footways are not main roads', () => {
    expect(breakdown.roadTypeShares([{ highway: 'footway', distance: 10 }], 10).mainRoadRatio).toBe(0);
  });
});

describe('graph/breakdown riskPercentiles', () => {
  test('nearest-rank p95 and max over edges with distance', () => {
    const segments = [0.1, 0.9, 0.5, 0.3].map((risk) => ({ risk, distance: 10 }));
    segments.push({ risk: 1, distance: 0 });
    expect(breakdown.riskPercentiles(segments)).toEqual({ p95: 0.9, max: 0.9 });
  });
});

describe('graph/breakdown routeSafetyBreakdown', () => {
  test('an empty or zero-distance route returns zeros', () => {
    const { edges } = manualGraph([['A', 'B', 100, 0.2]]);
    expect(breakdown.routeSafetyBreakdown(edges, [])).toEqual(breakdown.emptyBreakdown());
  });

  test('length-weights the factor scores and scores 1 - routeRisk', () => {
    const { edges } = manualGraph([['A', 'B', 100, 0.2], ['B', 'C', 300, 0.6]]);
    edges[0].lightScore = 0.9;
    edges[1].lightScore = 0.1;
    const out = breakdown.routeSafetyBreakdown(edges, [0, 1]);
    expect(out.lighting).toBeCloseTo((0.9 * 100 + 0.1 * 300) / 400, 12);
    expect(out.overall).toBeCloseTo(1 - out.routeRisk, 12);
    expect(out.riskVector.max).toBeCloseTo(0.6, 12);
    expect(out.riskVector.uncertainty).toBeCloseTo(1 - out.certainty, 12);
    expect(out.roadTypes).toEqual({ residential: 100 });
    expect(out.mainRoadRatio).toBe(0);
    expect(out.worstStretch).not.toBeUndefined();
    expect(breakdown.routeSafetyBreakdown(edges, [0, 1])).toEqual(out);
  });
});

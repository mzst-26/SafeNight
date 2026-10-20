/**
 * Golden safety net for the v2 graph pipeline. The snapshot in __golden__/golden.json was captured from the
 * v2 code before the graph/ module split and the v1 removal; this test fails if any edge risk (12 decimals),
 * route order, score, exposure, breakdown or formatter payload changes. Regenerate only for an intentional
 * model change: node tests/unit/safety/services/__golden__/generate.js
 */
const golden = require('./__golden__/golden.json');
const { computeGolden } = require('./__golden__/scenarios');

describe('safetyGraph golden snapshot (v2 pipeline)', () => {
  let actual;
  beforeAll(async () => {
    actual = JSON.parse(JSON.stringify(await computeGolden()));
  });

  test.each(['streets', 'lighting', 'calibration', 'grid'])('%s scenarios are number-for-number identical', (section) => {
    expect(actual[section]).toEqual(golden[section]);
  });

  test('the snapshot covers the sections it claims to', () => {
    expect(Object.keys(golden).sort()).toEqual(['calibration', 'grid', 'lighting', 'streets']);
    expect(golden.grid.routes.count).toBeGreaterThanOrEqual(3);
    expect(golden.calibration.archetypes.A.score).toBeGreaterThanOrEqual(68);
  });
});

const config = require('../../../../src/safety/scoring/config');

describe('scoring config', () => {
  test('pins the literal values of the factor floor and the cause threshold', () => {
    expect(config.MIN_FACTOR_SAFETY).toBe(0.05);
    expect(config.CAUSE_MIN_RISK).toBe(0.1);
  });

  test('pins the other constants the reasons and routing depend on', () => {
    expect(config.RISK_POOR_THRESHOLD).toBe(0.6);
    expect(config.CUBE_MEAN_BLEND).toBe(0.4);
    expect(config.EVIDENCE_PSEUDO_COUNT).toBe(4);
    expect(config.LIGHTING.SHRINK_PSEUDO_COUNT).toBe(1);
    expect(config.MAX_LENGTH_RATIO).toBe(1.5);
    expect(config.LAMP_RADIUS_M).toBe(30);
    expect(config.ACTIVITY_FLOOR).toBe(0.4);
    expect(config.HAZARD_SPEED_KMH).toBe(80);
  });
});

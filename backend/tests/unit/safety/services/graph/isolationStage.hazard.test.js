const path = require('path');
const iso = require(path.resolve(__dirname, '../../../../../src/safety/services/graph/isolationStage'));

// Literal numbers: HAZARD_STRENGTH is 0.4 and written out here, so a change in config.js fails this test.
// H_eff = MAX(0.8) * ramp(R, FREE, MAX) * (1 - P) * darkness * (1 - 0.35 * lit); multiplier = 1 - 0.4 * H_eff.
describe('graph/isolationStage remotenessMultiplier edge multiplier (literal)', () => {
  test('a remote, dark, unlit edge with no presence gets exactly 0.68', () => {
    // H_eff = 0.8 * 1 * 1 * 1 = 0.8 ; 1 - 0.4 * 0.8 = 0.68
    const m = iso.remotenessMultiplier({ remoteness: 0.8, presence: 0, darkness: 1, lightingEffective: 0 });
    expect(m).toBeCloseTo(0.68, 12);
  });

  test('the same edge with a lit lamp (lightingEffective 1) gets exactly 1 - 0.4 * 0.52', () => {
    // H_eff = 0.8 * 0.65 = 0.52 ; 1 - 0.4 * 0.52 = 0.792
    const m = iso.remotenessMultiplier({ remoteness: 0.8, presence: 0, darkness: 1, lightingEffective: 1 });
    expect(m).toBeCloseTo(0.792, 12);
  });
});

// Presence must reduce the hazard. Mutating the call to pass presence 0 makes these identical.
describe('graph/isolationStage remotenessMultiplier presence (same remote edge)', () => {
  const base = { remoteness: 0.8, darkness: 1, lightingEffective: 0 };

  test('with presence 0.8 the multiplier is 1 - 0.4 * 0.8 * 0.2 = 0.936', () => {
    expect(iso.remotenessMultiplier({ ...base, presence: 0.8 })).toBeCloseTo(0.936, 12);
  });

  test('presence 0.8 is closer to 1 than presence 0 on the same edge', () => {
    const busy = iso.remotenessMultiplier({ ...base, presence: 0.8 });
    const empty = iso.remotenessMultiplier({ ...base, presence: 0 });
    expect(busy).toBeGreaterThan(empty);
    expect(1 - busy).toBeLessThan(1 - empty);
    expect(empty).toBeCloseTo(0.68, 12);
  });
});

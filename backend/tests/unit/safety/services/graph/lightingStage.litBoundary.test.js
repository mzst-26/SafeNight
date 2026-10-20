const path = require('path');
const lighting = require(path.resolve(__dirname, '../../../../../src/safety/services/graph/lightingStage'));

// The 'lit' label threshold is 0.7 for tag and lamp evidence. Literal values, not imported config.
describe('graph/lightingStage litEstimateOf lit threshold 0.7 (boundary)', () => {
  test.each(['tag', 'lamp'])('%s at 0.65 is estimated_lit, not lit', (source) => {
    expect(lighting.litEstimateOf(source, 0.65)).toBe('estimated_lit');
  });

  test.each(['tag', 'lamp'])('%s at 0.7 is lit', (source) => {
    expect(lighting.litEstimateOf(source, 0.7)).toBe('lit');
  });

  test('a lamp or tag just below 0.7 (0.699) is not lit', () => {
    expect(lighting.litEstimateOf('lamp', 0.699)).toBe('estimated_lit');
  });
});

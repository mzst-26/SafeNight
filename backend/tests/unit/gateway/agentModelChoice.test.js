const {
  chooseAgentModel,
  DEFAULT_AGENT_MODEL,
  DEFAULT_AGENT_VISION_MODEL,
} = require('../../../src/gateway/routes/agentInsights');

const PICTURE = 'data:image/jpeg;base64,AAAA';

describe('chooseAgentModel', () => {
  test('uses the text model when the round has no picture', () => {
    expect(chooseAgentModel({ snapshot: null, env: {} })).toBe(DEFAULT_AGENT_MODEL);
  });

  test('uses a vision model when the round has a picture, because the text model cannot read images', () => {
    expect(chooseAgentModel({ snapshot: PICTURE, env: {} })).toBe(DEFAULT_AGENT_VISION_MODEL);
    expect(DEFAULT_AGENT_VISION_MODEL).not.toBe(DEFAULT_AGENT_MODEL);
  });

  test('OPENROUTER_AGENT_MODEL and OPENROUTER_AGENT_VISION_MODEL override the defaults', () => {
    const env = { OPENROUTER_AGENT_MODEL: 'text/x:free', OPENROUTER_AGENT_VISION_MODEL: 'vision/y:free' };
    expect(chooseAgentModel({ snapshot: null, env })).toBe('text/x:free');
    expect(chooseAgentModel({ snapshot: PICTURE, env })).toBe('vision/y:free');
  });
});

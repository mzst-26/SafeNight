describe('env bundle safety', () => {
  it('never reads a server secret such as an OpenAI key into the client bundle', () => {
    process.env.EXPO_PUBLIC_OPENAI_API_KEY = 'sk-test-should-not-be-read';
    jest.resetModules();
    const { env } = require('@/src/config/env');
    expect(JSON.stringify(env)).not.toContain('sk-test-should-not-be-read');
    expect('openaiApiKey' in env).toBe(false);
    delete process.env.EXPO_PUBLIC_OPENAI_API_KEY;
  });
});

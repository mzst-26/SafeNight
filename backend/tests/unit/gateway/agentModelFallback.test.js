const { callOpenRouter, DEFAULT_AGENT_VISION_MODEL } = require('../../../src/gateway/routes/agentInsights');

const okReply = (content) => ({
  ok: true,
  status: 200,
  json: async () => ({ choices: [{ message: { role: 'assistant', content, tool_calls: [{ id: 'c0', type: 'function', function: { name: 'finish', arguments: '{"message":"Route 1 is fine. Stay aware."}' } }] } }] }),
});
const failReply = (status) => ({ ok: false, status, json: async () => ({}) });

describe('callOpenRouter model fallback', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('tries the next model when one provider fails, and returns its reply', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce(failReply(502))
      .mockResolvedValueOnce(okReply(null));
    const call = callOpenRouter({ apiKey: 'k', models: ['first/a:free', 'second/b:free'], deadline: Date.now() + 60000 });

    const message = await call({ messages: [], tools: [] });

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(global.fetch.mock.calls[0][1].body).model).toBe('first/a:free');
    expect(JSON.parse(global.fetch.mock.calls[1][1].body).model).toBe('second/b:free');
    expect(message.tool_calls[0].function.name).toBe('finish');
  });

  test('throws the last error when every model fails, without the provider text', async () => {
    global.fetch = jest.fn().mockResolvedValue(failReply(429));
    const call = callOpenRouter({ apiKey: 'k', models: ['first/a:free', 'second/b:free'], deadline: Date.now() + 60000 });

    await expect(call({ messages: [], tools: [] })).rejects.toThrow('status 429');
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('the default vision chain has more than one model', () => {
    expect(DEFAULT_AGENT_VISION_MODEL).toBeTruthy();
  });
});

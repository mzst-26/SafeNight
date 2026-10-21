const { runAgent, buildToolDefinitions } = require('../../../src/gateway/agent/loop');
const { validateActions: validateRawActions } = require('../../../src/gateway/agent/actions');

let callSeq = 0;
const toolCall = (name, args) => {
  callSeq += 1;
  return {
    id: `call_${callSeq}`,
    type: 'function',
    function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) },
  };
};
const reply = (...calls) => ({ role: 'assistant', content: null, tool_calls: calls });

const facts = { routes: [], decision: { kind: 'keep', label: 'Route 1' }, candidates: [] };
const validateActions = (raw) => validateRawActions(raw, { routeIds: ['r1'], candidateIds: ['p1'] });
const run = (callModel) => runAgent({ facts, tools: [], callModel, validateActions });
const FALLBACK = { actions: [], question: null, message: null };

describe('runAgent', () => {
  test('stops after 4 model calls even when the model keeps calling tools', async () => {
    const callModel = jest.fn(async () => reply(toolCall('zoom', { delta: 1 })));

    const result = await run(callModel);

    expect(callModel).toHaveBeenCalledTimes(4);
    expect(result).toEqual(FALLBACK);
  });

  test('falls back when the tool call arguments are not valid JSON', async () => {
    const callModel = jest.fn(async () => reply(toolCall('pan_to', '{"candidateId": ')));

    const result = await run(callModel);

    expect(callModel).toHaveBeenCalledTimes(1);
    expect(result).toEqual(FALLBACK);
  });

  test('a finish call sets the message', async () => {
    const callModel = jest.fn(async () =>
      reply(toolCall('finish', { message: 'Stay on the main road. Stay aware of your surroundings.' })),
    );

    const result = await run(callModel);

    expect(result.message).toBe('Stay on the main road. Stay aware of your surroundings.');
    expect(callModel).toHaveBeenCalledTimes(1);
  });

  test('a finish message over 100 words is not used', async () => {
    const longMessage = Array.from({ length: 101 }, () => 'word').join(' ');
    const callModel = jest.fn(async () => reply(toolCall('finish', { message: longMessage })));

    const result = await run(callModel);

    expect(result.message).toBeNull();
  });

  test('keeps validated actions from earlier calls and drops invalid ones', async () => {
    let turn = 0;
    const callModel = jest.fn(async () => {
      turn += 1;
      if (turn === 1) {
        return reply(toolCall('pan_to', { candidateId: 'p1' }), toolCall('pan_to', { candidateId: 'p9' }));
      }
      return reply(toolCall('finish', { message: 'Done.' }));
    });

    const result = await run(callModel);

    expect(result.actions).toEqual([{ type: 'pan_to', candidateId: 'p1' }]);
    expect(result.message).toBe('Done.');
  });

  test('sends tool results back to the model before the next call', async () => {
    let turn = 0;
    const callModel = jest.fn(async () => {
      turn += 1;
      return turn === 1 ? reply(toolCall('zoom', { delta: 1 })) : reply(toolCall('finish', { message: 'Done.' }));
    });

    await run(callModel);

    const secondCallMessages = callModel.mock.calls[1][0].messages;
    expect(secondCallMessages.some((m) => m.role === 'tool')).toBe(true);
  });

  test('ask_user with more than 3 choices is truncated to 3', async () => {
    const choices = [1, 2, 3, 4, 5].map((i) => ({ id: `c${i}`, label: `Choice ${i}` }));
    const callModel = jest.fn(async () =>
      reply(toolCall('ask_user', { questionId: 'q1', text: 'Which way?', choices })),
    );

    const result = await run(callModel);

    expect(result.question.id).toBe('q1');
    expect(result.question.text).toBe('Which way?');
    expect(result.question.choices).toHaveLength(3);
    expect(result.question.choices.map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
  });

  test('falls back when the model replies with text and no tool call', async () => {
    const callModel = jest.fn(async () => ({ role: 'assistant', content: 'This route is safe.' }));

    expect(await run(callModel)).toEqual(FALLBACK);
  });

  test('falls back when the model calls a tool that does not exist', async () => {
    const callModel = jest.fn(async () => reply(toolCall('delete_everything', {})));

    expect(await run(callModel)).toEqual(FALLBACK);
  });

  test('falls back instead of throwing when the model call fails', async () => {
    const callModel = jest.fn(async () => {
      throw new Error('upstream timeout');
    });

    await expect(run(callModel)).resolves.toEqual(FALLBACK);
  });
});

describe('buildToolDefinitions', () => {
  test('offers the five map actions plus ask_user and finish', () => {
    const names = buildToolDefinitions({ routeIds: ['r1'], candidateIds: ['p1'] }).map((t) => t.function.name);

    expect(names.sort()).toEqual(
      ['ask_user', 'finish', 'fit_route', 'pan_to', 'propose_reroute_via', 'show_findings', 'zoom'].sort(),
    );
  });

  test('limits the candidate and route ids to the validated ones', () => {
    const tools = buildToolDefinitions({ routeIds: ['r1'], candidateIds: ['p1', 'p2'] });
    const panTo = tools.find((t) => t.function.name === 'pan_to');

    expect(panTo.function.parameters.properties.candidateId.enum).toEqual(['p1', 'p2']);
  });

  // Contract: a walker message may only mention crime or incidents that the facts mention.
  test('a finish message that invents a crime fact is not used', async () => {
    const callModel = jest.fn(async () =>
      reply(toolCall('finish', { message: 'Route 1 is safer. There have been recent muggings here, so take care.' })),
    );
    const result = await run(callModel);
    expect(result.message).toBeNull();
  });

  test('the system prompt limits talk about darkness, lighting and crime to listed facts', () => {
    const callModel = jest.fn(async () => reply(toolCall('finish', { message: 'Done.' })));
    return run(callModel).then(() => {
      const system = callModel.mock.calls[0][0].messages[0].content;
      expect(system).toMatch(/Only talk about darkness, lighting or crime when they are listed/);
    });
  });
});

// Debugging: a discarded model answer must say why, outside production.
describe('debug warning for a discarded model answer', () => {
  let warn;
  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
  });

  test('a text-only reply is reported', async () => {
    const callModel = jest.fn(async () => ({ role: 'assistant', content: 'Route 1 is safer.' }));
    await run(callModel);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('reply had no tool call'));
  });

  test('a failed model call reports its status, not the key', async () => {
    const callModel = jest.fn(async () => {
      throw new Error('status 429');
    });
    await run(callModel);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('status 429'));
  });
});

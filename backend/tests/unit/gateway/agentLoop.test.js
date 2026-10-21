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
const FALLBACK = { actions: [], question: null, message: null, status: 'done' };
const SNAPSHOT = 'data:image/jpeg;base64,AAAA';

describe('runAgent', () => {
  test('stops after 2 model calls per round and asks for another round when there are actions', async () => {
    const callModel = jest.fn(async () => reply(toolCall('zoom', { delta: 1 })));

    const result = await run(callModel);

    expect(callModel).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      actions: [
        { type: 'zoom', delta: 1 },
        { type: 'zoom', delta: 1 },
      ],
      question: null,
      message: null,
      status: 'continue',
    });
  });

  test('a round that ends with no finish and no valid actions is the fallback', async () => {
    const callModel = jest.fn(async () => reply(toolCall('zoom', { delta: 9 })));

    expect(await run(callModel)).toEqual(FALLBACK);
  });

  test('a finish call returns status done', async () => {
    const callModel = jest.fn(async () => reply(toolCall('finish', { message: 'Done for now. Stay aware of your surroundings.' })));

    expect((await run(callModel)).status).toBe('done');
  });

  test('a round with a recommend_route action and then a finish is done and keeps the action', async () => {
    let turn = 0;
    const callModel = jest.fn(async () => {
      turn += 1;
      return turn === 1
        ? reply(toolCall('recommend_route', { routeId: 'r1' }))
        : reply(toolCall('finish', { message: 'Done for now. Stay aware of your surroundings.' }));
    });

    const result = await runAgent({ facts, tools: [], callModel, validateActions: (raw) => validateRawActions(raw, { routeIds: ['r1'], candidateIds: [] }) });

    expect(result.actions).toEqual([{ type: 'recommend_route', routeId: 'r1' }]);
    expect(result.status).toBe('done');
  });

  test('a round that uses its 2 calls on actions returns status continue with those actions', async () => {
    let turn = 0;
    const callModel = jest.fn(async () => {
      turn += 1;
      return turn === 1
        ? reply(toolCall('fit_route', { routeId: 'r1' }))
        : reply(toolCall('show_findings', { routeId: 'r1' }));
    });

    const result = await run(callModel);

    expect(result.status).toBe('continue');
    expect(result.actions).toEqual([
      { type: 'fit_route', routeId: 'r1' },
      { type: 'show_findings', routeId: 'r1' },
    ]);
  });

  test('a snapshot is sent as an image part next to the text', async () => {
    const callModel = jest.fn(async () => reply(toolCall('finish', { message: 'Done for now. Stay aware of your surroundings.' })));

    await runAgent({ facts: { ...facts, snapshot: SNAPSHOT }, tools: [], callModel, validateActions });

    const user = callModel.mock.calls[0][0].messages[1];
    expect(user.content).toEqual(
      expect.arrayContaining([
        { type: 'image_url', image_url: { url: SNAPSHOT } },
        { type: 'text', text: expect.any(String) },
      ]),
    );
  });

  test('without a snapshot the user message is text only', async () => {
    const callModel = jest.fn(async () => reply(toolCall('finish', { message: 'Done for now. Stay aware of your surroundings.' })));

    await run(callModel);

    expect(typeof callModel.mock.calls[0][0].messages[1].content).toBe('string');
  });

  test('a crime word in the finish message is still checked against the text facts when a snapshot is present', async () => {
    const callModel = jest.fn(async () =>
      reply(toolCall('finish', { message: 'Route 1 is safer. There have been recent muggings here.' })),
    );

    const result = await runAgent({ facts: { ...facts, snapshot: SNAPSHOT }, tools: [], callModel, validateActions });

    expect(result.message).toBeNull();
  });

  test('keeps validated actions from earlier calls and drops invalid ones', async () => {
    let turn = 0;
    const callModel = jest.fn(async () => {
      turn += 1;
      if (turn === 1) {
        return reply(toolCall('pan_to', { candidateId: 'p1' }), toolCall('pan_to', { candidateId: 'p9' }));
      }
      return reply(toolCall('finish', { message: 'Done for now. Stay aware of your surroundings.' }));
    });

    const result = await run(callModel);

    expect(result.actions).toEqual([{ type: 'pan_to', candidateId: 'p1' }]);
    expect(result.message).toBe('Done for now. Stay aware of your surroundings.');
  });

  test('a pan_to with a non-string candidate id is dropped, not fatal', async () => {
    const callModel = jest.fn(async () =>
      reply(toolCall('pan_to', { candidateId: 7 }), toolCall('finish', { message: 'Done for now. Stay aware of your surroundings.' })),
    );

    const result = await run(callModel);

    expect(result.actions).toEqual([]);
    expect(result.message).toBe('Done for now. Stay aware of your surroundings.');
  });

  test('sends tool results back to the model before the next call', async () => {
    let turn = 0;
    const callModel = jest.fn(async () => {
      turn += 1;
      return turn === 1 ? reply(toolCall('zoom', { delta: 1 })) : reply(toolCall('finish', { message: 'Done for now. Stay aware of your surroundings.' }));
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

  test('tells the model what its last round did, so it does not repeat the same actions', async () => {
    const callModel = jest.fn(async () => reply(toolCall('finish', { message: 'Route 1 is the one. Stay aware of your surroundings.' })));

    await runAgent({
      facts: { ...facts, round: 2, maxRounds: 5, results: [{ type: 'fit_route', ok: true }, { type: 'show_findings', ok: false }] },
      tools: [],
      callModel,
      validateActions: (raw) => raw,
    });

    const userText = JSON.stringify(callModel.mock.calls[0][0].messages.find((m) => m.role === 'user').content);
    expect(userText).toContain('fit_route (ok)');
    expect(userText).toContain('show_findings (failed)');
    expect(userText).toContain('Do not repeat');
  });

  test('tells the model which round it is and that it may finish once satisfied', async () => {
    const callModel = jest.fn(async () => reply(toolCall('finish', { message: 'Stay aware of your surroundings.' })));

    await runAgent({ facts: { ...facts, round: 2, maxRounds: 5 }, tools: [], callModel, validateActions: (raw) => raw });

    const userText = JSON.stringify(callModel.mock.calls[0][0].messages.find((m) => m.role === 'user').content);
    expect(userText).toContain('round 2 of 5');
    expect(userText).toContain('finish');
  });

  test('a finish with an unusable message is asked again while the round has calls left', async () => {
    let turn = 0;
    const callModel = jest.fn(async () => {
      turn += 1;
      return turn === 1
        ? reply(toolCall('finish', { message: '}' }))
        : reply(toolCall('finish', { message: 'Route 1 is shorter. Stay aware of your surroundings.' }));
    });

    const result = await run(callModel);

    expect(callModel).toHaveBeenCalledTimes(2);
    expect(result.message).toBe('Route 1 is shorter. Stay aware of your surroundings.');
    expect(result.status).toBe('done');
  });

  test('a finish message of fewer than four words is not used, so the fixed message is shown', async () => {
    const callModel = jest.fn(async () => reply(toolCall('finish', { message: '}' })));

    const result = await run(callModel);

    expect(result.message).toBeNull();
    expect(result.status).toBe('done');
  });

  test('on the last round only finish and recommend_route are offered, so the walker gets a message', async () => {
    const offered = [];
    const offeredChoice = [];
    const callModel = jest.fn(async ({ tools, toolChoice }) => {
      offered.push(tools.map((t) => t.function.name));
      offeredChoice.push(toolChoice);
      return reply(toolCall('finish', { message: 'Stay aware of your surroundings.' }));
    });
    const allTools = [
      { type: 'function', function: { name: 'pan_to', parameters: {} } },
      { type: 'function', function: { name: 'finish', parameters: {} } },
      { type: 'function', function: { name: 'recommend_route', parameters: {} } },
    ];

    await runAgent({ facts: { ...facts, round: 5, maxRounds: 5 }, tools: allTools, callModel, validateActions: (raw) => raw });

    expect(offered[0].sort()).toEqual(['finish', 'recommend_route']);
    expect(offeredChoice[0]).toEqual({ type: 'function', function: { name: 'finish' } });
  });

  test('a text reply before any action is asked again while calls are left, then the tool call is used', async () => {
    let turn = 0;
    const callModel = jest.fn(async () => {
      turn += 1;
      return turn === 1
        ? { role: 'assistant', content: 'Let me look at the map first.' }
        : reply(toolCall('zoom', { delta: -1 }));
    });

    const result = await run(callModel);

    expect(callModel).toHaveBeenCalledTimes(2);
    expect(result.actions).toEqual([{ type: 'zoom', delta: -1 }]);
    expect(result.status).toBe('continue');
  });

  test('a text reply after an action keeps the action and asks for the next round', async () => {
    let turn = 0;
    const callModel = jest.fn(async () => {
      turn += 1;
      return turn === 1 ? reply(toolCall('zoom', { delta: -1 })) : { role: 'assistant', content: 'Looking at the map now.' };
    });

    const result = await run(callModel);

    expect(result.status).toBe('continue');
    expect(result.actions).toEqual([{ type: 'zoom', delta: -1 }]);
    expect(result.message).toBeNull();
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

  test('a finish message over 100 words is not used', async () => {
    const longMessage = Array.from({ length: 101 }, () => 'word').join(' ');
    const callModel = jest.fn(async () => reply(toolCall('finish', { message: longMessage })));

    const result = await run(callModel);

    expect(result.message).toBeNull();
  });

  test('a finish call sets the message', async () => {
    const callModel = jest.fn(async () =>
      reply(toolCall('finish', { message: 'Stay on the main road. Stay aware of your surroundings.' })),
    );

    const result = await run(callModel);

    expect(result.message).toBe('Stay on the main road. Stay aware of your surroundings.');
    expect(callModel).toHaveBeenCalledTimes(1);
  });
});

describe('buildToolDefinitions', () => {
  test('offers the map actions, recommend_route, ask_user and finish', () => {
    const names = buildToolDefinitions({ routeIds: ['r1'], candidateIds: ['p1'] }).map((t) => t.function.name);

    expect(names.sort()).toEqual(
      ['ask_user', 'finish', 'fit_route', 'pan_to', 'propose_reroute_via', 'recommend_route', 'show_findings', 'zoom'].sort(),
    );
  });

  test('limits the candidate and route ids to the validated ones', () => {
    const tools = buildToolDefinitions({ routeIds: ['r1'], candidateIds: ['p1', 'p2'] });
    const panTo = tools.find((t) => t.function.name === 'pan_to');

    expect(panTo.function.parameters.properties.candidateId.enum).toEqual(['p1', 'p2']);
  });

  test('expand_search is not offered when expansion is not allowed', () => {
    const names = buildToolDefinitions({
      routeIds: ['r1'],
      candidateIds: ['p1'],
      ringIds: ['r1'],
      expansionAllowed: false,
    }).map((t) => t.function.name);

    expect(names).not.toContain('expand_search');
  });

  test('expand_search is absent when expansionAllowed is left out', () => {
    const names = buildToolDefinitions({ routeIds: ['r1'], candidateIds: ['p1'], ringIds: ['r1'] }).map((t) => t.function.name);

    expect(names).not.toContain('expand_search');
  });

  test('expand_search takes 1 to 3 ring ids when expansion is allowed', () => {
    const tools = buildToolDefinitions({
      routeIds: ['r1'],
      candidateIds: ['p1'],
      ringIds: ['r1', 'r2'],
      expansionAllowed: true,
    });
    const expand = tools.find((t) => t.function.name === 'expand_search');
    const schema = expand.function.parameters.properties.candidateIds;

    expect(schema.type).toBe('array');
    expect(schema.items.enum).toEqual(['r1', 'r2']);
    expect(schema.minItems).toBe(1);
    expect(schema.maxItems).toBe(3);
  });

  test('recommend_route is offered with the route ids as an enum', () => {
    const tools = buildToolDefinitions({ routeIds: ['r1', 'r2'], candidateIds: [], ringIds: [], expansionAllowed: false });
    const recommend = tools.find((t) => t.function.name === 'recommend_route');

    expect(recommend.function.parameters.properties.routeId.enum).toEqual(['r1', 'r2']);
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
    const callModel = jest.fn(async () => reply(toolCall('finish', { message: 'Done for now. Stay aware of your surroundings.' })));
    return run(callModel).then(() => {
      const system = callModel.mock.calls[0][0].messages[0].content;
      expect(system).toMatch(/Only talk about darkness, lighting or crime when they are listed/);
    });
  });
});

describe('validation of the new actions', () => {
  const validate = (raw) =>
    validateRawActions(raw, { routeIds: ['r1', 'r2'], candidateIds: ['p1'], ringIds: ['r1', 'r2', 'r3', 'r4'] });

  test('recommend_route keeps only known route ids', () => {
    expect(
      validate([
        { type: 'recommend_route', routeId: 'r2' },
        { type: 'recommend_route', routeId: 'r9' },
      ]),
    ).toEqual([{ type: 'recommend_route', routeId: 'r2' }]);
  });

  test('expand_search keeps known ring ids, at most 3, and drops the rest', () => {
    expect(validate([{ type: 'expand_search', candidateIds: ['r1', 'r9', 'r3', 'r4'] }])).toEqual([
      { type: 'expand_search', candidateIds: ['r1', 'r3', 'r4'] },
    ]);
  });

  test('expand_search without ring ids passed to the validator is dropped', () => {
    expect(validateRawActions([{ type: 'expand_search', candidateIds: ['r1'] }], { routeIds: ['r1'], candidateIds: [] })).toEqual([]);
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

describe('agent time budget', () => {
  const { remainingBudgetMs, AGENT_BUDGET_MS } = require('../../../src/gateway/routes/agentInsights');

  test('the whole agent request has 60 seconds', () => {
    expect(AGENT_BUDGET_MS).toBe(60_000);
  });

  test('a model call gets what is left of the budget, never less than zero', () => {
    expect(remainingBudgetMs(10_000, 4_000)).toBe(6_000);
    expect(remainingBudgetMs(10_000, 12_000)).toBe(0);
  });
});

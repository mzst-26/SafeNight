/* eslint-env jest */

const RUNTIME_ENV = [
  'SAFE_ROUTES_MAX_CONCURRENT',
  'SAFE_ROUTES_MAX_SERVER_LOAD_UNITS',
  'SAFE_ROUTES_MAX_QUEUE_LENGTH',
  'SAFE_ROUTES_MAX_QUEUE_WAIT_MS',
  'SAFE_ROUTES_DEFAULT_REQUEST_LOAD_UNITS',
];

function loadRuntimeWithEnv(overrides) {
  jest.resetModules();
  process.env.SAFE_ROUTES_MAX_CONCURRENT = '1';
  process.env.SAFE_ROUTES_MAX_SERVER_LOAD_UNITS = '1';
  process.env.SAFE_ROUTES_DEFAULT_REQUEST_LOAD_UNITS = '1';
  Object.assign(process.env, overrides);
  return require('../../../../src/safety/routes/safeRoutesRuntime');
}

/** The rejection code of a job once its outcome is known, or 'pending' if it is still waiting after a macrotask. */
async function settledCodeOf(promise) {
  let code = 'pending';
  promise.then(() => { code = 'resolved'; }, (err) => { code = err.code; });
  await new Promise((resolve) => setImmediate(resolve));
  return code;
}

/**
 * Fills the one active slot with a job that waits until release() is called, then queues `count` quick jobs.
 * Every returned promise settles to 'ok' or to its rejection code, so none is left unhandled.
 */
function fillSlotAndQueue(enqueueComputeJob, count) {
  let release;
  const active = enqueueComputeJob({
    run: () => new Promise((resolve) => { release = resolve; }),
    requestLoadUnits: 1,
  });
  const queued = Array.from({ length: count }, () =>
    enqueueComputeJob({ run: async () => 'queued', requestLoadUnits: 1 }).then(() => 'ok', (err) => err.code),
  );
  return { active, queued, release: (value) => release(value) };
}

describe('safeRoutesRuntime numeric env settings fall back when the value is not usable', () => {
  afterEach(async () => {
    for (const name of RUNTIME_ENV) delete process.env[name];
    // The queue heartbeat (1 s) stops itself on its first tick after the queue empties; wait for that tick.
    await new Promise((resolve) => setTimeout(resolve, 1100));
  });

  test('a non-numeric SAFE_ROUTES_MAX_QUEUE_LENGTH keeps the default queue cap of 200, not no cap', async () => {
    const { enqueueComputeJob } = loadRuntimeWithEnv({ SAFE_ROUTES_MAX_QUEUE_LENGTH: 'two hundred' });
    const { active, queued, release } = fillSlotAndQueue(enqueueComputeJob, 200);
    const refused = enqueueComputeJob({ run: async () => 'refused', requestLoadUnits: 1 });
    try {
      expect(await settledCodeOf(refused)).toBe('QUEUE_FULL');
      await expect(refused).rejects.toMatchObject({ statusCode: 503, maxQueueLength: 200 });
    } finally {
      release('first');
      await expect(active).resolves.toBe('first');
      await Promise.all(queued);
    }
  });

  test('a blank SAFE_ROUTES_MAX_QUEUE_LENGTH is treated as unset, so the cap is the default 200', async () => {
    const { enqueueComputeJob } = loadRuntimeWithEnv({ SAFE_ROUTES_MAX_QUEUE_LENGTH: '   ' });
    const { active, queued, release } = fillSlotAndQueue(enqueueComputeJob, 200);
    const refused = enqueueComputeJob({ run: async () => 'refused', requestLoadUnits: 1 });
    try {
      await expect(refused).rejects.toMatchObject({ code: 'QUEUE_FULL', maxQueueLength: 200 });
    } finally {
      release('first');
      await expect(active).resolves.toBe('first');
      expect(await Promise.all(queued)).toHaveLength(200);
    }
  });
});

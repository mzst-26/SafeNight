const { createSafeRoutesOrchestrator } = require('../../../../src/safety/routes/safeRoutesOrchestrator');

function make() {
  const computeSafeRoutes = jest.fn(async () => ({ routes: [1] }));
  const orchestrator = createSafeRoutesOrchestrator({
    computeSafeRoutes,
    estimateRequestLoadUnits: () => 1,
    enqueueComputeJob: ({ run }) => run(),
    waitWithCancellation: async (p) => p,
    formatWaitMmSs: () => '00:05',
  });
  return { computeSafeRoutes, orchestrator };
}
const params = (o = {}) => ({
  oLat: 50.37, oLng: -4.14, dLat: 50.38, dLng: -4.13,
  straightLineDist: 0, straightLineKm: 0, maxDistanceKm: 2,
  wpLat: null, wpLng: null, cancelToken: null,
  responsePolicy: { verbosity: 'full', openPlacesOnly: true, poiCaps: {} },
  ...o,
});
const iso = (s) => Date.parse(s);

describe('route cache key uses a 15-minute bucket of the mid instant', () => {
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(iso('2026-10-20T16:00:00Z'));
  });

  test('leave_at within one bucket shares an entry (minute 15 and 29)', async () => {
    const { orchestrator, computeSafeRoutes } = make();
    await orchestrator.resolveSafeRoutesRequest(params({ leaveAtMs: iso('2026-10-20T17:15:00Z') }));
    const second = await orchestrator.resolveSafeRoutesRequest(params({ leaveAtMs: iso('2026-10-20T17:29:59Z') }));
    expect(second.source).toBe('cache');
    expect(computeSafeRoutes).toHaveBeenCalledTimes(1);
  });

  test('minute 14:59 and 15:00 are separate entries', async () => {
    const { orchestrator, computeSafeRoutes } = make();
    await orchestrator.resolveSafeRoutesRequest(params({ leaveAtMs: iso('2026-10-20T17:14:59Z') }));
    const second = await orchestrator.resolveSafeRoutesRequest(params({ leaveAtMs: iso('2026-10-20T17:15:00Z') }));
    expect(second.source).toBe('computed');
    expect(computeSafeRoutes).toHaveBeenCalledTimes(2);
  });

  test('hasInflightRequest uses the same key as resolve', async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const computeSafeRoutes = jest.fn(async () => { await gate; return { routes: [1] }; });
    const orchestrator = createSafeRoutesOrchestrator({
      computeSafeRoutes, estimateRequestLoadUnits: () => 1, enqueueComputeJob: ({ run }) => run(),
      waitWithCancellation: async (p) => p, formatWaitMmSs: () => '',
    });
    const p = orchestrator.resolveSafeRoutesRequest(params({ leaveAtMs: iso('2026-10-20T17:15:00Z') }));
    expect(orchestrator.hasInflightRequest(params({ leaveAtMs: iso('2026-10-20T17:20:00Z') }))).toBe(true);
    expect(orchestrator.hasInflightRequest(params({ leaveAtMs: iso('2026-10-20T17:30:00Z') }))).toBe(false);
    release();
    await p;
  });

  test('computeSafeRoutes receives the time request with a fixed nowMs', async () => {
    const { orchestrator, computeSafeRoutes } = make();
    await orchestrator.resolveSafeRoutesRequest(params({ arriveByMs: iso('2026-10-20T19:00:00Z') }));
    const timeRequest = computeSafeRoutes.mock.calls[0][16];
    expect(timeRequest).toEqual({
      leaveAtMs: null, arriveByMs: iso('2026-10-20T19:00:00Z'), departureHour: null, nowMs: iso('2026-10-20T16:00:00Z'),
    });
  });
});

describe('cache hits and coalesced responses are re-stamped for the requester', () => {
  const full = () => ({
    status: 'OK',
    routes: [{ legs: [{ duration: { value: 600 } }], safety: { score: 70, timeline: { leaveAtIso: 'stale' } } }],
    meta: { time: { mode: 'leave_at', leaveAtIso: 'stale', arriveByIso: null, timezone: 'Europe/London' } },
  });
  const makeIt = (computeSafeRoutes) => createSafeRoutesOrchestrator({
    computeSafeRoutes, estimateRequestLoadUnits: () => 1, enqueueComputeJob: ({ run }) => run(),
    waitWithCancellation: async (p) => p, formatWaitMmSs: () => '',
  });
  beforeEach(() => { jest.spyOn(Date, 'now').mockReturnValue(iso('2026-10-20T16:00:00Z')); });

  test('second leave_at request in the same bucket gets its own instants from the cache', async () => {
    const compute = jest.fn(async () => full());
    const o = makeIt(compute);
    const first = await o.resolveSafeRoutesRequest(params({ leaveAtMs: iso('2026-10-20T17:10:00Z') }));
    const second = await o.resolveSafeRoutesRequest(params({ leaveAtMs: iso('2026-10-20T17:12:00Z') }));
    expect(compute).toHaveBeenCalledTimes(1);
    expect(second.source).toBe('cache');
    expect(second.result.meta.time.leaveAtIso).toBe('2026-10-20T17:12:00.000Z');
    expect(second.result.routes[0].safety.timeline.leaveAtIso).toBe('2026-10-20T17:12:00.000Z');
    expect(first.result.meta.time.leaveAtIso).toBe('stale');
    // A third request still sees the untouched cached original being re-stamped, not the second one's stamp.
    const third = await o.resolveSafeRoutesRequest(params({ leaveAtMs: iso('2026-10-20T17:13:00Z') }));
    expect(third.result.meta.time.leaveAtIso).toBe('2026-10-20T17:13:00.000Z');
  });

  test('leave-now hit stamps the current instant', async () => {
    const compute = jest.fn(async () => { const r = full(); r.meta.time.mode = 'now'; return r; });
    const o = makeIt(compute);
    await o.resolveSafeRoutesRequest(params());
    Date.now.mockReturnValue(iso('2026-10-20T16:04:00Z'));
    const second = await o.resolveSafeRoutesRequest(params());
    expect(second.source).toBe('cache');
    expect(second.result.meta.time.leaveAtIso).toBe('2026-10-20T16:04:00.000Z');
  });

  test('coalesced in-flight request is re-stamped from its own instants', async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const compute = jest.fn(async () => { await gate; return full(); });
    const o = makeIt(compute);
    const p1 = o.resolveSafeRoutesRequest(params({ leaveAtMs: iso('2026-10-20T17:10:00Z') }));
    const p2 = o.resolveSafeRoutesRequest(params({ leaveAtMs: iso('2026-10-20T17:12:00Z') }));
    release();
    const [a, b] = await Promise.all([p1, p2]);
    expect(b.source).toBe('inflight');
    expect(compute).toHaveBeenCalledTimes(1);
    expect(b.result.meta.time.leaveAtIso).toBe('2026-10-20T17:12:00.000Z');
    expect(a.result.meta.time.leaveAtIso).toBe('stale');
  });
});

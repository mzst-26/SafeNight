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

const {
  createSafeRoutesOrchestrator,
  CRIME_OUTAGE_TTL_MS,
} = require('../../../../src/safety/routes/safeRoutesOrchestrator');

const FIVE_MIN = 5 * 60 * 1000;

function makeOrchestrator(result = () => ({ routes: [1] }), extra = {}) {
  const computeSafeRoutes = jest.fn(async (oLat) => result(oLat));
  const orchestrator = createSafeRoutesOrchestrator({
    computeSafeRoutes,
    estimateRequestLoadUnits: () => 1,
    enqueueComputeJob: ({ run }) => run(),
    waitWithCancellation: async (promise) => promise,
    formatWaitMmSs: () => '00:05',
    ...extra,
  });
  return { computeSafeRoutes, orchestrator };
}

function params(overrides = {}) {
  return {
    oLat: 50.37,
    oLng: -4.14,
    dLat: 50.38,
    dLng: -4.13,
    straightLineDist: 1000,
    straightLineKm: 1,
    maxDistanceKm: 2,
    wpLat: null,
    wpLng: null,
    cancelToken: null,
    responsePolicy: { verbosity: 'full', openPlacesOnly: true, poiCaps: {} },
    ...overrides,
  };
}

/** A response body whose JSON serialisation is exactly `len` characters long, plus any base fields. */
function bodyOfLength(len, base = {}) {
  const emptyLen = JSON.stringify({ ...base, payload: '' }).length;
  return { ...base, payload: 'x'.repeat(len - emptyLen) };
}

describe('route cache lookup at the exact TTL boundary', () => {
  let nowMs;
  let dateSpy;

  beforeEach(() => {
    nowMs = 1_700_000_000_000;
    dateSpy = jest.spyOn(Date, 'now').mockImplementation(() => nowMs);
  });

  afterEach(() => {
    dateSpy.mockRestore();
  });

  test('a healthy answer is still served one millisecond before its 5 minute TTL', async () => {
    const { computeSafeRoutes, orchestrator } = makeOrchestrator();

    await orchestrator.resolveSafeRoutesRequest(params());
    nowMs += FIVE_MIN - 1;
    const within = await orchestrator.resolveSafeRoutesRequest(params());

    expect(within.source).toBe('cache');
    expect(computeSafeRoutes).toHaveBeenCalledTimes(1);
  });

  test('a healthy answer exactly 5 minutes old is expired for lookup', async () => {
    const { computeSafeRoutes, orchestrator } = makeOrchestrator();

    await orchestrator.resolveSafeRoutesRequest(params());
    nowMs += FIVE_MIN;
    const atTtl = await orchestrator.resolveSafeRoutesRequest(params());

    expect(atTtl.source).toBe('computed');
    expect(computeSafeRoutes).toHaveBeenCalledTimes(2);
  });

  test('a crime outage answer exactly 20 seconds old is expired for lookup', async () => {
    const { computeSafeRoutes, orchestrator } = makeOrchestrator(() => ({
      routes: [1],
      meta: { crimeStatus: 'unavailable' },
    }));

    await orchestrator.resolveSafeRoutesRequest(params());
    nowMs += CRIME_OUTAGE_TTL_MS - 1;
    expect((await orchestrator.resolveSafeRoutesRequest(params())).source).toBe('cache');
    nowMs += 1;
    expect((await orchestrator.resolveSafeRoutesRequest(params())).source).toBe('computed');
    expect(computeSafeRoutes).toHaveBeenCalledTimes(2);
  });
});

describe('route cache byte budget at the exact limit', () => {
  test('an entry stays cached when the total bytes exactly equal the budget', async () => {
    const { computeSafeRoutes, orchestrator } = makeOrchestrator(() => bodyOfLength(600), { maxCacheBytes: 1200 });
    expect(JSON.stringify(bodyOfLength(600)).length).toBe(600);

    await orchestrator.resolveSafeRoutesRequest(params({ oLat: 50.1 }));
    await orchestrator.resolveSafeRoutesRequest(params({ oLat: 50.2 }));
    const first = await orchestrator.resolveSafeRoutesRequest(params({ oLat: 50.1 }));

    expect(first.source).toBe('cache');
    expect(computeSafeRoutes).toHaveBeenCalledTimes(2);
  });

  test('one byte over the budget evicts the oldest entry', async () => {
    const { computeSafeRoutes, orchestrator } = makeOrchestrator(() => bodyOfLength(601), { maxCacheBytes: 1200 });

    await orchestrator.resolveSafeRoutesRequest(params({ oLat: 50.1 }));
    await orchestrator.resolveSafeRoutesRequest(params({ oLat: 50.2 }));
    const first = await orchestrator.resolveSafeRoutesRequest(params({ oLat: 50.1 }));

    expect(first.source).toBe('computed');
    expect(computeSafeRoutes).toHaveBeenCalledTimes(3);
  });
});

describe('expired entries at the sweep boundary still hold budget until strictly older than their TTL', () => {
  let nowMs;
  let dateSpy;

  beforeEach(() => {
    nowMs = 1_700_000_000_000;
    dateSpy = jest.spyOn(Date, 'now').mockImplementation(() => nowMs);
  });

  afterEach(() => {
    dateSpy.mockRestore();
  });

  // Live normal entry L (inserted first), dead outage entry E (20 s TTL), then F and G. Budget 1800 bytes.
  // The cleaner runs only when there are more than two entries, so the sweep after F decides whether E is kept.
  // With E exactly 20 s old it is kept, so its bytes push live L out when G is stored. One ms later E is swept
  // and L survives.
  test.each([
    [CRIME_OUTAGE_TTL_MS, 'computed'],
    [CRIME_OUTAGE_TTL_MS + 1, 'cache'],
  ])('an outage entry aged %i ms: the live entry L is %s on its next request', async (ageMs, expected) => {
    const outage = { meta: { crimeStatus: 'unavailable' } };
    const { orchestrator } = makeOrchestrator(
      (oLat) => (oLat === 50.2 ? bodyOfLength(600, outage) : bodyOfLength(600)),
      { maxCacheEntries: 2, maxCacheBytes: 1800 },
    );
    const request = (oLat) => orchestrator.resolveSafeRoutesRequest(params({ oLat }));

    await request(50.1);
    await request(50.2);
    nowMs += ageMs;
    await request(50.3);
    await request(50.4);
    const liveAgain = await request(50.1);

    expect(liveAgain.source).toBe(expected);
  });
});

describe('route cache key includes the safety level', () => {
  test('standard and extra requests that are otherwise identical are computed separately', async () => {
    const { computeSafeRoutes, orchestrator } = makeOrchestrator();

    await orchestrator.resolveSafeRoutesRequest(params({ safetyLevel: 'standard' }));
    const extra = await orchestrator.resolveSafeRoutesRequest(params({ safetyLevel: 'extra' }));

    expect(extra.source).toBe('computed');
    expect(computeSafeRoutes).toHaveBeenCalledTimes(2);
  });

  test('an omitted safety level is the extra level, so it shares the extra entry', async () => {
    const { computeSafeRoutes, orchestrator } = makeOrchestrator();

    await orchestrator.resolveSafeRoutesRequest(params({ safetyLevel: 'extra' }));
    const defaulted = await orchestrator.resolveSafeRoutesRequest(params());

    expect(defaulted.source).toBe('cache');
    expect(computeSafeRoutes).toHaveBeenCalledTimes(1);
  });
});

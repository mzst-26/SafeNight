const {
  WALKING_SPEED_MPS,
  parseTimeParams,
  resolveTripTime,
  estimateEtaSec,
  needsArriveBySecondPass,
  rescoredTrip,
  buildTimeline,
  timelineLabel,
  buildMetaTime,
  cacheTimePart,
  CACHE_BUCKET_MS,
  TIME_HORIZON_MS,
} = require('../../../../src/safety/routes/safeRoutesTime');

const NOW = Date.parse('2026-10-20T16:00:00Z'); // 17:00 BST
const MIN = 60_000;

describe('walking speed constant', () => {
  test('is the single 1.35 m/s used for backend durations', () => {
    expect(WALKING_SPEED_MPS).toBe(1.35);
  });
  test('estimateEtaSec applies the 1.3 detour factor', () => {
    expect(estimateEtaSec(1350)).toBeCloseTo(1300, 6);
  });
});

describe('parseTimeParams: unencoded plus sign', () => {
  test('a space where the + of the offset was decoded still parses to the same instant', () => {
    const encoded = parseTimeParams({ leave_at: '2026-10-20T17:30:00+01:00' }, NOW);
    const decodedSpace = parseTimeParams({ leave_at: '2026-10-20T17:30:00 01:00' }, NOW);
    expect(decodedSpace.error).toBeUndefined();
    expect(decodedSpace.leaveAtMs).toBe(encoded.leaveAtMs);
  });

  test('a space-separated value with no offset is still rejected', () => {
    expect(parseTimeParams({ leave_at: '2026-10-20T17:30:00' }, NOW).error).toBeTruthy();
  });
});

describe('parseTimeParams', () => {
  const parse = (query) => parseTimeParams(query, NOW);
  const expectErr = (query, code) => {
    const r = parse(query);
    expect(r.ok).toBe(false);
    expect(r.error).toBe(code);
    expect(typeof r.message).toBe('string');
    expect(r.message.length).toBeGreaterThan(10);
  };

  test('neither param: leave now, no instants', () => {
    expect(parse({})).toEqual({ ok: true, value: { leaveAtMs: null, arriveByMs: null } });
  });
  test('blank values count as absent', () => {
    expect(parse({ leave_at: '  ', arrive_by: '' }).value).toEqual({ leaveAtMs: null, arriveByMs: null });
  });
  test('leave_at with +01:00 offset', () => {
    const r = parse({ leave_at: '2026-10-20T17:10:00+01:00' });
    expect(r.value.leaveAtMs).toBe(Date.parse('2026-10-20T16:10:00Z'));
  });
  test('leave_at with Z and fractional seconds, and offset without colon', () => {
    expect(parse({ leave_at: '2026-10-20T16:10:00.500Z' }).ok).toBe(true);
    expect(parse({ leave_at: '2026-10-20T17:10:00+0100' }).value.leaveAtMs).toBe(Date.parse('2026-10-20T16:10:00Z'));
  });
  test('arrive_by parses', () => {
    expect(parse({ arrive_by: '2026-10-20T19:00:00Z' }).value.arriveByMs).toBe(Date.parse('2026-10-20T19:00:00Z'));
  });
  test.each([
    ['2026-10-20T17:10:00'],
    ['2026-10-20T17:10'],
    ['2026-10-20'],
  ])('no explicit offset is INVALID_TIME (%s)', (v) => {
    expectErr({ leave_at: v }, 'INVALID_TIME');
    expectErr({ arrive_by: v }, 'INVALID_TIME');
  });
  test.each([['garbage'], ['2026-13-40T10:00:00Z'], ['2026-02-30T10:00:00Z'], ['1750000000'], ['now']])(
    'bad ISO is INVALID_TIME (%s)', (v) => expectErr({ leave_at: v }, 'INVALID_TIME'));
  test('repeated key (array) is INVALID_TIME', () => {
    expectErr({ leave_at: ['2026-10-20T17:10:00Z', '2026-10-20T17:20:00Z'] }, 'INVALID_TIME');
  });
  test('both params is INVALID_TIME', () => {
    expectErr({ leave_at: '2026-10-20T17:10:00Z', arrive_by: '2026-10-20T18:10:00Z' }, 'INVALID_TIME');
  });

  describe('horizon', () => {
    const iso = (ms) => new Date(ms).toISOString();
    test('leave_at accepts now-5min and now+24h exactly', () => {
      expect(parse({ leave_at: iso(NOW - 5 * MIN) }).ok).toBe(true);
      expect(parse({ leave_at: iso(NOW + TIME_HORIZON_MS) }).ok).toBe(true);
    });
    test('leave_at rejects just beyond either edge', () => {
      expectErr({ leave_at: iso(NOW - 5 * MIN - 1000) }, 'TIME_OUT_OF_RANGE');
      expectErr({ leave_at: iso(NOW + TIME_HORIZON_MS + 1000) }, 'TIME_OUT_OF_RANGE');
    });
    test('arrive_by accepts now+5min and now+24h exactly', () => {
      expect(parse({ arrive_by: iso(NOW + 5 * MIN) }).ok).toBe(true);
      expect(parse({ arrive_by: iso(NOW + TIME_HORIZON_MS) }).ok).toBe(true);
    });
    test('arrive_by rejects before now+5min (including the past) and beyond 24h', () => {
      expectErr({ arrive_by: iso(NOW + 5 * MIN - 1000) }, 'TIME_OUT_OF_RANGE');
      expectErr({ arrive_by: iso(NOW - 60 * MIN) }, 'TIME_OUT_OF_RANGE');
      expectErr({ arrive_by: iso(NOW + TIME_HORIZON_MS + 1000) }, 'TIME_OUT_OF_RANGE');
    });
  });
});

describe('resolveTripTime', () => {
  test('no params: leave now, mid is t0 + eta/2', () => {
    const t = resolveTripTime({ nowMs: NOW, etaSec: 1200 });
    expect(t.mode).toBe('now');
    expect(t.t0Ms).toBe(NOW);
    expect(t.midMs).toBe(NOW + 600_000);
  });
  test('leave_at', () => {
    const at = NOW + 3_600_000;
    const t = resolveTripTime({ leaveAt: at, nowMs: NOW, etaSec: 600 });
    expect(t).toMatchObject({ mode: 'leave_at', t0Ms: at, midMs: at + 300_000 });
  });
  test('arrive_by: t0 = arrive - eta', () => {
    const arrive = NOW + 7_200_000;
    const t = resolveTripTime({ arriveBy: arrive, nowMs: NOW, etaSec: 900 });
    expect(t.mode).toBe('arrive_by');
    expect(t.t0Ms).toBe(arrive - 900_000);
    expect(t.midMs).toBe(arrive - 450_000);
    expect(t.arriveByMs).toBe(arrive);
  });
  test('leave_at wins over departure_hour; arrive_by wins over departure_hour', () => {
    expect(resolveTripTime({ leaveAt: NOW + MIN * 10, departureHour: 3, nowMs: NOW, etaSec: 0 }).mode).toBe('leave_at');
    expect(resolveTripTime({ arriveBy: NOW + MIN * 60, departureHour: 3, nowMs: NOW, etaSec: 0 }).mode).toBe('arrive_by');
  });
  test('departure_hour alias: today at that London hour', () => {
    const t = resolveTripTime({ departureHour: 3, nowMs: NOW, etaSec: 0 });
    expect(t.mode).toBe('departure_hour');
    expect(t.t0Ms).toBe(Date.parse('2026-10-20T02:00:00Z')); // 03:00 BST
    expect(t.londonHour(t.t0Ms)).toBe(3);
  });
  test('departure_hour uses the London date, not the UTC date', () => {
    const lateUtc = Date.parse('2026-10-20T23:30:00Z'); // 00:30 BST on 21 Oct
    const t = resolveTripTime({ departureHour: 9, nowMs: lateUtc, etaSec: 0 });
    expect(t.t0Ms).toBe(Date.parse('2026-10-21T08:00:00Z'));
  });
  test('london hour of the mid instant', () => {
    const t = resolveTripTime({ leaveAt: Date.parse('2026-10-20T16:50:00Z'), nowMs: NOW, etaSec: 1200 });
    expect(t.londonHour(t.midMs)).toBe(18); // 17:50 + 10 min = 18:00 BST
  });

  describe('DST transitions use the offset in the instant', () => {
    test('spring forward 2026-03-29: 00:59Z is 00:59 GMT, 01:00Z is 02:00 BST', () => {
      const t = resolveTripTime({ nowMs: Date.parse('2026-03-29T00:00:00Z'), etaSec: 0 });
      expect(t.londonHour(Date.parse('2026-03-29T00:59:00Z'))).toBe(0);
      expect(t.londonHour(Date.parse('2026-03-29T01:00:00Z'))).toBe(2);
      expect(t.londonHour(Date.parse('2026-03-29T01:10:00+01:00'.replace('+01:00', 'Z')))).toBe(2);
    });
    test('fall back 2026-10-25: 00:30Z is 01:30 BST, 01:30Z is 01:30 GMT', () => {
      const t = resolveTripTime({ nowMs: Date.parse('2026-10-25T00:00:00Z'), etaSec: 0 });
      expect(t.londonHour(Date.parse('2026-10-25T00:30:00Z'))).toBe(1);
      expect(t.londonHour(Date.parse('2026-10-25T01:30:00Z'))).toBe(1);
      expect(t.londonHour(Date.parse('2026-10-25T02:00:00Z'))).toBe(2);
    });
    test('explicit offsets map to the right hour either side of the change', () => {
      const parsed = parseTimeParams({ leave_at: '2026-10-25T01:30:00+01:00' }, Date.parse('2026-10-25T00:00:00Z'));
      expect(parsed.value.leaveAtMs).toBe(Date.parse('2026-10-25T00:30:00Z'));
      const parsed2 = parseTimeParams({ leave_at: '2026-10-25T01:30:00+00:00' }, Date.parse('2026-10-25T00:00:00Z'));
      expect(parsed2.value.leaveAtMs).toBe(Date.parse('2026-10-25T01:30:00Z'));
    });
    test('departure_hour on the fall-back day resolves to the right London hour', () => {
      const t = resolveTripTime({ departureHour: 3, nowMs: Date.parse('2026-10-25T10:00:00Z'), etaSec: 0 });
      expect(t.londonHour(t.t0Ms)).toBe(3);
      expect(t.t0Ms).toBe(Date.parse('2026-10-25T03:00:00Z')); // GMT by then
    });
    test('departure_hour on the spring-forward day', () => {
      const t = resolveTripTime({ departureHour: 12, nowMs: Date.parse('2026-03-29T10:00:00Z'), etaSec: 0 });
      expect(t.t0Ms).toBe(Date.parse('2026-03-29T11:00:00Z')); // 12:00 BST
    });
  });
});

describe('arrive-by convergence', () => {
  test('second pass only when |actual - assumed| > 120 s', () => {
    expect(needsArriveBySecondPass({ mode: 'arrive_by', assumedEtaSec: 1000, actualSec: 1120 })).toBe(false);
    expect(needsArriveBySecondPass({ mode: 'arrive_by', assumedEtaSec: 1000, actualSec: 880 })).toBe(false);
    expect(needsArriveBySecondPass({ mode: 'arrive_by', assumedEtaSec: 1000, actualSec: 1121 })).toBe(true);
    expect(needsArriveBySecondPass({ mode: 'arrive_by', assumedEtaSec: 1000, actualSec: 700 })).toBe(true);
  });
  test('never for other modes', () => {
    expect(needsArriveBySecondPass({ mode: 'leave_at', assumedEtaSec: 1000, actualSec: 5000 })).toBe(false);
    expect(needsArriveBySecondPass({ mode: 'now', assumedEtaSec: 1000, actualSec: 5000 })).toBe(false);
  });
  test('re-resolving with the actual duration moves t0 so arrival lands on arrive_by', () => {
    const arrive = NOW + 3 * 3_600_000;
    const first = resolveTripTime({ arriveBy: arrive, nowMs: NOW, etaSec: estimateEtaSec(1000) });
    const second = resolveTripTime({ arriveBy: arrive, nowMs: NOW, etaSec: 1500 });
    expect(second.t0Ms).toBe(arrive - 1_500_000);
    expect(second.t0Ms).not.toBe(first.t0Ms);
  });
});

describe('rescoredTrip (arrive-by convergence)', () => {
  const arrive = NOW + 3 * 3_600_000;
  const req = { arriveBy: arrive, nowMs: NOW };
  const first = resolveTripTime({ ...req, etaSec: 1000 });

  test('returns a trip re-based on the real duration when the estimate was off by more than 120 s', () => {
    const next = rescoredTrip(req, first, 1500);
    expect(next.t0Ms).toBe(arrive - 1_500_000);
    expect(next.etaSec).toBe(1500);
    expect(next.arriveByMs).toBe(arrive);
  });
  test('returns null within tolerance, so no second pass runs', () => {
    expect(rescoredTrip(req, first, 1100)).toBeNull();
  });
  test('returns null for leave_at', () => {
    const leave = { leaveAt: NOW + 600_000, nowMs: NOW };
    expect(rescoredTrip(leave, resolveTripTime({ ...leave, etaSec: 100 }), 9999)).toBeNull();
  });
  test('after one rescore the new trip is consistent with its own duration', () => {
    const next = rescoredTrip(req, first, 1500);
    expect(rescoredTrip(req, next, 1500)).toBeNull();
  });
});

describe('timeline labels', () => {
  test.each([
    [0.0, 0.1, 'daylight'],
    [0.14, 0.14, 'daylight'],
    [0.0, 0.5, 'dusk'],
    [0.15, 0.2, 'dusk'],
    [0.5, 0.6, 'dusk'],
    [0.5, 0.84, 'dusk'],
    [0.1, 0.85, 'dark_by_arrival'],
    [0.84, 0.95, 'dark_by_arrival'],
    [0.85, 0.95, 'dark_from_start'],
    [1, 0.3, 'dark_from_start'],
  ])('start %f arrival %f -> %s', (s, a, label) => {
    expect(timelineLabel(s, a)).toBe(label);
  });
});

describe('buildTimeline at London instants (20 Oct 2026 BST)', () => {
  const lat = 51.5074;
  const lng = -0.1278;
  const at = (hhmm) => Date.parse(`2026-10-20T${hhmm}:00+01:00`);

  test('17:10 start is daylight-ish (~0.00)', () => {
    const tl = buildTimeline({ lat, lng, t0Ms: at('17:10'), durationSec: 60 });
    expect(tl.darknessAtStart).toBeLessThan(0.05);
    expect(tl.label).toBe('daylight');
  });
  test('17:50 is dusk (~0.48)', () => {
    const tl = buildTimeline({ lat, lng, t0Ms: at('17:50'), durationSec: 0 });
    expect(tl.darknessAtStart).toBeGreaterThan(0.38);
    expect(tl.darknessAtStart).toBeLessThan(0.58);
    expect(tl.label).toBe('dusk');
  });
  test('18:20 is dark (~0.95)', () => {
    const tl = buildTimeline({ lat, lng, t0Ms: at('18:20'), durationSec: 0 });
    expect(tl.darknessAtStart).toBeGreaterThan(0.9);
    expect(tl.label).toBe('dark_from_start');
  });
  test('daylight start that ends in the dark is dark_by_arrival', () => {
    const tl = buildTimeline({ lat, lng, t0Ms: at('17:10'), durationSec: 75 * 60 });
    expect(tl.label).toBe('dark_by_arrival');
    expect(tl.leaveAtIso).toBe(new Date(at('17:10')).toISOString());
    expect(tl.arriveAtIso).toBe(new Date(at('17:10') + 75 * 60_000).toISOString());
    expect(tl.darknessAtArrival).toBeGreaterThanOrEqual(0.85);
  });
  test('uses the destination point for arrival when given', () => {
    const tl = buildTimeline({ lat, lng, destLat: lat, destLng: lng, t0Ms: at('17:10'), durationSec: 0 });
    expect(tl.darknessAtArrival).toBe(tl.darknessAtStart);
  });
  test('darkness values are rounded to 2 decimals', () => {
    const tl = buildTimeline({ lat, lng, t0Ms: at('17:50'), durationSec: 0 });
    expect(tl.darknessAtStart).toBe(Math.round(tl.darknessAtStart * 100) / 100);
  });
});

describe('buildMetaTime', () => {
  test('leave_at', () => {
    const trip = resolveTripTime({ leaveAt: NOW + 600_000, nowMs: NOW, etaSec: 100 });
    expect(buildMetaTime(trip)).toEqual({
      mode: 'leave_at',
      leaveAtIso: new Date(NOW + 600_000).toISOString(),
      arriveByIso: null,
      timezone: 'Europe/London',
    });
  });
  test('arrive_by reports derived leave time and the requested arrival', () => {
    const arrive = NOW + 3_600_000;
    const trip = resolveTripTime({ arriveBy: arrive, nowMs: NOW, etaSec: 600 });
    const meta = buildMetaTime(trip);
    expect(meta.mode).toBe('arrive_by');
    expect(meta.arriveByIso).toBe(new Date(arrive).toISOString());
    expect(meta.leaveAtIso).toBe(new Date(arrive - 600_000).toISOString());
  });
});

describe('cache time part (15-minute bucket of the mid instant)', () => {
  const base = (iso) => cacheTimePart({ leaveAtMs: Date.parse(iso), straightLineDist: 0, nowMs: NOW });
  test('bucket size is 15 minutes', () => {
    expect(CACHE_BUCKET_MS).toBe(15 * MIN);
  });
  test('14:59 and 15:00 minute edges fall in different buckets; 15:00 and 29:59 share one', () => {
    const a = base('2026-10-20T17:14:59Z');
    const b = base('2026-10-20T17:15:00Z');
    const c = base('2026-10-20T17:29:59Z');
    expect(a).not.toBe(b);
    expect(b).toBe(c);
  });
  test('uses the mid instant, not t0', () => {
    // 1350 m straight line -> eta 1300 s, mid = t0 + 650 s. t0 17:04:00 -> mid 17:14:50 (bucket :00);
    // t0 17:05:00 -> mid 17:15:50 (bucket :15), although both t0 share one bucket.
    const key = (iso) => cacheTimePart({ leaveAtMs: Date.parse(iso), straightLineDist: 1350, nowMs: NOW });
    expect(key('2026-10-20T17:04:00Z')).not.toBe(key('2026-10-20T17:05:00Z'));
    expect(key('2026-10-20T17:00:00Z')).toBe(key('2026-10-20T17:04:00Z'));
  });
  test('leave now keeps the pre-existing behaviour: no time component beyond the mode (the 5 min TTL bounds staleness)', () => {
    const k1 = cacheTimePart({ straightLineDist: 5000, nowMs: Date.parse('2026-10-20T17:00:00Z') });
    const k2 = cacheTimePart({ straightLineDist: 5000, nowMs: Date.parse('2026-10-20T17:15:00Z') });
    expect(k1).toBe('now');
    expect(k2).toBe('now');
  });
  test('modes never share a key', () => {
    const iso = '2026-10-20T17:15:00Z';
    const ms = Date.parse(iso);
    expect(cacheTimePart({ leaveAtMs: ms, straightLineDist: 0, nowMs: NOW }))
      .not.toBe(cacheTimePart({ arriveByMs: ms, straightLineDist: 0, nowMs: NOW }));
  });
});

describe('restampTime', () => {
  const { restampTime } = require('../../../../src/safety/routes/safeRoutesTime');
  const at = (hhmm) => Date.parse(`2026-10-20T${hhmm}:00+01:00`);
  const where = { oLat: 51.5074, oLng: -0.1278, dLat: 51.5074, dLng: -0.1278 };
  const fullRoute = (durationSec) => ({ legs: [{ duration: { value: durationSec } }], safety: { score: 70, timeline: { stale: true } } });
  const compactRoute = (durationSec) => ({ duration: { value: durationSec }, safety: { score: 70, timeline: { stale: true } } });
  const cached = (route) => ({ status: 'OK', routes: [route], meta: { routeCount: 1, time: { mode: 'leave_at', leaveAtIso: 'stale', arriveByIso: null, timezone: 'Europe/London' } } });

  test.each([['full', fullRoute], ['compact', compactRoute]])('%s: re-stamps meta.time and timeline from the requesting instant', (_n, mk) => {
    const res = restampTime(cached(mk(75 * 60)), { request: { leaveAt: at('17:12'), nowMs: at('17:00') }, ...where });
    expect(res.meta.time.leaveAtIso).toBe(new Date(at('17:12')).toISOString());
    expect(res.routes[0].safety.timeline).toMatchObject({
      leaveAtIso: new Date(at('17:12')).toISOString(),
      arriveAtIso: new Date(at('17:12') + 75 * 60_000).toISOString(),
      label: 'dark_by_arrival',
    });
    expect(res.routes[0].safety.score).toBe(70);
  });
  test('does not mutate the cached response', () => {
    const c = cached(fullRoute(600));
    const snapshot = JSON.stringify(c);
    const res = restampTime(c, { request: { leaveAt: at('17:12'), nowMs: at('17:00') }, ...where });
    expect(JSON.stringify(c)).toBe(snapshot);
    expect(res).not.toBe(c);
    expect(res.routes[0]).not.toBe(c.routes[0]);
  });
  test('leave now stamps the requesting now', () => {
    const c = cached(fullRoute(600));
    c.meta.time.mode = 'now';
    const res = restampTime(c, { request: { nowMs: at('17:03') }, ...where });
    expect(res.meta.time.leaveAtIso).toBe(new Date(at('17:03')).toISOString());
  });
  test('arrive_by derives leave time from the requested arrival and best route duration', () => {
    const c = cached(fullRoute(1200));
    c.meta.time.mode = 'arrive_by';
    const res = restampTime(c, { request: { arriveBy: at('19:00'), nowMs: at('17:00') }, ...where });
    expect(res.meta.time.arriveByIso).toBe(new Date(at('19:00')).toISOString());
    expect(res.meta.time.leaveAtIso).toBe(new Date(at('19:00') - 1_200_000).toISOString());
  });
  test('responses without time data pass through untouched', () => {
    const c = { routes: [1] };
    expect(restampTime(c, { request: { nowMs: 0 }, ...where })).toBe(c);
  });
});

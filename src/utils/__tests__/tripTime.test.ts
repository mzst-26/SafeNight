import {
  canStepTripTime,
  stepTripTime,
  timeZoneNote,
  tripTimeBounds,
  NOW_STATE,
  appendTimeQuery,
  defaultTimeState,
  describeTripTime,
  formatTimelineSummary,
  londonIso,
  resolveTripTime,
  stepHhmm,
  timeBucketKey,
  timelineLabelText,
  toTimeParams,
} from '@/src/utils/tripTime';

// 2026-10-21 is BST (+01:00); 2026-12-01 is GMT (+00:00).
const BST_NOON = new Date('2026-10-21T11:00:00Z'); // 12:00 London
const GMT_NOON = new Date('2026-12-01T12:00:00Z'); // 12:00 London

describe('londonIso', () => {
  it('formats BST with +01:00', () => {
    expect(londonIso(new Date('2026-10-21T16:10:00Z'))).toBe('2026-10-21T17:10:00+01:00');
  });
  it('formats GMT with +00:00', () => {
    expect(londonIso(new Date('2026-12-01T17:10:00Z'))).toBe('2026-12-01T17:10:00+00:00');
  });
  it('switches offset across spring-forward (2026-03-29 01:00 UTC)', () => {
    expect(londonIso(new Date('2026-03-29T00:59:00Z'))).toBe('2026-03-29T00:59:00+00:00');
    expect(londonIso(new Date('2026-03-29T01:00:00Z'))).toBe('2026-03-29T02:00:00+01:00');
  });
  it('switches offset across fall-back (2026-10-25 01:00 UTC)', () => {
    expect(londonIso(new Date('2026-10-25T00:59:00Z'))).toBe('2026-10-25T01:59:00+01:00');
    expect(londonIso(new Date('2026-10-25T01:00:00Z'))).toBe('2026-10-25T01:00:00+00:00');
  });
});

describe('toTimeParams', () => {
  it('returns no params for leave now', () => {
    expect(toTimeParams(NOW_STATE, BST_NOON)).toEqual({});
  });
  it('builds leave_at for a later time today', () => {
    expect(toTimeParams({ mode: 'leave_at', hhmm: '17:10' }, BST_NOON)).toEqual({
      leave_at: '2026-10-21T17:10:00+01:00',
    });
  });
  it('builds arrive_by only (never both)', () => {
    const p = toTimeParams({ mode: 'arrive_by', hhmm: '18:00' }, BST_NOON);
    expect(p).toEqual({ arrive_by: '2026-10-21T18:00:00+01:00' });
    expect('leave_at' in p).toBe(false);
  });
  it('rolls an earlier HH:MM to tomorrow', () => {
    expect(toTimeParams({ mode: 'leave_at', hhmm: '08:30' }, BST_NOON)).toEqual({
      leave_at: '2026-10-22T08:30:00+01:00',
    });
  });
  it('rolls across the 2026-10-25 fall-back with the correct offset', () => {
    // Sat 24 Oct 22:00 London (BST); 00:30 is earlier -> tomorrow = Sun 25 Oct 00:30 BST, 01:30 would be ambiguous.
    const now = new Date('2026-10-24T21:00:00Z');
    expect(toTimeParams({ mode: 'leave_at', hhmm: '08:00' }, now)).toEqual({
      leave_at: '2026-10-25T08:00:00+00:00',
    });
  });
  it('uses +00:00 in winter and +01:00 after spring-forward', () => {
    expect(toTimeParams({ mode: 'leave_at', hhmm: '18:00' }, GMT_NOON)).toEqual({
      leave_at: '2026-12-01T18:00:00+00:00',
    });
    const now = new Date('2026-03-28T20:00:00Z'); // 20:00 London GMT
    expect(toTimeParams({ mode: 'leave_at', hhmm: '08:00' }, now)).toEqual({
      leave_at: '2026-03-29T08:00:00+01:00',
    });
  });
  it('treats a time equal to the current minute as not earlier', () => {
    expect(toTimeParams({ mode: 'leave_at', hhmm: '12:00' }, BST_NOON)).toEqual({
      leave_at: '2026-10-21T12:00:00+01:00',
    });
  });
});

describe('resolveTripTime', () => {
  it('flags tomorrow', () => {
    expect(resolveTripTime({ mode: 'leave_at', hhmm: '08:30' }, BST_NOON)?.isTomorrow).toBe(true);
    expect(resolveTripTime({ mode: 'leave_at', hhmm: '18:30' }, BST_NOON)?.isTomorrow).toBe(false);
    expect(resolveTripTime(NOW_STATE, BST_NOON)).toBeNull();
  });
});

describe('defaultTimeState', () => {
  it('leave_at defaults to the next 15-minute slot', () => {
    const now = new Date('2026-10-21T16:07:00Z'); // 17:07 London
    expect(defaultTimeState('leave_at', now)).toEqual({ mode: 'leave_at', hhmm: '17:15' });
  });
  it('leave_at on a boundary stays on it', () => {
    const now = new Date('2026-10-21T16:15:00Z');
    expect(defaultTimeState('leave_at', now)).toEqual({ mode: 'leave_at', hhmm: '17:15' });
  });
  it('arrive_by defaults to now + 30 min rounded up to 15', () => {
    const now = new Date('2026-10-21T16:07:00Z'); // +30 = 17:37 -> 17:45
    expect(defaultTimeState('arrive_by', now)).toEqual({ mode: 'arrive_by', hhmm: '17:45' });
  });
  it('now mode returns the now state', () => {
    expect(defaultTimeState('now', BST_NOON)).toEqual(NOW_STATE);
  });
  it('wraps past midnight', () => {
    const now = new Date('2026-10-21T22:50:00Z'); // 23:50 London
    expect(defaultTimeState('arrive_by', now).hhmm).toBe('00:30');
  });
});

describe('stepHhmm', () => {
  it('steps by minutes and wraps', () => {
    expect(stepHhmm('17:10', 15)).toBe('17:25');
    expect(stepHhmm('23:55', 15)).toBe('00:10');
    expect(stepHhmm('00:05', -15)).toBe('23:50');
  });
});

describe('timeBucketKey', () => {
  it('is "now" without params', () => {
    expect(timeBucketKey({})).toBe('now');
  });
  it('shares a key within the same 15-minute bucket and differs across', () => {
    const a = timeBucketKey({ leave_at: '2026-10-21T17:00:00+01:00' });
    const b = timeBucketKey({ leave_at: '2026-10-21T17:14:00+01:00' });
    const c = timeBucketKey({ leave_at: '2026-10-21T17:15:00+01:00' });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
  it('differs by mode for the same instant', () => {
    expect(timeBucketKey({ leave_at: '2026-10-21T17:00:00+01:00' })).not.toBe(
      timeBucketKey({ arrive_by: '2026-10-21T17:00:00+01:00' }),
    );
  });
});

describe('appendTimeQuery', () => {
  it('appends nothing for now', () => {
    expect(appendTimeQuery('http://x/api?a=1', {})).toBe('http://x/api?a=1');
  });
  it('appends an encoded leave_at', () => {
    expect(appendTimeQuery('http://x/api?a=1', { leave_at: '2026-10-21T17:10:00+01:00' })).toBe(
      'http://x/api?a=1&leave_at=2026-10-21T17%3A10%3A00%2B01%3A00',
    );
  });
});

describe('labels', () => {
  const tl = {
    leaveAtIso: '2026-10-21T17:10:00+01:00',
    arriveAtIso: '2026-10-21T17:50:00+01:00',
    darknessAtStart: 0,
    darknessAtArrival: 0.8,
    label: 'dark_by_arrival' as const,
  };
  it('maps label codes', () => {
    expect(timelineLabelText('daylight')).toBe('Daylight');
    expect(timelineLabelText('dusk')).toBe('Dusk on route');
    expect(timelineLabelText('dark_by_arrival')).toBe('Dark by arrival');
    expect(timelineLabelText('dark_from_start')).toBe('Dark from start');
  });
  it('builds the summary line in London time', () => {
    expect(formatTimelineSummary(tl)).toBe('Leaves 17:10 · Arrives 17:50 · Dark by arrival');
  });
  it('renders London time even when ISO has another offset', () => {
    expect(formatTimelineSummary({ ...tl, leaveAtIso: '2026-10-21T16:10:00Z', arriveAtIso: '2026-10-21T16:50:00Z' })).toBe(
      'Leaves 17:10 · Arrives 17:50 · Dark by arrival',
    );
  });
  it('is null for missing or malformed timelines', () => {
    expect(formatTimelineSummary(undefined)).toBeNull();
    expect(formatTimelineSummary({ ...tl, leaveAtIso: 'nope' })).toBeNull();
  });
});

describe('describeTripTime', () => {
  it('describes each mode', () => {
    expect(describeTripTime(NOW_STATE, BST_NOON)).toBe('Leave now');
    expect(describeTripTime({ mode: 'leave_at', hhmm: '17:15' }, BST_NOON)).toBe('Leave at 17:15');
    expect(describeTripTime({ mode: 'arrive_by', hhmm: '18:00' }, BST_NOON)).toBe('Arrive by 18:00');
    expect(describeTripTime({ mode: 'leave_at', hhmm: '08:30' }, BST_NOON)).toBe('Leave at 08:30 · Tomorrow');
  });
});

// ── UX gate follow-up ────────────────────────────────────────────────────────

describe('stepper bounds', () => {
  const now = new Date('2026-10-21T16:07:00Z'); // 17:07 London

  it('bounds: leave_at floor is now rounded up; arrive_by floor is now+15 rounded up; ceiling is now+23h45m floored', () => {
    const l = tripTimeBounds('leave_at', now);
    const a = tripTimeBounds('arrive_by', now);
    expect(londonIso(l.min)).toBe('2026-10-21T17:15:00+01:00');
    expect(londonIso(a.min)).toBe('2026-10-21T17:30:00+01:00');
    expect(londonIso(l.max)).toBe('2026-10-22T16:45:00+01:00');
  });
  it('Earlier clamps at the floor and is disabled there', () => {
    const s = { mode: 'leave_at' as const, hhmm: '17:30' };
    expect(canStepTripTime(s, -15, now)).toBe(true);
    const at = stepTripTime(s, -15, now);
    expect(at.hhmm).toBe('17:15');
    expect(canStepTripTime(at, -15, now)).toBe(false);
    expect(stepTripTime(at, -15, now)).toEqual(at);
  });
  it('Earlier never wraps to tomorrow', () => {
    const s = { mode: 'leave_at' as const, hhmm: '17:15' };
    expect(stepTripTime(s, -15, now).hhmm).toBe('17:15');
  });
  it('Later stops at now+23h45m and is disabled there', () => {
    let s = { mode: 'leave_at' as const, hhmm: '16:30' }; // tomorrow 16:30
    expect(canStepTripTime(s, 15, now)).toBe(true);
    s = stepTripTime(s, 15, now) as typeof s;
    expect(s.hhmm).toBe('16:45');
    expect(canStepTripTime(s, 15, now)).toBe(false);
    expect(stepTripTime(s, 15, now)).toEqual(s);
  });
  it('arrive_by floor is respected', () => {
    const s = { mode: 'arrive_by' as const, hhmm: '17:45' };
    expect(stepTripTime(stepTripTime(s, -15, now), -15, now).hhmm).toBe('17:30');
  });
  it('a rolled Tomorrow time can never exceed the backend horizon', () => {
    // fall-back day: wall-clock tomorrow can be 25h away
    const n = new Date('2026-10-24T11:50:00Z'); // 12:50 BST on the 24th
    const p = toTimeParams({ mode: 'leave_at', hhmm: '12:30' }, n); // tomorrow 12:30 GMT = 23h40m? ensure < 24h
    const ms = Date.parse(p.leave_at as string) - n.getTime();
    expect(ms).toBeLessThanOrEqual(24 * 3600 * 1000);
    const q = toTimeParams({ mode: 'leave_at', hhmm: '12:49' }, n);
    expect(Date.parse(q.leave_at as string) - n.getTime()).toBeLessThanOrEqual(24 * 3600 * 1000);
  });
});

describe('Intl failure falls back to the device zone', () => {
  const Real = Intl.DateTimeFormat;
  afterEach(() => {
    (Intl as any).DateTimeFormat = Real;
  });
  it('does not throw and reports device time', () => {
    (Intl as any).DateTimeFormat = function () {
      throw new RangeError('Invalid time zone specified: Europe/London');
    };
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const t = require('@/src/utils/tripTime');
      const now = new Date('2026-10-21T16:07:00Z');
      expect(() => t.toTimeParams({ mode: 'leave_at', hhmm: '18:00' }, now)).not.toThrow();
      expect(t.londonIso(now)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
      expect(t.usingDeviceTime()).toBe(true);
      expect(t.timeZoneNote()).toBe('(device time)');
      expect(t.formatTimelineSummary({ leaveAtIso: '2026-10-21T17:10:00+01:00', arriveAtIso: '2026-10-21T17:50:00+01:00', label: 'daylight' })).toMatch(/^Leaves \d\d:\d\d/);
    });
  });
});

describe('timeZoneNote', () => {
  it('is a string or null in a working environment', () => {
    const n = timeZoneNote();
    expect(n === null || n === '(London time)').toBe(true);
  });
});

describe('spring-forward gap', () => {
  it('resolves a non-existent wall time (01:30 on 2026-03-29) to the next valid instant, 02:00 BST', () => {
    const now = new Date('2026-03-28T22:00:00Z'); // 22:00 London (GMT), the evening before
    expect(toTimeParams({ mode: 'leave_at', hhmm: '01:30' }, now)).toEqual({
      leave_at: '2026-03-29T02:00:00+01:00',
    });
    expect(describeTripTime({ mode: 'leave_at', hhmm: '01:30' }, now)).toBe('Leave at 02:00 · Tomorrow');
  });
  it('leaves valid times either side of the gap alone', () => {
    const now = new Date('2026-03-28T22:00:00Z');
    expect(toTimeParams({ mode: 'leave_at', hhmm: '00:59' }, now).leave_at).toBe('2026-03-29T00:59:00+00:00');
    expect(toTimeParams({ mode: 'leave_at', hhmm: '02:00' }, now).leave_at).toBe('2026-03-29T02:00:00+01:00');
  });
});

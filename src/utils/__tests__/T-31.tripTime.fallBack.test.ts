import { resolveTripTime } from '@/src/utils/tripTime';

/**
 * 2026-10-25 is the autumn fall-back day in London. 01:00-01:59 happens twice:
 * first as BST (UTC+1, instant 00:30Z for 01:30) and then as GMT (UTC+0, instant 01:30Z).
 * The ambiguous wall time 01:30 must resolve to the later GMT instant.
 */
describe('tripTime ambiguous fall-back wall time (T-31)', () => {
  it('resolves 01:30 on 2026-10-25 London to the later GMT instant', () => {
    // 00:10Z is 01:10 BST on 2026-10-25, before the ambiguous 01:30, so nothing rolls to tomorrow.
    const now = new Date('2026-10-25T00:10:00Z');

    const resolved = resolveTripTime({ mode: 'leave_at', hhmm: '01:30' }, now);

    expect(resolved).not.toBeNull();
    expect(resolved!.isTomorrow).toBe(false);
    expect(resolved!.instant.toISOString()).toBe('2026-10-25T01:30:00.000Z');
  });
});

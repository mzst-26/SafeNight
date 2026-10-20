import { resolveTripTime, toTimeParams } from '@/src/utils/tripTime';

// 2026-10-21 is BST (+01:00). The clock reads 10:00:45 London; the chosen HH:MM is the current minute.
// The current minute has already started, so it must not roll to tomorrow.
const NOW_WITH_SECONDS = new Date('2026-10-21T09:00:45Z'); // 10:00:45 London

describe('trip time when now has seconds', () => {
  it('a chosen HH:MM equal to the current minute does not roll to tomorrow', () => {
    const resolved = resolveTripTime({ mode: 'leave_at', hhmm: '10:00' }, NOW_WITH_SECONDS);
    expect(resolved?.isTomorrow).toBe(false);
    expect(resolved?.instant.toISOString()).toBe('2026-10-21T09:00:00.000Z');
  });

  it('toTimeParams keeps today for the current minute', () => {
    expect(toTimeParams({ mode: 'leave_at', hhmm: '10:00' }, NOW_WITH_SECONDS)).toEqual({
      leave_at: '2026-10-21T10:00:00+01:00',
    });
  });

  it('a minute earlier than the current minute still rolls to tomorrow', () => {
    expect(resolveTripTime({ mode: 'leave_at', hhmm: '09:59' }, NOW_WITH_SECONDS)?.isTomorrow).toBe(true);
  });
});

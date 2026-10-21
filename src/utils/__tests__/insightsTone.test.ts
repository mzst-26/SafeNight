import { insightsToneFor, shouldBounce } from '@/src/utils/insightsTone';

// 1 December is on GMT (UTC+0), so London time equals UTC in these fixtures.
const at = (hhmm: string) => `2026-12-01T${hhmm}:00.000Z`;

describe('insightsToneFor (London time)', () => {
  test.each([
    ['06:00', 'day'],
    ['12:00', 'day'],
    ['17:59', 'day'],
    ['18:00', 'evening'],
    ['23:59', 'evening'],
    ['00:00', 'late'],
    ['04:59', 'late'],
    ['05:00', 'day'],
  ])('%s is %s', (time, tone) => {
    expect(insightsToneFor(at(time))).toBe(tone);
  });

  test('falls back to the current time when there is no trip time', () => {
    const now = new Date('2026-12-01T01:30:00.000Z');
    expect(insightsToneFor(null, now)).toBe('late');
  });
});

describe('shouldBounce', () => {
  test('bounces only in the late-night tone', () => {
    expect(shouldBounce('late')).toBe(true);
    expect(shouldBounce('evening')).toBe(false);
    expect(shouldBounce('day')).toBe(false);
  });
});

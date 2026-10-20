const path = require('path');
const clock = require(path.resolve(__dirname, '../../../../../src/safety/services/graph/clock'));

const BBOX = { south: 51.49, north: 51.51, west: -0.11, east: -0.09 };

describe('graph/clock londonHourOf', () => {
  test('uses London wall-clock time: BST in summer, GMT in winter', () => {
    expect(clock.londonHourOf(new Date('2026-07-01T12:00:00Z'))).toBe(13);
    expect(clock.londonHourOf(new Date('2026-01-15T12:00:00Z'))).toBe(12);
    expect(clock.londonHourOf(new Date('2026-10-19T22:30:00Z'))).toBe(23);
  });

  test('midnight is hour 0, not 24', () => {
    expect(clock.londonHourOf(new Date('2026-01-15T00:10:00Z'))).toBe(0);
  });
});

describe('graph/clock normalizeCrimeStatus', () => {
  test('only the exact string ok is data; everything else is an outage', () => {
    expect(clock.normalizeCrimeStatus('ok')).toBe('ok');
    for (const value of [undefined, null, '', 'OK', 'unavailable', 'weird', true, 1]) {
      expect(clock.normalizeCrimeStatus(value)).toBe('unavailable');
    }
  });
});

describe('graph/clock resolveBuildClock', () => {
  const now = new Date('2026-10-19T22:30:00Z');

  test('takes the hour from options, else from the London hour of now', () => {
    expect(clock.resolveBuildClock(BBOX, { hour: 12, now }).hour).toBe(12);
    expect(clock.resolveBuildClock(BBOX, { now }).hour).toBe(23);
    expect(clock.resolveBuildClock(BBOX, { hour: 0, now }).hour).toBe(0);
  });

  test('uses the real clock when now is not a Date', () => {
    const out = clock.resolveBuildClock(BBOX, { now: 'later' });
    expect(out.now).toBeInstanceOf(Date);
    expect(out.hour).toBeGreaterThanOrEqual(0);
    expect(out.hour).toBeLessThan(24);
  });

  test('night is dark and weights follow the level; day is not dark', () => {
    const night = clock.resolveBuildClock(BBOX, { hour: 23, now, level: 'extra' });
    const day = clock.resolveBuildClock(BBOX, { hour: 12, now: new Date('2026-06-21T11:00:00Z'), level: 'extra' });
    expect(night.darkness).toBeGreaterThan(0.99);
    expect(day.darkness).toBeCloseTo(0, 6);
    expect(night.weights.lighting).toBeGreaterThan(day.weights.lighting);
    expect(clock.resolveBuildClock(BBOX, { hour: 23, now, level: 'standard' }).weights.activity).toBe(0);
  });

  test('crimeStatus is normalised', () => {
    expect(clock.resolveBuildClock(BBOX, { now }).crimeStatus).toBe('unavailable');
    expect(clock.resolveBuildClock(BBOX, { now, crimeStatus: 'ok' }).crimeStatus).toBe('ok');
  });
});

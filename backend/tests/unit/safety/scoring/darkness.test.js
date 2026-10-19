const {
  sunElevationDeg,
  darknessFactor,
  darknessForHour,
} = require('../../../../src/safety/scoring/darkness');

const PLYMOUTH = { lat: 50.37, lng: -4.14 };

describe('sunElevationDeg', () => {
  test('is about 66.5 deg at solar noon on the June solstice at the equator', () => {
    const elevation = sunElevationDeg({
      lat: 0,
      lng: 0,
      date: new Date('2026-06-21T12:02:00Z'),
    });

    expect(elevation).toBeCloseTo(66.5, 0);
  });

  test('is about 90 deg at solar noon at the equator on the March equinox', () => {
    const elevation = sunElevationDeg({
      lat: 0,
      lng: 0,
      date: new Date('2026-03-20T12:08:00Z'),
    });

    expect(elevation).toBeCloseTo(90, 0);
  });

  test.each([
    ['latitude', { lat: Number.NaN, lng: 0 }],
    ['longitude', { lat: 0, lng: Infinity }],
  ])('throws TypeError for a non-finite %s', (_name, point) => {
    expect(() =>
      sunElevationDeg({ ...point, date: new Date('2026-06-21T12:00:00Z') }),
    ).toThrow(TypeError);
  });

  test('throws TypeError for an invalid date', () => {
    expect(() =>
      sunElevationDeg({ ...PLYMOUTH, date: new Date('not a date') }),
    ).toThrow(TypeError);
  });
});

describe('darknessFactor', () => {
  test('is 0 at midday on 21 June in Plymouth, when the sun is above 60 deg', () => {
    // 13:00 BST: solar noon in Plymouth is about 13:18 BST.
    const date = new Date('2026-06-21T12:00:00Z');

    expect(sunElevationDeg({ ...PLYMOUTH, date })).toBeGreaterThan(60);
    expect(darknessFactor({ ...PLYMOUTH, date })).toBe(0);
  });

  test('is 0 at 12:00 GMT on 21 December, when the sun is about 16 deg up', () => {
    const date = new Date('2026-12-21T12:00:00Z');

    expect(sunElevationDeg({ ...PLYMOUTH, date })).toBeCloseTo(16, 0);
    expect(darknessFactor({ ...PLYMOUTH, date })).toBe(0);
  });

  test('is 1 at 17:00 GMT on 21 December, after sunset at about 16:00', () => {
    const date = new Date('2026-12-21T17:00:00Z');

    expect(darknessFactor({ ...PLYMOUTH, date })).toBe(1);
  });

  test('is partially dark at 22:00 BST on 21 June, just after sunset', () => {
    const date = new Date('2026-06-21T21:00:00Z');
    const darkness = darknessFactor({ ...PLYMOUTH, date });

    expect(darkness).toBeGreaterThan(0);
    expect(darkness).toBeLessThan(1);
  });

  test('is less dark at 22:00 BST on 21 June than at 22:00 GMT on 21 December', () => {
    const june = darknessFactor({
      ...PLYMOUTH,
      date: new Date('2026-06-21T21:00:00Z'),
    });
    const december = darknessFactor({
      ...PLYMOUTH,
      date: new Date('2026-12-21T22:00:00Z'),
    });

    expect(december).toBe(1);
    expect(june).toBeLessThan(december);
  });

  test('never decreases as the sun sets on 21 June', () => {
    const values = [];
    for (let minutes = 19 * 60; minutes <= 23 * 60; minutes += 5) {
      const date = new Date(Date.UTC(2026, 5, 21, 0, minutes));
      values.push(darknessFactor({ ...PLYMOUTH, date }));
    }

    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]);
    }
    expect(values[0]).toBe(0);
    expect(values[values.length - 1]).toBe(1);
  });
});

describe('darknessForHour', () => {
  test.each([
    ['2026-01-15T10:00:00Z'],
    ['2026-03-20T10:00:00Z'],
    ['2026-06-21T10:00:00Z'],
    ['2026-09-23T10:00:00Z'],
    ['2026-12-21T10:00:00Z'],
  ])('is 1 at 02:00 London time on the day of %s', (now) => {
    const darkness = darknessForHour({
      ...PLYMOUTH,
      hour: 2,
      now: new Date(now),
    });

    expect(darkness).toBe(1);
  });

  test('uses the London calendar day of now, not the UTC day', () => {
    // 23:30 UTC on 20 June is 00:30 BST on 21 June.
    const now = new Date('2026-06-20T23:30:00Z');
    const expected = darknessFactor({
      ...PLYMOUTH,
      date: new Date('2026-06-21T12:00:00Z'),
    });

    expect(darknessForHour({ ...PLYMOUTH, hour: 13, now })).toBeCloseTo(expected, 9);
  });

  test('accepts fractional hours', () => {
    const now = new Date('2026-06-21T10:00:00Z');
    const expected = darknessFactor({
      ...PLYMOUTH,
      date: new Date('2026-06-21T20:30:00Z'),
    });

    expect(darknessForHour({ ...PLYMOUTH, hour: 21.5, now })).toBeCloseTo(expected, 9);
  });

  test('uses BST before the clocks go back on 2026-10-25', () => {
    const now = new Date('2026-10-24T10:00:00Z');
    const expected = darknessFactor({
      ...PLYMOUTH,
      date: new Date('2026-10-24T15:30:00Z'),
    });

    expect(darknessForHour({ ...PLYMOUTH, hour: 16.5, now })).toBeCloseTo(expected, 9);
  });

  test('uses GMT after the clocks go back on 2026-10-25', () => {
    const now = new Date('2026-10-25T10:00:00Z');
    const expected = darknessFactor({
      ...PLYMOUTH,
      date: new Date('2026-10-25T17:30:00Z'),
    });

    expect(darknessForHour({ ...PLYMOUTH, hour: 17.5, now })).toBeCloseTo(expected, 9);
  });

  test('uses GMT in winter', () => {
    const now = new Date('2026-12-21T09:00:00Z');
    const expected = darknessFactor({
      ...PLYMOUTH,
      date: new Date('2026-12-21T16:30:00Z'),
    });

    expect(darknessForHour({ ...PLYMOUTH, hour: 16.5, now })).toBeCloseTo(expected, 9);
  });

  test('accepts hour 0 and hour 24 as the day boundaries', () => {
    const now = new Date('2026-06-21T10:00:00Z');

    expect(darknessForHour({ ...PLYMOUTH, hour: 0, now })).toBe(1);
    expect(darknessForHour({ ...PLYMOUTH, hour: 24, now })).toBe(1);
  });

  test.each([
    ['negative hour', -1],
    ['hour above 24', 24.5],
    ['NaN hour', Number.NaN],
  ])('throws TypeError for a %s', (_name, hour) => {
    expect(() =>
      darknessForHour({
        ...PLYMOUTH,
        hour,
        now: new Date('2026-06-21T10:00:00Z'),
      }),
    ).toThrow(TypeError);
  });

  test('throws TypeError for a non-finite latitude', () => {
    expect(() =>
      darknessForHour({
        lat: Number.NaN,
        lng: PLYMOUTH.lng,
        hour: 12,
        now: new Date('2026-06-21T10:00:00Z'),
      }),
    ).toThrow(TypeError);
  });
});

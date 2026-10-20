const path = require('path');
const {
  presenceAt, venueFactor, hourFactor, deriveType,
} = require(path.resolve(__dirname, '../../../../src/safety/scoring/presence'));

describe('venueFactor L', () => {
  test('is 0 with no venues, 1 at 200, and monotone', () => {
    expect(venueFactor(0)).toBe(0);
    expect(venueFactor(200)).toBeCloseTo(1, 9);
    expect(venueFactor(1000)).toBe(1);
    expect(venueFactor(10)).toBeGreaterThan(venueFactor(5));
    expect(venueFactor(2)).toBeCloseTo(Math.log10(3) / Math.log10(201), 9);
  });
});

describe('hourFactor H', () => {
  test.each([
    ['centre', 12, 1.0], ['centre', 22, 0.9], ['centre', 23, 0.85], ['centre', 0, 0.8],
    ['centre', 2, 0.6], ['centre', 4, 0.3], ['centre', 6, 0.5],
    ['residential', 21, 0.6], ['residential', 22, 0.5], ['residential', 23, 0.3],
    ['residential', 1, 0.15], ['residential', 5, 0.1],
    ['park', 12, 0.5], ['park', 21, 0.05], ['park', 23, 0.05], ['park', 3, 0.05],
  ])('%s at %ih is %p', (type, hour, expected) => {
    expect(hourFactor(type, hour)).toBeCloseTo(expected, 9);
  });

  test('residential by day stays within 0.6 to 1.0', () => {
    for (let h = 7; h <= 19; h++) {
      const v = hourFactor('residential', h);
      expect(v).toBeGreaterThanOrEqual(0.6);
      expect(v).toBeLessThanOrEqual(1.0);
    }
  });

  test('interpolates between anchors and wraps at midnight', () => {
    expect(hourFactor('centre', 23.5)).toBeCloseTo(0.825, 9);
    expect(hourFactor('centre', 24)).toBeCloseTo(0.8, 9);
  });

  test('a park by day falls with darkness', () => {
    expect(hourFactor('park', 17, 1)).toBeCloseTo(0.05, 9);
    expect(hourFactor('park', 17, 0)).toBeCloseTo(0.5, 9);
  });
});

describe('deriveType', () => {
  test('park when remoteness >= 0.6, centre by venues or open places, else residential', () => {
    expect(deriveType({ remoteness: 0.6, venues: 100, openPlaces80m: 9 })).toBe('park');
    expect(deriveType({ remoteness: 0.2, venues: 40, openPlaces80m: 0 })).toBe('centre');
    expect(deriveType({ remoteness: 0.2, venues: 3, openPlaces80m: 5 })).toBe('centre');
    expect(deriveType({ remoteness: 0.2, venues: 39, openPlaces80m: 4 })).toBe('residential');
    expect(deriveType({})).toBe('residential');
  });
});

describe('presenceAt', () => {
  const base = { settlementClass: 'city', venueDensity: 2, type: 'residential', hour: 23, lateVenuesNearby: 0 };

  test('matches the formula', () => {
    const expected = 0.7 * (0.35 + 0.65 * venueFactor(2)) * 0.3;
    expect(presenceAt(base)).toBeCloseTo(expected, 9);
  });

  test('late venues add up to 0.15 in the late window only', () => {
    const none = presenceAt(base);
    expect(presenceAt({ ...base, lateVenuesNearby: 3 })).toBeCloseTo(none + 0.15, 9);
    expect(presenceAt({ ...base, lateVenuesNearby: 30 })).toBeCloseTo(none + 0.15, 9);
    expect(presenceAt({ ...base, lateVenuesNearby: 3, hour: 14 }))
      .toBeCloseTo(presenceAt({ ...base, hour: 14 }), 9);
  });

  test('is clamped to [0, 1]', () => {
    const p = presenceAt({ settlementClass: 'metropolis', venueDensity: 500, type: 'centre', hour: 12, lateVenuesNearby: 5 });
    expect(p).toBe(1);
    expect(presenceAt({ ...base, settlementClass: 'rural', venueDensity: 0, type: 'park' })).toBeGreaterThanOrEqual(0);
  });

  test('metropolis > city > largeTown > town > village > rural at the same spot and hour', () => {
    const order = ['metropolis', 'city', 'largeTown', 'town', 'village', 'rural'];
    const values = order.map((c) => presenceAt({ ...base, settlementClass: c }));
    for (let i = 1; i < values.length; i++) expect(values[i]).toBeLessThan(values[i - 1]);
  });

  test('a city centre at 23:00 is far busier than a town residential street', () => {
    const centre = presenceAt({ ...base, venueDensity: 80, type: 'centre', lateVenuesNearby: 5 });
    const town = presenceAt({ ...base, settlementClass: 'town', venueDensity: 3 });
    expect(centre).toBeGreaterThan(0.5);
    expect(town).toBeLessThan(0.1);
  });

  test('rejects an unknown class or non-finite hour', () => {
    expect(() => presenceAt({ ...base, settlementClass: 'galaxy' })).toThrow(TypeError);
    expect(() => presenceAt({ ...base, hour: NaN })).toThrow(TypeError);
    expect(() => presenceAt({ ...base, type: 'moon' })).toThrow(TypeError);
  });
});

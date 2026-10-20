const path = require('path');
const crime = require(path.resolve(__dirname, '../../../../../src/safety/services/graph/crimeStage'));

const noTick = () => {};
const BBOX = { south: 51.49, north: 51.51, west: -0.11, east: -0.09 };

describe('graph/crimeStage monthIndexOf', () => {
  test('parses YYYY-MM into a calendar month index', () => {
    expect(crime.monthIndexOf('2026-08')).toBe(2026 * 12 + 7);
    expect(crime.monthIndexOf('2026-01')).toBe(2026 * 12);
    expect(crime.monthIndexOf('2026-12')).toBe(2026 * 12 + 11);
  });

  test.each(['2026-13', '2026-00', '2026-8', 'Oct-2026', '', '2026-08-01', null, undefined, 202608])('%p is malformed', (value) => {
    expect(crime.monthIndexOf(value)).toBeNull();
  });
});

describe('graph/crimeStage newestIndex', () => {
  test('is the largest non-null value, -Infinity for none, and handles a million entries', () => {
    expect(crime.newestIndex([3, null, 9, 4])).toBe(9);
    expect(crime.newestIndex([null, null])).toBe(-Infinity);
    expect(crime.newestIndex([])).toBe(-Infinity);
    expect(crime.newestIndex(Array.from({ length: 1_000_000 }, (_, i) => i))).toBe(999_999);
  });
});

describe('graph/crimeStage crimesToWeightedCounts', () => {
  test('anchors recency on the newest month in the rows', () => {
    const out = crime.crimesToWeightedCounts([
      { category: 'a', month: '2026-08' }, { category: 'b', month: '2026-05' }, { category: 'c', month: '2025-08' },
    ]);
    expect(out).toEqual([
      { category: 'a', monthsAgo: 0 }, { category: 'b', monthsAgo: 3 }, { category: 'c', monthsAgo: 12 },
    ]);
  });

  test('malformed months count as the newest month, and an empty list is empty', () => {
    expect(crime.crimesToWeightedCounts([{ category: 'a' }, { category: 'b', month: '2026-04' }]).map((r) => r.monthsAgo)).toEqual([0, 0]);
    expect(crime.crimesToWeightedCounts([])).toEqual([]);
  });
});

describe('graph/crimeStage crimeCellKeyFn', () => {
  test('points within 500 m share a key, points beyond a cell edge do not', () => {
    const keyOf = crime.crimeCellKeyFn(BBOX);
    expect(keyOf(51.4901, -0.1099)).toBe(keyOf(51.4902, -0.1098));
    expect(keyOf(51.4901, -0.1099)).not.toBe(keyOf(51.4901 + 0.006, -0.1099));
    expect(keyOf(BBOX.south, BBOX.west)).toBe('0,0');
  });
});

describe('graph/crimeStage crimesInBbox', () => {
  test('keeps rows with finite coordinates inside the box, skipping null and out-of-range rows', () => {
    const inside = { lat: 51.5, lng: -0.1, category: 'a' };
    const rows = [
      inside, null, { lat: 10, lng: 10 }, { lat: NaN, lng: -0.1 }, { lat: 51.5, lng: Infinity }, { lat: 51.5 },
      { lat: BBOX.north, lng: BBOX.east, category: 'edge' },
    ];
    expect(crime.crimesInBbox(rows, BBOX, noTick)).toEqual([inside, { lat: BBOX.north, lng: BBOX.east, category: 'edge' }]);
    expect(crime.crimesInBbox(undefined, BBOX, noTick)).toEqual([]);
  });
});

describe('graph/crimeStage buildCrimeModel and crimeFactorAt', () => {
  const segments = [
    { dist: 1000, midLat: 51.5, midLng: -0.1 },
    { dist: 500, midLat: 51.5001, midLng: -0.1001 },
    { dist: 1000, midLat: 51.495, midLng: -0.105 },
  ];
  const rows = [
    { lat: 51.5, lng: -0.1, category: 'violent-crime', month: '2026-08' },
    { lat: 51.5, lng: -0.1, category: 'robbery', month: '2026-08' },
  ];

  test('accumulates exposure per cell and an area prior from the total weighted count', () => {
    const model = crime.buildCrimeModel(rows, BBOX, segments, 2.5, noTick);
    const cell = model.cells.get(model.cellKeyOf(51.5, -0.1));
    expect(cell.exposureKm).toBeCloseTo(1.5, 12);
    expect(cell.weightedCount).toBeGreaterThan(1);
    expect(model.priorRate).toBeCloseTo(cell.weightedCount / 2.5, 12);
    const other = model.cells.get(model.cellKeyOf(51.495, -0.105));
    expect(other.weightedCount).toBe(0);
  });

  test('the prior never falls below the floor, and a zero-length network does not divide by zero', () => {
    expect(crime.buildCrimeModel([], BBOX, segments, 2.5, noTick).priorRate).toBe(0.1);
    expect(crime.buildCrimeModel(rows, BBOX, [], 0, noTick).priorRate).toBe(0.1);
  });

  test('an ok cell with crime is riskier than a clean cell, and carries evidence from its exposure', () => {
    const model = crime.buildCrimeModel(rows, BBOX, segments, 2.5, noTick);
    const hot = crime.crimeFactorAt(model, 51.5, -0.1, 'ok');
    const clean = crime.crimeFactorAt(model, 51.495, -0.105, 'ok');
    expect(hot.safety).toBeLessThan(clean.safety);
    expect(hot.n).toBeGreaterThan(0);
    expect(hot.safety).toBeGreaterThan(0);
    expect(hot.safety).toBeLessThan(1);
  });

  test('any status other than ok leaves the factor unknown', () => {
    const model = crime.buildCrimeModel(rows, BBOX, segments, 2.5, noTick);
    for (const status of ['unavailable', undefined, null, 'OK', 'weird']) {
      expect(crime.crimeFactorAt(model, 51.5, -0.1, status)).toEqual({ safety: null, n: 0 });
    }
  });
});

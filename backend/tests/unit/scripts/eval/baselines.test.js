const {
  globalRate,
  classRates,
  outOfFoldBaselines,
  v1LitRule,
} = require('../../../../scripts/eval/lib/baselines');

describe('globalRate', () => {
  test('is the mean of the labels', () => {
    expect(globalRate([1, 0, 0, 1])).toBe(0.5);
  });
});

describe('classRates', () => {
  test('is the empirical per-class positive rate; unseen classes are absent from the map', () => {
    const rows = [
      { highway: 'primary', label: 1 },
      { highway: 'primary', label: 1 },
      { highway: 'footway', label: 0 },
      { highway: 'footway', label: 0 },
      { highway: 'footway', label: 1 },
    ];
    const rates = classRates(rows);
    expect(rates.get('primary')).toBe(1);
    expect(rates.get('footway')).toBeCloseTo(1 / 3, 12);
    expect(rates.has('service')).toBe(false);
  });
});

describe('outOfFoldBaselines', () => {
  const rows = [
    { highway: 'primary', label: 1, fold: 0 },
    { highway: 'primary', label: 1, fold: 1 },
    { highway: 'footway', label: 0, fold: 0 },
    { highway: 'footway', label: 0, fold: 1 },
    { highway: 'footway', label: 0, fold: 1 },
  ];

  test('predicts each held-out row from the other folds only', () => {
    const { global, roadClass } = outOfFoldBaselines(rows);
    // Row 0 (fold 0) trains on fold 1: labels 1,0,0 -> global 1/3.
    expect(global[0]).toBeCloseTo(1 / 3, 12);
    // Its class 'primary' in fold 1 has one row with label 1 -> rate 1.
    expect(roadClass[0]).toBe(1);
    // Row 2 (fold 0, footway) trains on fold 1: labels 1,0,0 -> global 1/3.
    expect(global[2]).toBeCloseTo(1 / 3, 12);
    // Its class 'footway' in fold 1 is 0/2 -> rate 0.
    expect(roadClass[2]).toBe(0);
    // Row 3 (fold 1, footway) trains on fold 0: labels 1,0 -> global 0.5.
    expect(global[3]).toBeCloseTo(0.5, 12);
    expect(roadClass[3]).toBe(0);
  });

  test('a row never influences its own prediction', () => {
    const base = outOfFoldBaselines(rows);
    const flipped = rows.map((r, i) => (i === 0 ? { ...r, label: 0 } : r));
    const after = outOfFoldBaselines(flipped);
    expect(after.global[0]).toBe(base.global[0]);
    expect(after.roadClass[0]).toBe(base.roadClass[0]);
  });
});

describe('v1LitRule', () => {
  test('predicts 1 only for an explicit lit=yes tag, otherwise 0', () => {
    expect(v1LitRule('yes')).toBe(1);
    expect(v1LitRule('no')).toBe(0);
    expect(v1LitRule(undefined)).toBe(0);
    expect(v1LitRule('limited')).toBe(0);
  });
});

const {
  brierScore,
  logLoss,
  expectedCalibrationError,
  auc,
  accuracyAt,
  summarise,
} = require('../../../../scripts/eval/lib/metrics');

describe('brierScore', () => {
  test('is zero for perfect predictions', () => {
    expect(brierScore([1, 0, 1], [1, 0, 1])).toBe(0);
  });

  test('is the mean squared error of probabilities against 0/1 labels', () => {
    // (0.5-1)^2 = 0.25, (0.2-0)^2 = 0.04 -> mean 0.145
    expect(brierScore([0.5, 0.2], [1, 0])).toBeCloseTo(0.145, 10);
  });

  test('is 1 for fully wrong confident predictions', () => {
    expect(brierScore([0, 1], [1, 0])).toBe(1);
  });

  test('rejects mismatched lengths and empty input', () => {
    expect(() => brierScore([0.5], [1, 0])).toThrow(TypeError);
    expect(() => brierScore([], [])).toThrow(TypeError);
  });
});

describe('logLoss', () => {
  test('equals -ln(p) for a single correct label', () => {
    expect(logLoss([0.8], [1])).toBeCloseTo(-Math.log(0.8), 12);
  });

  test('clips probabilities so exact 0 or 1 wrong answers stay finite', () => {
    const value = logLoss([1, 0], [0, 1]);
    expect(Number.isFinite(value)).toBe(true);
    expect(value).toBeGreaterThan(10);
  });

  test('is minimal at the true rate for a constant predictor', () => {
    const labels = [1, 1, 0, 0, 0, 0, 0, 0, 0, 0];
    const atRate = logLoss(Array(10).fill(0.2), labels);
    const offRate = logLoss(Array(10).fill(0.6), labels);
    expect(atRate).toBeLessThan(offRate);
  });
});

describe('expectedCalibrationError', () => {
  test('is zero when each bin is calibrated', () => {
    // Bin 0.2 holds 5 items with 1 positive (rate 0.2) and bin 0.8 holds 5 with 4 positives.
    const p = [0.2, 0.2, 0.2, 0.2, 0.2, 0.8, 0.8, 0.8, 0.8, 0.8];
    const y = [1, 0, 0, 0, 0, 1, 1, 1, 1, 0];
    const { ece } = expectedCalibrationError(p, y, 10);
    expect(ece).toBeCloseTo(0, 12);
  });

  test('weights each bin gap by its share of items', () => {
    // Bin 0.9: 4 items, predicted 0.9, observed 0.5 -> gap 0.4, weight 0.8.
    // Bin 0.1: 1 item, predicted 0.1, observed 0 -> gap 0.1, weight 0.2.
    const p = [0.9, 0.9, 0.9, 0.9, 0.1];
    const y = [1, 1, 0, 0, 0];
    const { ece } = expectedCalibrationError(p, y, 10);
    expect(ece).toBeCloseTo(0.8 * 0.4 + 0.2 * 0.1, 10);
  });

  test('puts p = 1 in the last bin and skips empty bins in the table', () => {
    const { table } = expectedCalibrationError([1, 1], [1, 1], 10);
    expect(table).toHaveLength(1);
    expect(table[0]).toMatchObject({ n: 2, meanPred: 1, observed: 1 });
    expect(table[0].hi).toBe(1);
  });

  test('reports bin edges and counts per populated bin', () => {
    const { table } = expectedCalibrationError([0.05, 0.55, 0.55], [0, 1, 0], 10);
    expect(table.map((row) => row.n)).toEqual([1, 2]);
    expect(table[1].lo).toBeCloseTo(0.5, 12);
    expect(table[1].observed).toBeCloseTo(0.5, 12);
  });
});

describe('auc (Mann-Whitney)', () => {
  test('is 1 when every positive outranks every negative', () => {
    expect(auc([0.9, 0.8, 0.2, 0.1], [1, 1, 0, 0])).toBe(1);
  });

  test('is 0 when fully reversed', () => {
    expect(auc([0.1, 0.2, 0.8, 0.9], [1, 1, 0, 0])).toBe(0);
  });

  test('gives ties half credit', () => {
    expect(auc([0.5, 0.5], [1, 0])).toBe(0.5);
  });

  test('returns null when only one class is present', () => {
    expect(auc([0.3, 0.4], [1, 1])).toBeNull();
    expect(auc([0.3, 0.4], [0, 0])).toBeNull();
  });
});

describe('accuracyAt', () => {
  test('counts p >= threshold as a positive prediction', () => {
    expect(accuracyAt([0.5, 0.49, 0.9, 0.1], [1, 0, 1, 1])).toBeCloseTo(3 / 4, 12);
  });
});

describe('summarise', () => {
  test('returns every metric together with the sample size and base rate', () => {
    const result = summarise([0.9, 0.1], [1, 0]);
    expect(result).toMatchObject({ n: 2, positiveRate: 0.5, accuracy: 1, auc: 1 });
    expect(result.brier).toBeCloseTo(0.01, 12);
    expect(result.calibration).toHaveLength(2);
    expect(result.ece).toBeDefined();
  });
});

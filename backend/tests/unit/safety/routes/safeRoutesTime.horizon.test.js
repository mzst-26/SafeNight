const { parseTimeParams } = require('../../../../src/safety/routes/safeRoutesTime');

// Fixed clock. The 24 h horizon is written out as literal milliseconds on purpose: the test must not read
// TIME_HORIZON_MS, so a change to that constant is caught here.
const NOW = Date.parse('2026-10-20T16:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_MS = 60 * 1000;
const iso = (ms) => new Date(ms).toISOString();

describe('parseTimeParams 24 h horizon (literal)', () => {
  test('leave_at exactly now + 24 h is accepted', () => {
    const r = parseTimeParams({ leave_at: iso(NOW + DAY_MS) }, NOW);
    expect(r.ok).toBe(true);
    expect(r.value.leaveAtMs).toBe(NOW + DAY_MS);
  });

  test('leave_at at now + 24 h + 1 min is TIME_OUT_OF_RANGE', () => {
    const r = parseTimeParams({ leave_at: iso(NOW + DAY_MS + MIN_MS) }, NOW);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('TIME_OUT_OF_RANGE');
  });

  test('arrive_by exactly now + 24 h is accepted', () => {
    const r = parseTimeParams({ arrive_by: iso(NOW + DAY_MS) }, NOW);
    expect(r.ok).toBe(true);
    expect(r.value.arriveByMs).toBe(NOW + DAY_MS);
  });

  test('arrive_by at now + 24 h + 1 min is TIME_OUT_OF_RANGE', () => {
    const r = parseTimeParams({ arrive_by: iso(NOW + DAY_MS + MIN_MS) }, NOW);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('TIME_OUT_OF_RANGE');
  });
});

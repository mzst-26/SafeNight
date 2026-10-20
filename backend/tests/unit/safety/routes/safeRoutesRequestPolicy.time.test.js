const { parseRouteRequest } = require('../../../../src/safety/routes/safeRoutesRequestPolicy');
const { haversine } = require('../../../../src/safety/services/geo');

const NOW = Date.parse('2026-10-20T16:00:00Z');
const BASE = { origin_lat: '51.50', origin_lng: '-0.12', dest_lat: '51.51', dest_lng: '-0.11' };
const parse = (extra) => parseRouteRequest({ query: { ...BASE, ...extra } }, 20, haversine, NOW);

describe('parseRouteRequest time params', () => {
  test('no time params: leave now', () => {
    const r = parse({});
    expect(r.ok).toBe(true);
    expect(r.value.leaveAtMs).toBeNull();
    expect(r.value.arriveByMs).toBeNull();
  });
  test('leave_at and arrive_by are parsed to epoch ms', () => {
    expect(parse({ leave_at: '2026-10-20T17:10:00+01:00' }).value.leaveAtMs).toBe(Date.parse('2026-10-20T16:10:00Z'));
    expect(parse({ arrive_by: '2026-10-20T19:00:00Z' }).value.arriveByMs).toBe(Date.parse('2026-10-20T19:00:00Z'));
  });
  test('no offset -> INVALID_TIME with a message', () => {
    const r = parse({ leave_at: '2026-10-20T17:10:00' });
    expect(r).toMatchObject({ ok: false, error: 'INVALID_TIME' });
    expect(r.message).toMatch(/offset/i);
  });
  test('both -> INVALID_TIME', () => {
    expect(parse({ leave_at: '2026-10-20T17:10:00Z', arrive_by: '2026-10-20T18:10:00Z' }))
      .toMatchObject({ ok: false, error: 'INVALID_TIME' });
  });
  test('out of horizon -> TIME_OUT_OF_RANGE', () => {
    expect(parse({ leave_at: '2026-10-22T17:10:00Z' })).toMatchObject({ ok: false, error: 'TIME_OUT_OF_RANGE' });
    expect(parse({ arrive_by: '2026-10-20T16:01:00Z' })).toMatchObject({ ok: false, error: 'TIME_OUT_OF_RANGE' });
  });
  test('legacy departure_hour still parsed alongside, and is not an error with leave_at', () => {
    const r = parse({ leave_at: '2026-10-20T17:10:00Z', departure_hour: '3' });
    expect(r.ok).toBe(true);
    expect(r.value.departureHour).toBe(3);
    expect(parse({ departure_hour: '3' }).value.leaveAtMs).toBeNull();
  });
});

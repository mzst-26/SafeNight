const { buildWayRecord } = require('../../../../scripts/eval/lib/records');
const { thinLampsAndCompare } = require('../../../../scripts/eval/lib/thinning');
const { areaKeyOf } = require('../../../../scripts/eval/lib/features');

const LAT = 50.4015; // near the centre of an area cell (cells are 0.003 deg)
const LNG = -4.1005;
const cellCentre = (lat, lng) => [
  (Math.floor(lat / 0.003) + 0.5) * 0.003,
  (Math.floor(lng / 0.003) + 0.5) * 0.003,
];
const [CLAT, CLNG] = cellCentre(LAT, LNG);
const DEG_LAT_PER_M = 1 / 111320;

function litWay(id, lit = 'yes', highway = 'residential') {
  return buildWayRecord({
    id,
    tags: { highway, maxspeed: '30 mph', lit },
    coords: [[CLNG - 0.0002, CLAT], [CLNG + 0.0002, CLAT]],
  });
}

describe('thinLampsAndCompare', () => {
  test('with the lit tag visible the estimate cannot change (explicit tags win)', () => {
    const way = litWay(1, 'yes');
    const lamps = Array.from({ length: 6 }, (_, i) => ({ lat: CLAT + (40 + i) * DEG_LAT_PER_M, lng: CLNG }));
    const areaKm = new Map([[areaKeyOf(CLAT, CLNG), 1]]);
    const out = thinLampsAndCompare({ sample: [way], lamps, records: [way], areaKm, fraction: 0.5, seed: 1, hideTag: false });
    expect(out.summary.roseCount).toBe(0);
    expect(out.summary.meanDelta).toBeCloseTo(0, 12);
  });

  test('removes floor(fraction * n) lamps, and the same seed removes the same lamps', () => {
    const way = litWay(1);
    const lamps = Array.from({ length: 9 }, (_, i) => ({ lat: CLAT + (40 + i) * DEG_LAT_PER_M, lng: CLNG }));
    const areaKm = new Map([[areaKeyOf(CLAT, CLNG), 1]]);
    const a = thinLampsAndCompare({ sample: [way], lamps, records: [way], areaKm, fraction: 0.5, seed: 5, hideTag: true });
    const b = thinLampsAndCompare({ sample: [way], lamps, records: [way], areaKm, fraction: 0.5, seed: 5, hideTag: true });
    expect(a.summary.lampsRemoved).toBe(4);
    expect(a.summary.lampsRemoved).toBe(b.summary.lampsRemoved);
    expect(a.perWay).toEqual(b.perWay);
  });

  test('detects a rise caused by the absence branch switching off as density falls (isolated path)', () => {
    // Three lamps in the cell, none within 30 m of the path, area length 1 km:
    // density 3/km > 2 -> absence branch (lower). Removing 1 lamp -> density 2, not > 2 -> prior (higher).
    const way = litWay(1, 'yes', 'path');
    const lamps = [0.0012, 0.0013, 0.0014].map((d) => ({ lat: CLAT + d, lng: CLNG }));
    const areaKm = new Map([[areaKeyOf(CLAT, CLNG), 1]]);
    const out = thinLampsAndCompare({ sample: [way], lamps, records: [way], areaKm, fraction: 0.5, seed: 2, hideTag: true });
    expect(out.summary.roseCount).toBe(1);
    expect(out.summary.roseByCause['absence-threshold']).toBe(1);
    expect(out.summary.roseFraction).toBe(1);
    expect(out.summary.roseByHighway).toEqual({ path: 1 });
  });

  test('a road in the same scene never rises: the absence rule does not apply to roads', () => {
    const way = litWay(1, 'yes', 'residential');
    const lamps = [0.0012, 0.0013, 0.0014].map((d) => ({ lat: CLAT + d, lng: CLNG }));
    const areaKm = new Map([[areaKeyOf(CLAT, CLNG), 1]]);
    const out = thinLampsAndCompare({ sample: [way], lamps, records: [way], areaKm, fraction: 0.5, seed: 2, hideTag: true });
    expect(out.summary.roseCount).toBe(0);
  });

  test('a way with no lamp change and no threshold crossing never rises', () => {
    // Many lamps in a dense cell, 30 m away from the way: density stays far above the threshold.
    const way = litWay(1);
    const lamps = Array.from({ length: 40 }, (_, i) => ({ lat: CLAT + (0.0012 + i * 0.00001), lng: CLNG }));
    const areaKm = new Map([[areaKeyOf(CLAT, CLNG), 0.5]]);
    const out = thinLampsAndCompare({ sample: [way], lamps, records: [way], areaKm, fraction: 0.5, seed: 4, hideTag: true });
    expect(out.summary.roseCount).toBe(0);
  });
});

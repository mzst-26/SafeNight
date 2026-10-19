const { BBOX, synthetic } = require('./support/synthetic');
const { buildWayRecord, isLabelled, createTally, tallyRecord, summariseTally } = require('../../../../scripts/eval/lib/records');
const { runLeaveOut } = require('../../../../scripts/eval/lib/leaveout');
const { addAreaKm } = require('../../../../scripts/eval/lib/features');

function dataset(seed = 11) {
  const { roadElements, lightElements } = synthetic(seed);
  const records = roadElements
    .filter((e) => e.type === 'way')
    .map((way) => buildWayRecord(way));
  const lamps = lightElements
    .filter((e) => e.type === 'node' && e.tags?.highway === 'street_lamp')
    .map((e) => ({ lat: e.lat, lng: e.lon }));
  const areaKm = new Map();
  for (const r of records) if (r.walkable) addAreaKm(areaKm, r.segments);
  return { records, lamps, areaKm };
}

describe('buildWayRecord / isLabelled', () => {
  test('normalises lit, keeps lit=yes vertices and marks labelled walkable ways', () => {
    const way = {
      type: 'way',
      id: 1,
      tags: { highway: 'footway', lit: ' YES ' },
      coords: [[-4.1, 50.4], [-4.1, 50.4009]],
    };
    const rec = buildWayRecord(way);
    expect(rec.lit).toBe('yes');
    expect(rec.litVertices).toHaveLength(2);
    expect(isLabelled(rec)).toBe(true);
  });

  test('a way without a lit tag, or a non-walkable way, is not labelled', () => {
    const noTag = buildWayRecord({ id: 2, tags: { highway: 'footway' }, coords: [[-4.1, 50.4], [-4.1, 50.401]] });
    const motorway = buildWayRecord({ id: 3, tags: { highway: 'motorway', lit: 'yes' }, coords: [[-4.1, 50.4], [-4.1, 50.401]] });
    expect(isLabelled(noTag)).toBe(false);
    expect(isLabelled(motorway)).toBe(false);
  });
});

describe('tag presence tally', () => {
  test('counts walkable ways, lit tags and labelled share', () => {
    const tally = createTally();
    tallyRecord(tally, buildWayRecord({ id: 1, tags: { highway: 'residential', lit: 'yes' }, coords: [[-4.1, 50.4], [-4.1, 50.401]] }));
    tallyRecord(tally, buildWayRecord({ id: 2, tags: { highway: 'residential' }, coords: [[-4.1, 50.4], [-4.1, 50.401]] }));
    tallyRecord(tally, buildWayRecord({ id: 3, tags: { highway: 'footway', lit: 'limited' }, coords: [[-4.1, 50.4], [-4.1, 50.401]] }));
    const s = summariseTally(tally);
    expect(s.walkableWays).toBe(3);
    expect(s.withLitTag).toBe(2);
    expect(s.litTagShare).toBeCloseTo(2 / 3, 12);
    expect(s.labelledWays).toBe(1);
    expect(s.litValueCounts).toEqual({ yes: 1, limited: 1 });
  });
});

describe('runLeaveOut', () => {
  test('predicts every labelled way exactly once per lamp mode', () => {
    const { records, lamps, areaKm } = dataset();
    const labelled = records.filter(isLabelled);
    const result = runLeaveOut({ records, lamps, areaKm, bbox: BBOX, k: 5, seed: 3 });
    expect(result.n).toBe(labelled.length);
    expect(result.modes.hidden.effective.n).toBe(labelled.length);
    expect(result.modes.visible.effective.n).toBe(labelled.length);
    expect(result.modes.hidden.effective.brier).toBeGreaterThanOrEqual(0);
    expect(result.modes.hidden.effective.brier).toBeLessThanOrEqual(1);
  });

  test('reports the baselines and the per-source breakdown', () => {
    const { records, lamps, areaKm } = dataset();
    const result = runLeaveOut({ records, lamps, areaKm, bbox: BBOX, k: 5, seed: 3 });
    expect(Object.keys(result.baselines).sort()).toEqual(['global', 'roadClass', 'v1Rule']);
    const sources = Object.keys(result.modes.hidden.bySource);
    expect(sources.every((s) => ['prior', 'lamp', 'neighbour-lit', 'absence'].includes(s))).toBe(true);
    const total = sources.reduce((sum, s) => sum + result.modes.hidden.bySource[s].n, 0);
    expect(total).toBe(result.n);
  });

  test('the v1 rule predicts 0 for every hidden-tag way', () => {
    const { records, lamps, areaKm } = dataset();
    const result = runLeaveOut({ records, lamps, areaKm, bbox: BBOX, k: 5, seed: 3 });
    expect(result.baselines.v1Rule.meanPrediction).toBe(0);
  });

  test('a way prediction does not depend on its own lit tag (hidden from its own fold)', () => {
    const { records, lamps, areaKm } = dataset();
    const labelled = records.filter(isLabelled);
    const target = labelled.find((r) => r.lit === 'yes');
    const flipped = records.map((r) => (r === target
      ? { ...r, lit: 'no', tags: { ...r.tags, lit: 'no' }, litVertices: null }
      : r));
    const before = runLeaveOut({ records, lamps, areaKm, bbox: BBOX, k: 5, seed: 3, collectPredictions: true });
    const after = runLeaveOut({ records: flipped, lamps, areaKm, bbox: BBOX, k: 5, seed: 3, collectPredictions: true });
    for (const mode of ['hidden', 'visible']) {
      const a = before.predictions[mode].find((p) => p.id === target.id);
      const b = after.predictions[mode].find((p) => p.id === target.id);
      expect(b.effective).toBe(a.effective);
      expect(b.source).toBe(a.source);
    }
  });

  test('a short held-out lit=yes way does not count its own vertices as a lamp', () => {
    // Its own vertices are 10 m apart, so they sit within 30 m of its anchor. Leaking them would
    // turn the prior into the lamp branch.
    const lat0 = 50.405;
    const lng0 = -4.11;
    const target = buildWayRecord({
      id: 1,
      tags: { highway: 'residential', lit: 'yes' },
      coords: [[lng0, lat0], [lng0, lat0 + 10 * (1 / 111320)]],
    });
    const others = Array.from({ length: 6 }, (_, i) => {
      const lat = lat0 + (i + 1) * 0.02; // about 2.2 km apart, so each sits in its own 1 km block
      return buildWayRecord({
        id: 10 + i,
        tags: { highway: 'residential', lit: i % 2 ? 'yes' : 'no' },
        coords: [[lng0, lat], [lng0, lat + 20 * (1 / 111320)]],
      });
    });
    const records = [target, ...others];
    const areaKm = new Map();
    for (const r of records) addAreaKm(areaKm, r.segments);
    const result = runLeaveOut({ records, lamps: [], areaKm, bbox: BBOX, k: 5, seed: 2, collectPredictions: true });
    for (const mode of ['hidden', 'visible']) {
      const p = result.predictions[mode].find((x) => x && x.id === 1);
      expect(p.lampCount30m).toBe(0);
      expect(p.source).toBe('prior');
    }
  });

  test('reports labelled counts and lit rate per road class', () => {
    const { records, lamps, areaKm } = dataset();
    const result = runLeaveOut({ records, lamps, areaKm, bbox: BBOX, k: 5, seed: 3 });
    const labelled = records.filter(isLabelled);
    const classes = [...new Set(labelled.map((r) => r.highway))];
    expect(Object.keys(result.byHighway).sort()).toEqual(classes.sort());
    for (const cls of Object.keys(result.byHighway)) {
      const rows = labelled.filter((r) => r.highway === cls);
      const pos = rows.filter((r) => r.lit === 'yes').length;
      expect(result.byHighway[cls].n).toBe(rows.length);
      expect(result.byHighway[cls].positiveRate).toBeCloseTo(pos / rows.length, 12);
    }
  });
});

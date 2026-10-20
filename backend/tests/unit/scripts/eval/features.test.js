const {
  segmentsOf,
  anchorOf,
  areaKeyOf,
  addAreaKm,
  buildLampIndex,
  buildLitIndex,
  buildRoadIndexFromRecords,
  lightingFeatures,
  estimateLighting,
} = require('../../../../scripts/eval/lib/features');

// 1 deg latitude is 111320 m. Keep test coordinates on the equator-free side of the bbox.
const LAT = 50.4;
const LNG = -4.1;
const DEG_PER_M_LAT = 1 / 111320;
const DEG_PER_M_LNG = 1 / (111320 * Math.cos(LAT * Math.PI / 180));

describe('segmentsOf', () => {
  test('returns one segment per consecutive pair with midpoint and length in km', () => {
    const coords = [[LNG, LAT], [LNG, LAT + 100 * DEG_PER_M_LAT]];
    const segs = segmentsOf(coords);
    expect(segs).toHaveLength(1);
    expect(segs[0].midLat).toBeCloseTo(LAT + 50 * DEG_PER_M_LAT, 9);
    expect(segs[0].km).toBeCloseTo(0.1, 3);
  });

  test('raises segments shorter than 0.5 m to 0.5 m instead of dropping them, as buildGraph does', () => {
    const coords = [[LNG, LAT], [LNG, LAT + 0.2 * DEG_PER_M_LAT], [LNG, LAT + 50 * DEG_PER_M_LAT]];
    const segs = segmentsOf(coords);
    expect(segs).toHaveLength(2);
    expect(segs[0].km).toBeCloseTo(0.0005, 9);
  });

  test('returns an empty list for a single vertex', () => {
    expect(segmentsOf([[LNG, LAT]])).toEqual([]);
  });
});

describe('anchorOf', () => {
  test('picks the segment that contains the half-length point of the way', () => {
    // Segments of 10 m, 80 m, 10 m: the half-length point (50 m) is inside the 80 m segment.
    const coords = [
      [LNG, LAT],
      [LNG, LAT + 10 * DEG_PER_M_LAT],
      [LNG, LAT + 90 * DEG_PER_M_LAT],
      [LNG, LAT + 100 * DEG_PER_M_LAT],
    ];
    const anchor = anchorOf(segmentsOf(coords));
    expect(anchor.midLat).toBeCloseTo(LAT + 50 * DEG_PER_M_LAT, 9);
  });

  test('is null when there are no segments', () => {
    expect(anchorOf([])).toBeNull();
  });
});

describe('areaKeyOf', () => {
  test('uses 0.003 degree cells as buildGraph does', () => {
    expect(areaKeyOf(50.3001, -4.2999)).toBe(`${Math.floor(50.3001 / 0.003)},${Math.floor(-4.2999 / 0.003)}`);
  });
});

describe('addAreaKm', () => {
  test('accumulates segment length per area cell of the segment midpoint', () => {
    const area = new Map();
    addAreaKm(area, segmentsOf([[LNG, LAT], [LNG, LAT + 100 * DEG_PER_M_LAT]]));
    addAreaKm(area, segmentsOf([[LNG, LAT], [LNG, LAT + 100 * DEG_PER_M_LAT]]));
    expect(area.get(areaKeyOf(LAT + 50 * DEG_PER_M_LAT, LNG))).toBeCloseTo(0.2, 3);
  });
});

describe('lightingFeatures', () => {
  const anchor = { midLat: LAT, midLng: LNG };
  const lampAt = (metres) => ({ lat: LAT + metres * DEG_PER_M_LAT, lng: LNG });

  test('counts lamps within 30 m and ignores lamps beyond it', () => {
    const lampIndex = buildLampIndex([lampAt(10), lampAt(25), lampAt(40)]);
    const litIndex = buildLitIndex([]);
    const f = lightingFeatures({ anchor, lampIndex, litIndex, areaWayKm: 1 });
    expect(f.lampCount30m).toBe(2);
  });

  test('flags a visible lit-way vertex within 30 m as a lit neighbour, not as a lamp', () => {
    const lampIndex = buildLampIndex([]);
    const litIndex = buildLitIndex([{ lat: LAT + 5 * DEG_PER_M_LAT, lng: LNG }]);
    const f = lightingFeatures({ anchor, lampIndex, litIndex, areaWayKm: 1 });
    expect(f.lampCount30m).toBe(0);
    expect(f.litNeighbour).toBe(true);
  });

  test('nearRoad is undefined without a road index, and true or false with one', () => {
    const lampIndex = buildLampIndex([]);
    const litIndex = buildLitIndex([]);
    expect(lightingFeatures({ anchor, lampIndex, litIndex, areaWayKm: 1 }).nearRoad).toBeUndefined();
    const roadAt = (metres) => buildRoadIndexFromRecords([{
      highway: 'residential',
      segments: segmentsOf([[LNG - 0.001, LAT + metres * DEG_PER_M_LAT], [LNG + 0.001, LAT + metres * DEG_PER_M_LAT]]),
    }]);
    expect(lightingFeatures({ anchor, lampIndex, litIndex, areaWayKm: 1, roadIndex: roadAt(10) }).nearRoad).toBe(true);
    expect(lightingFeatures({ anchor, lampIndex, litIndex, areaWayKm: 1, roadIndex: roadAt(60) }).nearRoad).toBe(false);
  });

  test('the road index ignores footway-like and path ways', () => {
    const index = buildRoadIndexFromRecords([{
      highway: 'footway',
      segments: segmentsOf([[LNG - 0.001, LAT], [LNG + 0.001, LAT]]),
    }]);
    expect(lightingFeatures({
      anchor, lampIndex: buildLampIndex([]), litIndex: buildLitIndex([]), areaWayKm: 1, roadIndex: index,
    }).nearRoad).toBe(false);
  });

  test('area density is cell lamps divided by cell way length', () => {
    const lampIndex = buildLampIndex([lampAt(0), lampAt(1), lampAt(2), lampAt(3)]);
    const f = lightingFeatures({
      anchor,
      lampIndex,
      litIndex: buildLitIndex([]),
      areaWayKm: 2,
    });
    expect(f.areaLampDensityPerKm).toBeCloseTo(2, 9);
    expect(f.areaWayKm).toBe(2);
  });

  test('area density is zero when the area has no way length', () => {
    const f = lightingFeatures({
      anchor,
      lampIndex: buildLampIndex([lampAt(0)]),
      litIndex: buildLitIndex([]),
      areaWayKm: 0,
    });
    expect(f.areaLampDensityPerKm).toBe(0);
  });
});

describe('estimateLighting', () => {
  test('hides an explicit lit tag: a lit=yes way with no lamps falls back to the prior', () => {
    const tags = { highway: 'residential', lit: 'yes' };
    const hidden = estimateLighting(
      { ...tags, lit: undefined },
      { lampCount30m: 0, areaLampDensityPerKm: 0, areaWayKm: 1 },
    );
    expect(hidden.source).toBe('prior');
    expect(hidden.pLit).toBeCloseTo(0.88, 12);
    expect(hidden.n).toBe(3);
  });

  test('uses the lamp branch when a lamp is within 30 m', () => {
    const est = estimateLighting(
      { highway: 'service' },
      { lampCount30m: 1, areaLampDensityPerKm: 0, areaWayKm: 1 },
    );
    expect(est.source).toBe('lamp');
    expect(est.pLit).toBeCloseTo(0.85, 12);
  });

  test('returns effective P(lit) shrunk towards 0.5', () => {
    const est = estimateLighting(
      { highway: 'service' },
      { lampCount30m: 0, areaLampDensityPerKm: 0, areaWayKm: 1 },
    );
    // service prior 0.62 with n 3, shrunk by the lighting pseudo-count (1)
    expect(est.effective).toBeCloseTo((0.62 * 3 + 0.5) / 4, 12);
    expect(est.effective).toBeGreaterThan(0.5);
    expect(est.effective).toBeLessThan(0.62);
  });
});

describe('leakage guard', () => {
  test('a way whose own vertices are excluded from the lit index gets no lit-way contribution', () => {
    const own = [{ lat: LAT, lng: LNG }, { lat: LAT + 10 * DEG_PER_M_LAT, lng: LNG }];
    const anchor = anchorOf(segmentsOf(own.map((p) => [p.lng, p.lat])));
    const withOwn = lightingFeatures({
      anchor,
      lampIndex: buildLampIndex([]),
      litIndex: buildLitIndex(own),
      areaWayKm: 1,
    });
    const withoutOwn = lightingFeatures({
      anchor,
      lampIndex: buildLampIndex([]),
      litIndex: buildLitIndex([]),
      areaWayKm: 1,
    });
    expect(withOwn.litNeighbour).toBe(true);
    expect(withOwn.lampCount30m).toBe(0);
    expect(withoutOwn.litNeighbour).toBe(false);
  });
});

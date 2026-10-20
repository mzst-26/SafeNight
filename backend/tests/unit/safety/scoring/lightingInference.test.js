const {
  inferLighting,
  effectiveLit,
  lightingCertainty,
} = require('../../../../src/safety/scoring/lightingInference');

const HIGHWAYS = [
  undefined, 'trunk', 'primary', 'secondary', 'tertiary', 'residential',
  'living_street', 'service', 'unclassified', 'footway', 'path', 'track',
  'steps', 'bridleway', 'cycleway', 'pedestrian', 'bus_guideway',
];
const MAXSPEEDS = [undefined, '30 mph', '20 mph', '40 mph', '30', '50 km/h', 'GB:urban'];
const SIDEWALKS = [undefined, 'yes', 'no', 'both'];
const LAMP_COUNTS = [0, 1, 2, 3, 7];
const DENSITIES = [0, 0.1, 2, 5];
const AREA_WAY_KMS = [0, 0.2, 1];
const NEAR_ROADS = [undefined, false, true];

function infer(tags, overrides = {}) {
  return inferLighting({
    tags,
    lampCount30m: 0,
    areaLampDensityPerKm: 0,
    areaWayKm: 1,
    ...overrides,
  });
}

function effectiveFor(tags, overrides = {}) {
  return effectiveLit(infer(tags, overrides));
}

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

describe('inferLighting: explicit lit tags', () => {
  test('lit=yes gives a strong lit estimate from the tag', () => {
    expect(infer({ lit: 'yes' })).toEqual({ pLit: 0.95, n: 20, source: 'tag' });
  });

  test('lit=no gives a strong dark estimate from the tag', () => {
    expect(infer({ lit: 'no' })).toEqual({ pLit: 0.05, n: 20, source: 'tag' });
  });

  test('lit=24/7 is treated as lit all night', () => {
    expect(infer({ lit: '24/7' })).toEqual({ pLit: 0.95, n: 20, source: 'tag' });
  });

  test.each(['limited', 'automatic'])('lit=%s is uncertain (0.5 with n 10)', (value) => {
    expect(infer({ lit: value })).toEqual({ pLit: 0.5, n: 10, source: 'tag' });
  });

  test('explicit tags override lamp and density evidence', () => {
    const dark = infer({ lit: 'no' }, { lampCount30m: 5, areaLampDensityPerKm: 10, areaWayKm: 1 });
    const lit = infer({ lit: 'yes' }, { lampCount30m: 0, areaLampDensityPerKm: 10, areaWayKm: 1 });

    expect(dark.source).toBe('tag');
    expect(dark.pLit).toBe(0.05);
    expect(lit.source).toBe('tag');
    expect(lit.pLit).toBe(0.95);
  });

  test('an unrecognised lit value is ignored and inference continues', () => {
    expect(infer({ lit: 'disused', highway: 'trunk' }).source).toBe('prior');
  });
});

describe('inferLighting: tag-based priors', () => {
  test('unknown highway (absent or unlisted) gives 0.72 with n 3', () => {
    expect(infer({})).toEqual({ pLit: 0.72, n: 3, source: 'prior' });
    expect(infer({ highway: 'bus_guideway' })).toEqual({ pLit: 0.72, n: 3, source: 'prior' });
  });

  test.each(['path', 'track', 'bridleway'])('%s is low (0.12, n 3) whatever its surroundings', (highway) => {
    expect(infer({ highway })).toEqual({ pLit: 0.12, n: 3, source: 'prior' });
    expect(infer({ highway }, { nearRoad: true })).toEqual({ pLit: 0.12, n: 3, source: 'prior' });
    expect(infer({ highway }, { nearRoad: false })).toEqual({ pLit: 0.12, n: 3, source: 'prior' });
  });

  test.each(['footway', 'cycleway', 'steps', 'pedestrian'])(
    '%s beside a road is sidewalk-like: 0.72 with n 3',
    (highway) => {
      expect(infer({ highway }, { nearRoad: true })).toEqual({ pLit: 0.72, n: 3, source: 'prior' });
    },
  );

  test.each(['footway', 'cycleway', 'steps', 'pedestrian'])(
    '%s with no road nearby is isolated: 0.33 with n 3',
    (highway) => {
      expect(infer({ highway }, { nearRoad: false })).toEqual({ pLit: 0.33, n: 3, source: 'prior' });
    },
  );

  test.each(['footway', 'cycleway', 'steps', 'pedestrian'])(
    '%s whose surroundings are unknown stays neutral (0.5, n 2): neither sidewalk nor isolated is assumed',
    (highway) => {
      expect(infer({ highway })).toEqual({ pLit: 0.5, n: 2, source: 'prior' });
    },
  );

  test('a footway beside a road is lit-leaning, one far from any road is dark-leaning, and a path is darkest', () => {
    const near = infer({ highway: 'footway' }, { nearRoad: true }).pLit;
    const isolated = infer({ highway: 'footway' }, { nearRoad: false }).pLit;
    const path = infer({ highway: 'path' }).pLit;
    expect(near).toBeGreaterThan(0.5);
    expect(isolated).toBeLessThan(0.5);
    expect(near - isolated).toBeGreaterThan(0.3);
    expect(path).toBeLessThan(isolated);
  });

  test('trunk, primary and secondary roads are 0.90 with n 4', () => {
    ['trunk', 'primary', 'secondary'].forEach((highway) => {
      expect(infer({ highway })).toEqual({ pLit: 0.9, n: 4, source: 'prior' });
    });
  });

  test('tertiary is 0.90 with n 3', () => {
    expect(infer({ highway: 'tertiary' })).toEqual({ pLit: 0.9, n: 3, source: 'prior' });
  });

  test('a footway with a speed tag keeps its footway prior: the path classes are checked before speed', () => {
    expect(infer({ highway: 'footway', maxspeed: '30' }, { nearRoad: false })).toEqual({
      pLit: 0.33,
      n: 3,
      source: 'prior',
    });
  });

  test('unclassified roads take the unknown prior (0.72, n 3), or the speed prior when 30 mph applies', () => {
    expect(infer({ highway: 'unclassified' })).toEqual({ pLit: 0.72, n: 3, source: 'prior' });
    expect(infer({ highway: 'unclassified', maxspeed: '30' })).toEqual({
      pLit: 0.9,
      n: 4,
      source: 'prior',
    });
  });

  test('service is 0.62 with n 3', () => {
    expect(infer({ highway: 'service' })).toEqual({ pLit: 0.62, n: 3, source: 'prior' });
  });

  test('a 30 mph residential road is high (0.90 with n 4)', () => {
    const result = infer({ highway: 'residential', maxspeed: '30 mph' });

    expect(result).toEqual({ pLit: 0.9, n: 4, source: 'prior' });
    expect(effectiveLit(result)).toBeGreaterThan(0.6);
  });

  test('residential with a sidewalk is 0.90 with n 4', () => {
    expect(infer({ highway: 'residential', sidewalk: 'yes' })).toEqual({
      pLit: 0.9,
      n: 4,
      source: 'prior',
    });
    expect(infer({ highway: 'living_street', sidewalk: 'both' })).toEqual({
      pLit: 0.9,
      n: 4,
      source: 'prior',
    });
  });

  test('residential without sidewalk information is 0.88 with n 3', () => {
    expect(infer({ highway: 'residential' })).toEqual({ pLit: 0.88, n: 3, source: 'prior' });
  });

  test('an absent sidewalk tag is unknown, never scored below an explicit sidewalk=no', () => {
    const absent = infer({ highway: 'residential' });
    const no = infer({ highway: 'residential', sidewalk: 'no' });

    expect(absent.pLit).toBeGreaterThanOrEqual(no.pLit);
    expect(absent.pLit).toBeGreaterThan(0.5);
  });

  test('a major road is not lowered by a sidewalk value', () => {
    expect(infer({ highway: 'primary', sidewalk: 'no' })).toEqual({
      pLit: 0.9,
      n: 4,
      source: 'prior',
    });
  });

  test('priors are shrunk towards 0.5 against the observed Plymouth lit rates (within 0.05 of observed*0.9+0.05)', () => {
    const observed = {
      residential: 0.97, primary: 0.98, secondary: 0.98, tertiary: 0.98, trunk: 0.89, service: 0.68,
      unclassified: 0.77, pedestrian: 0.97,
    };
    Object.entries(observed).forEach(([highway, rate]) => {
      const { pLit } = infer({ highway }, { nearRoad: true });
      expect(pLit).toBeLessThanOrEqual(0.95);
      expect(pLit).toBeLessThanOrEqual(rate * 0.9 + 0.05 + 0.05);
    });
  });

  test('an invalid nearRoad or litNeighbour throws TypeError', () => {
    expect(() => infer({ highway: 'footway' }, { nearRoad: 'yes' })).toThrow(TypeError);
    expect(() => infer({ highway: 'footway' }, { litNeighbour: 1 })).toThrow(TypeError);
  });
});

describe('inferLighting: tag value normalisation', () => {
  test('highway is trimmed and case-insensitive', () => {
    expect(infer({ highway: ' Footway ' }, { nearRoad: false })).toEqual({ pLit: 0.33, n: 3, source: 'prior' });
    expect(infer({ highway: 'PRIMARY' })).toEqual({ pLit: 0.9, n: 4, source: 'prior' });
  });

  test('lit is trimmed and case-insensitive', () => {
    expect(infer({ lit: ' YES ' })).toEqual({ pLit: 0.95, n: 20, source: 'tag' });
    expect(infer({ lit: 'No' })).toEqual({ pLit: 0.05, n: 20, source: 'tag' });
  });

  test('sidewalk is trimmed and case-insensitive', () => {
    expect(infer({ highway: 'residential', sidewalk: ' Both ' })).toEqual({
      pLit: 0.9,
      n: 4,
      source: 'prior',
    });
  });
});

describe('inferLighting: maxspeed unit parsing', () => {
  test.each([
    ['30 mph', 0.9], // 48.3 km/h, urban
    ['30 MPH', 0.9], // unit is case-insensitive
    ['20 mph', 0.9],
    ['30', 0.9], // bare OSM number is km/h
    ['50 km/h', 0.9], // 50 km/h is at the urban limit
    ['31 mph', 0.9], // 49.9 km/h, still urban
    ['32 mph', 0.88], // 51.5 km/h, not urban
    ['40 mph', 0.88], // 64.4 km/h, not urban; falls through to residential
    ['60 km/h', 0.88],
    ['GB:urban', 0.9], // named UK urban limit, 48 km/h (30 mph)
    ['gb:urban', 0.9],
    [' GB:URBAN ', 0.9],
    ['30;60', 0.9], // a list uses its first value
    ['60;30', 0.88], // first value 60 is not urban, even though the second is
    ['0', 0.88], // zero is not a speed limit, so it must not read as urban
    ['0 mph', 0.88],
    ['-10', 0.88],
    ['signals', 0.88],
  ])('maxspeed %p on a residential road gives pLit %p', (maxspeed, pLit) => {
    expect(infer({ highway: 'residential', maxspeed }).pLit).toBe(pLit);
  });

  test('a bare number is read as km/h, not mph', () => {
    // A bare number is km/h: '40' is 40 km/h (urban), '40 mph' is 64 km/h (not urban)
    expect(infer({ highway: 'residential', maxspeed: '40' }).pLit).toBe(0.9);
    expect(infer({ highway: 'residential', maxspeed: '40 mph' }).pLit).toBe(0.88);
  });
});

describe('inferLighting: lamp evidence', () => {
  test('one lamp within 30 m raises pLit to at least 0.85 and adds 6 to n', () => {
    expect(infer({ highway: 'footway' }, { lampCount30m: 1, nearRoad: false })).toEqual({
      pLit: 0.85,
      n: 9,
      source: 'lamp',
    });
  });

  test('three or more lamps raise pLit to at least 0.92', () => {
    expect(infer({ highway: 'residential' }, { lampCount30m: 3 })).toEqual({
      pLit: 0.92,
      n: 9,
      source: 'lamp',
    });
  });

  test('two lamps within 30 m lift pLit to the one-lamp level 0.85, not the many-lamp 0.92', () => {
    expect(infer({ highway: 'footway' }, { lampCount30m: 2, nearRoad: false })).toEqual({
      pLit: 0.85,
      n: 9,
      source: 'lamp',
    });
  });

  test('pLit never rises as lamps are removed (monotone in lampCount30m)', () => {
    HIGHWAYS.forEach((highway) => {
      MAXSPEEDS.forEach((maxspeed) => {
        SIDEWALKS.forEach((sidewalk) => {
          DENSITIES.forEach((areaLampDensityPerKm) => {
            NEAR_ROADS.forEach((nearRoad) => {
              const tags = { highway, maxspeed, sidewalk };
              const pLits = LAMP_COUNTS.map((lampCount30m) => infer(tags, {
                lampCount30m,
                areaLampDensityPerKm,
                areaWayKm: 1,
                nearRoad,
              }).pLit);

              for (let i = 1; i < pLits.length; i += 1) {
                expect(pLits[i]).toBeGreaterThanOrEqual(pLits[i - 1]);
              }
            });
          });
        });
      });
    });
  });

  test('effectiveLit never rises as lamps are removed', () => {
    HIGHWAYS.forEach((highway) => {
      DENSITIES.forEach((areaLampDensityPerKm) => {
        NEAR_ROADS.forEach((nearRoad) => {
          const tags = { highway, maxspeed: '30 mph' };
          const values = LAMP_COUNTS.map((lampCount30m) => effectiveFor(tags, {
            lampCount30m,
            areaLampDensityPerKm,
            areaWayKm: 1,
            nearRoad,
          }));

          for (let i = 1; i < values.length; i += 1) {
            expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]);
          }
        });
      });
    });
  });
});

describe('inferLighting: absence of lamps (mapping completeness)', () => {
  const dense = { lampCount30m: 0, areaLampDensityPerKm: 5, areaWayKm: 1 };
  const isolatedFootway = { highway: 'footway' };

  test('lowers an isolated footway (no road within reach) in a densely mapped area', () => {
    const result = infer(isolatedFootway, { ...dense, nearRoad: false });

    expect(result.pLit).toBeCloseTo(0.33 * 0.6);
    expect(result.n).toBe(6);
    expect(result.source).toBe('absence');
  });

  test('lowers path, track and bridleway in a densely mapped area', () => {
    ['path', 'track', 'bridleway'].forEach((highway) => {
      const result = infer({ highway }, dense);
      expect(result.source).toBe('absence');
      expect(result.pLit).toBeCloseTo(0.072);
    });
  });

  test.each([
    'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'living_street', 'service', 'unclassified',
  ])('never applies to the road class %s: sparse lamp mapping means no lamp here says nothing', (highway) => {
    const result = infer({ highway }, dense);
    expect(result.source).toBe('prior');
    expect(result).toEqual(infer({ highway }, { lampCount30m: 0, areaLampDensityPerKm: 0, areaWayKm: 1 }));
  });

  test('never applies to a sidewalk-like footway beside a road', () => {
    expect(infer(isolatedFootway, { ...dense, nearRoad: true })).toEqual({ pLit: 0.72, n: 3, source: 'prior' });
  });

  test('never applies to a footway whose surroundings are unknown', () => {
    expect(infer(isolatedFootway, dense)).toEqual({ pLit: 0.5, n: 2, source: 'prior' });
  });

  test('does not apply when no lamps are mapped in the area', () => {
    expect(infer({ highway: 'path' }, { lampCount30m: 0, areaLampDensityPerKm: 0, areaWayKm: 1 }))
      .toEqual({ pLit: 0.12, n: 3, source: 'prior' });
    expect(infer({ highway: 'path' }, { lampCount30m: 0, areaLampDensityPerKm: 0.1, areaWayKm: 1 }).source)
      .toBe('prior');
  });

  test('does not apply at or below the density floor of 2 lamps per km', () => {
    expect(infer({ highway: 'path' }, { lampCount30m: 0, areaLampDensityPerKm: 2, areaWayKm: 1 }).source)
      .toBe('prior');
  });

  test('does not apply when the area has too little mapped road', () => {
    expect(infer({ highway: 'path' }, { lampCount30m: 0, areaLampDensityPerKm: 5, areaWayKm: 0.2 }).source)
      .toBe('prior');
  });

  test('the mapped-road floor is inclusive: 0.3 km triggers the absence rule, 0.29 km does not', () => {
    expect(infer({ highway: 'path' }, { ...dense, areaWayKm: 0.3 }).source).toBe('absence');
    expect(infer({ highway: 'path' }, { ...dense, areaWayKm: 0.29 }).source).toBe('prior');
  });

  test('does not apply when a lamp is nearby', () => {
    expect(infer({ highway: 'path' }, { ...dense, lampCount30m: 1 }).source).toBe('lamp');
  });

  test('does not apply when a lit=yes neighbour is nearby (that is separate, weaker evidence)', () => {
    expect(infer({ highway: 'path' }, { ...dense, litNeighbour: true }).source).toBe('neighbour-lit');
  });
});

describe('inferLighting: neighbouring lit=yes vertices (not lamps)', () => {
  test('raise pLit to at least 0.85 with n + 3 and source neighbour-lit', () => {
    expect(infer({ highway: 'service' }, { litNeighbour: true })).toEqual({
      pLit: 0.85,
      n: 6,
      source: 'neighbour-lit',
    });
  });

  test('never lower a prior that is already higher', () => {
    expect(infer({ highway: 'primary' }, { litNeighbour: true })).toEqual({
      pLit: 0.9,
      n: 7,
      source: 'neighbour-lit',
    });
  });

  test('are weaker evidence than a real lamp: same pLit floor, less n', () => {
    const neighbour = infer({ highway: 'service' }, { litNeighbour: true });
    const lamp = infer({ highway: 'service' }, { lampCount30m: 1 });
    expect(lamp.n).toBeGreaterThan(neighbour.n);
    expect(effectiveLit(lamp)).toBeGreaterThan(effectiveLit(neighbour));
    expect(effectiveLit(neighbour)).toBeGreaterThan(effectiveLit(infer({ highway: 'service' })));
  });

  test('a real lamp takes precedence over a lit neighbour', () => {
    expect(infer({ highway: 'service' }, { lampCount30m: 1, litNeighbour: true }).source).toBe('lamp');
  });

  test('do not count as a lamp: lampCount30m stays the only lamp input', () => {
    expect(infer({ highway: 'service' }, { litNeighbour: true }).source).not.toBe('lamp');
  });
});

describe('ordering: lit=no <= any inferred case <= lit=yes', () => {
  test('holds for every non-tag combination in the grid', () => {
    const litNo = effectiveFor({ lit: 'no' });
    const litYes = effectiveFor({ lit: 'yes' });

    HIGHWAYS.forEach((highway) => {
      MAXSPEEDS.forEach((maxspeed) => {
        SIDEWALKS.forEach((sidewalk) => {
          NEAR_ROADS.forEach((nearRoad) => {
            [false, true].forEach((litNeighbour) => {
              LAMP_COUNTS.forEach((lampCount30m) => {
                DENSITIES.forEach((areaLampDensityPerKm) => {
                  AREA_WAY_KMS.forEach((areaWayKm) => {
                    const inferred = effectiveFor(
                      { highway, maxspeed, sidewalk },
                      { lampCount30m, areaLampDensityPerKm, areaWayKm, nearRoad, litNeighbour },
                    );

                    expect(inferred).toBeGreaterThanOrEqual(litNo);
                    expect(inferred).toBeLessThanOrEqual(litYes);
                  });
                });
              });
            });
          });
        });
      });
    });
  });

  test('effectiveLit never falls as a lit neighbour appears, with or without lamps', () => {
    HIGHWAYS.forEach((highway) => {
      NEAR_ROADS.forEach((nearRoad) => {
        [0, 1, 3].forEach((lampCount30m) => {
          const tags = { highway, maxspeed: '30 mph' };
          const without = effectiveFor(tags, { lampCount30m, nearRoad, litNeighbour: false, areaLampDensityPerKm: 5 });
          const withNeighbour = effectiveFor(tags, { lampCount30m, nearRoad, litNeighbour: true, areaLampDensityPerKm: 5 });
          expect(withNeighbour).toBeGreaterThanOrEqual(without);
        });
      });
    });
  });
});

describe('effectiveLit', () => {
  test('is 0.5 with no evidence', () => {
    expect(effectiveLit({ pLit: 0.95, n: 0 })).toBe(0.5);
  });

  test('shrinks strong explicit evidence towards 0.5 by the lighting pseudo-count (1)', () => {
    expect(effectiveLit({ pLit: 0.95, n: 20 })).toBeCloseTo((0.95 * 20 + 0.5) / 21, 12);
    expect(effectiveLit({ pLit: 0.05, n: 20 })).toBeCloseTo((0.05 * 20 + 0.5) / 21, 12);
  });

  test('shrinks less than the certainty pseudo-count does: the priors are already shrunk towards 0.5', () => {
    // With n = 4, the certainty formula would give weight 0.5 to the estimate; the lighting shrink gives 0.8.
    expect(lightingCertainty({ n: 4 })).toBe(0.5);
    expect(effectiveLit({ pLit: 0.9, n: 4 })).toBeCloseTo(0.5 + 0.4 * 0.8, 12);
  });

  test('moves towards pLit as evidence grows and stays within [0, 1]', () => {
    const weak = effectiveLit({ pLit: 0.9, n: 1 });
    const strong = effectiveLit({ pLit: 0.9, n: 50 });

    expect(strong).toBeGreaterThan(weak);
    expect(strong).toBeLessThanOrEqual(1);
    expect(weak).toBeGreaterThanOrEqual(0);
  });

  test.each([
    [{ pLit: 1.2, n: 2 }],
    [{ pLit: -0.1, n: 2 }],
    [{ pLit: NaN, n: 2 }],
    [{ pLit: 0.5, n: -1 }],
    [{ pLit: 0.5 }],
  ])('throws TypeError for invalid input %p', (input) => {
    expect(() => effectiveLit(input)).toThrow(TypeError);
  });
});

describe('lightingCertainty', () => {
  test('is 0 with no evidence and 0.5 at n = n0 = 4', () => {
    expect(lightingCertainty({ n: 0 })).toBe(0);
    expect(lightingCertainty({ n: 4 })).toBe(0.5);
  });

  test('rises with evidence and stays below 1', () => {
    expect(lightingCertainty({ n: 20 })).toBeGreaterThan(lightingCertainty({ n: 4 }));
    expect(lightingCertainty({ n: 1000 })).toBeLessThan(1);
  });

  test('throws TypeError for negative or non-numeric n', () => {
    expect(() => lightingCertainty({ n: -1 })).toThrow(TypeError);
    expect(() => lightingCertainty({ n: '4' })).toThrow(TypeError);
  });
});

describe('inferLighting: purity and input validation', () => {
  test('does not mutate its input and returns the same result for the same input', () => {
    const input = deepFreeze({
      tags: { highway: 'residential', maxspeed: '30 mph', sidewalk: 'yes' },
      lampCount30m: 2,
      areaLampDensityPerKm: 5,
      areaWayKm: 1,
    });
    const snapshot = JSON.parse(JSON.stringify(input));

    const first = inferLighting(input);
    const second = inferLighting(input);

    expect(first).toEqual(second);
    expect(input).toEqual(snapshot);
  });

  test('throws TypeError when tags is missing, null or an array', () => {
    const args = { lampCount30m: 0, areaLampDensityPerKm: 0, areaWayKm: 1 };

    expect(() => inferLighting({ ...args })).toThrow(TypeError);
    expect(() => inferLighting({ ...args, tags: null })).toThrow(TypeError);
    expect(() => inferLighting({ ...args, tags: [] })).toThrow(TypeError);
  });

  test('throws TypeError when a relevant tag value is not a string', () => {
    expect(() => infer({ highway: 5 })).toThrow(TypeError);
    expect(() => infer({ lit: true })).toThrow(TypeError);
    expect(() => infer({ maxspeed: 30 })).toThrow(TypeError);
  });

  test.each([
    ['lampCount30m', -1],
    ['lampCount30m', 1.5],
    ['lampCount30m', '3'],
    ['areaLampDensityPerKm', NaN],
    ['areaLampDensityPerKm', -2],
    ['areaWayKm', undefined],
    ['areaWayKm', Infinity],
  ])('throws TypeError for invalid %s = %p', (field, value) => {
    expect(() => infer({ highway: 'residential' }, { [field]: value })).toThrow(TypeError);
  });
});

describe('crossing structure (footway-like way over a motorway/trunk)', () => {
  test.each(['footway', 'cycleway', 'steps', 'pedestrian'])('a crossing %s takes the 0.30/n3 prior, not the sidewalk prior', (highway) => {
    expect(infer({ highway }, { crossing: true, nearRoad: true })).toEqual({ pLit: 0.3, n: 3, source: 'prior' });
  });

  test('a crossing structure with no lamps in a densely mapped area takes the absence rule like any isolated path', () => {
    const result = infer({ highway: 'footway' }, { crossing: true, areaLampDensityPerKm: 5, areaWayKm: 1 });
    expect(result.source).toBe('absence');
    expect(result.pLit).toBeCloseTo(0.3 * 0.6, 9);
  });

  test('an explicit lit tag and nearby lamps still win over the crossing prior', () => {
    expect(infer({ highway: 'footway', lit: 'yes' }, { crossing: true }).pLit).toBe(0.95);
    expect(infer({ highway: 'footway' }, { crossing: true, lampCount30m: 3 }).pLit).toBe(0.92);
  });

  test('crossing is ignored for road classes and path classes keep their own prior', () => {
    expect(infer({ highway: 'residential' }, { crossing: true }).pLit).toBe(0.88);
    expect(infer({ highway: 'path' }, { crossing: true }).pLit).toBe(0.12);
  });

  test('a non-boolean crossing throws TypeError', () => {
    expect(() => infer({ highway: 'footway' }, { crossing: 'yes' })).toThrow(TypeError);
  });
});


describe('weak lit tag (spec section 12)', () => {
  const lit = { highway: 'footway', lit: 'yes' };
  const input = { tags: lit, lampCount30m: 0, areaLampDensityPerKm: 5, areaWayKm: 2, nearRoad: false };

  test('weakLitTag turns a lit=yes tag into 0.7 / n 6 evidence', () => {
    expect(inferLighting({ ...input, crossing: true, weakLitTag: true })).toEqual({ pLit: 0.7, n: 6, source: 'weak-tag' });
  });

  test('without the flag lit=yes is unchanged (0.95 / n 20)', () => {
    expect(inferLighting({ ...input, crossing: true })).toEqual({ pLit: 0.95, n: 20, source: 'tag' });
  });

  test('the flag changes nothing for other lit tags', () => {
    expect(inferLighting({ ...input, tags: { highway: 'footway', lit: 'no' }, weakLitTag: true }).pLit).toBe(0.05);
    expect(inferLighting({ ...input, tags: { highway: 'footway', lit: 'limited' }, weakLitTag: true }).pLit).toBe(0.5);
    expect(inferLighting({ ...input, tags: { highway: 'footway' }, weakLitTag: true }).source).not.toBe('weak-tag');
  });

  test('a mapped lamp within reach restores the strong tag (the flag is for lamp-less ways only)', () => {
    expect(inferLighting({ ...input, lampCount30m: 2, weakLitTag: true })).toEqual({ pLit: 0.95, n: 20, source: 'tag' });
  });

  test('rejects a non-boolean flag', () => {
    expect(() => inferLighting({ ...input, weakLitTag: 'yes' })).toThrow(TypeError);
  });
});

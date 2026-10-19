const {
  inferLighting,
  effectiveLit,
  lightingCertainty,
} = require('../../../../src/safety/scoring/lightingInference');

const HIGHWAYS = [
  undefined, 'trunk', 'primary', 'secondary', 'tertiary', 'residential',
  'living_street', 'service', 'unclassified', 'footway', 'path', 'track',
  'steps', 'bridleway', 'cycleway', 'bus_guideway',
];
const MAXSPEEDS = [undefined, '30 mph', '20 mph', '40 mph', '30', '50 km/h', 'GB:urban'];
const SIDEWALKS = [undefined, 'yes', 'no', 'both'];
const LAMP_COUNTS = [0, 1, 2, 3, 7];
const DENSITIES = [0, 0.1, 2, 5];
const AREA_WAY_KMS = [0, 0.2, 1];

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
  test('unknown highway (absent or unlisted) gives 0.40 with n 2', () => {
    expect(infer({})).toEqual({ pLit: 0.4, n: 2, source: 'prior' });
    expect(infer({ highway: 'bus_guideway' })).toEqual({ pLit: 0.4, n: 2, source: 'prior' });
  });

  test('a footpath far from lamps in a dense area is low', () => {
    const footway = infer(
      { highway: 'footway' },
      { lampCount30m: 0, areaLampDensityPerKm: 5, areaWayKm: 1 },
    );

    expect(footway.pLit).toBeCloseTo(0.09);
    expect(effectiveLit(footway)).toBeLessThan(0.3);
  });

  test.each(['path', 'track', 'bridleway', 'footway', 'cycleway', 'steps'])(
    '%s without lamps or density evidence is 0.15 with n 3',
    (highway) => {
      expect(infer({ highway })).toEqual({ pLit: 0.15, n: 3, source: 'prior' });
    },
  );

  test('trunk, primary and secondary roads are 0.85 with n 4', () => {
    ['trunk', 'primary', 'secondary'].forEach((highway) => {
      expect(infer({ highway })).toEqual({ pLit: 0.85, n: 4, source: 'prior' });
    });
  });

  test('tertiary is 0.70 with n 3', () => {
    expect(infer({ highway: 'tertiary' })).toEqual({ pLit: 0.7, n: 3, source: 'prior' });
  });

  test('a footway with a speed tag stays 0.15: the path class is checked before speed', () => {
    expect(infer({ highway: 'footway', maxspeed: '30' })).toEqual({
      pLit: 0.15,
      n: 3,
      source: 'prior',
    });
  });

  test('unclassified roads take the explicit unknown prior (0.40, n 2), or the speed prior when 30 mph applies', () => {
    expect(infer({ highway: 'unclassified' })).toEqual({ pLit: 0.4, n: 2, source: 'prior' });
    expect(infer({ highway: 'unclassified', maxspeed: '30' })).toEqual({
      pLit: 0.8,
      n: 4,
      source: 'prior',
    });
  });

  test('service is 0.40 with n 2', () => {
    expect(infer({ highway: 'service' })).toEqual({ pLit: 0.4, n: 2, source: 'prior' });
  });

  test('a 30 mph residential road is high (0.80 with n 4)', () => {
    const result = infer({ highway: 'residential', maxspeed: '30 mph' });

    expect(result).toEqual({ pLit: 0.8, n: 4, source: 'prior' });
    expect(effectiveLit(result)).toBeGreaterThan(0.6);
  });

  test('residential with a sidewalk is 0.80 with n 4', () => {
    expect(infer({ highway: 'residential', sidewalk: 'yes' })).toEqual({
      pLit: 0.8,
      n: 4,
      source: 'prior',
    });
    expect(infer({ highway: 'living_street', sidewalk: 'both' })).toEqual({
      pLit: 0.8,
      n: 4,
      source: 'prior',
    });
  });

  test('residential without sidewalk information is 0.70 with n 3', () => {
    expect(infer({ highway: 'residential' })).toEqual({ pLit: 0.7, n: 3, source: 'prior' });
  });

  test('an absent sidewalk tag is unknown, never scored below an explicit sidewalk=no', () => {
    const absent = infer({ highway: 'residential' });
    const no = infer({ highway: 'residential', sidewalk: 'no' });

    expect(absent.pLit).toBeGreaterThanOrEqual(no.pLit);
    expect(absent.pLit).toBeGreaterThan(0.5);
  });

  test('a major road is not lowered by a sidewalk value', () => {
    expect(infer({ highway: 'primary', sidewalk: 'no' })).toEqual({
      pLit: 0.85,
      n: 4,
      source: 'prior',
    });
  });
});

describe('inferLighting: tag value normalisation', () => {
  test('highway is trimmed and case-insensitive', () => {
    expect(infer({ highway: ' Footway ' })).toEqual({ pLit: 0.15, n: 3, source: 'prior' });
    expect(infer({ highway: 'PRIMARY' })).toEqual({ pLit: 0.85, n: 4, source: 'prior' });
  });

  test('lit is trimmed and case-insensitive', () => {
    expect(infer({ lit: ' YES ' })).toEqual({ pLit: 0.95, n: 20, source: 'tag' });
    expect(infer({ lit: 'No' })).toEqual({ pLit: 0.05, n: 20, source: 'tag' });
  });

  test('sidewalk is trimmed and case-insensitive', () => {
    expect(infer({ highway: 'residential', sidewalk: ' Both ' })).toEqual({
      pLit: 0.8,
      n: 4,
      source: 'prior',
    });
  });
});

describe('inferLighting: maxspeed unit parsing', () => {
  test.each([
    ['30 mph', 0.8], // 48.3 km/h, urban
    ['30 MPH', 0.8], // unit is case-insensitive
    ['20 mph', 0.8],
    ['30', 0.8], // bare OSM number is km/h
    ['50 km/h', 0.8], // 50 km/h is at the urban limit
    ['31 mph', 0.8], // 49.9 km/h, still urban
    ['32 mph', 0.7], // 51.5 km/h, not urban
    ['40 mph', 0.7], // 64.4 km/h, not urban; falls through to residential
    ['60 km/h', 0.7],
    ['GB:urban', 0.8], // named UK urban limit, 48 km/h (30 mph)
    ['gb:urban', 0.8],
    [' GB:URBAN ', 0.8],
    ['30;60', 0.8], // a list uses its first value
    ['60;30', 0.7], // first value 60 is not urban, even though the second is
    ['0', 0.7], // zero is not a speed limit, so it must not read as urban
    ['0 mph', 0.7],
    ['-10', 0.7],
    ['signals', 0.7],
  ])('maxspeed %p on a residential road gives pLit %p', (maxspeed, pLit) => {
    expect(infer({ highway: 'residential', maxspeed }).pLit).toBe(pLit);
  });

  test('a bare number is read as km/h, not mph', () => {
    // A bare number is km/h: '40' is 40 km/h (urban), '40 mph' is 64 km/h (not urban)
    expect(infer({ highway: 'residential', maxspeed: '40' }).pLit).toBe(0.8);
    expect(infer({ highway: 'residential', maxspeed: '40 mph' }).pLit).toBe(0.7);
  });
});

describe('inferLighting: lamp evidence', () => {
  test('one lamp within 30 m raises pLit to at least 0.85 and adds 6 to n', () => {
    expect(infer({ highway: 'footway' }, { lampCount30m: 1 })).toEqual({
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
    expect(infer({ highway: 'footway' }, { lampCount30m: 2 })).toEqual({
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
            const tags = { highway, maxspeed, sidewalk };
            const pLits = LAMP_COUNTS.map((lampCount30m) => infer(tags, {
              lampCount30m,
              areaLampDensityPerKm,
              areaWayKm: 1,
            }).pLit);

            for (let i = 1; i < pLits.length; i += 1) {
              expect(pLits[i]).toBeGreaterThanOrEqual(pLits[i - 1]);
            }
          });
        });
      });
    });
  });

  test('effectiveLit never rises as lamps are removed', () => {
    HIGHWAYS.forEach((highway) => {
      DENSITIES.forEach((areaLampDensityPerKm) => {
        const tags = { highway, maxspeed: '30 mph' };
        const values = LAMP_COUNTS.map((lampCount30m) => effectiveFor(tags, {
          lampCount30m,
          areaLampDensityPerKm,
          areaWayKm: 1,
        }));

        for (let i = 1; i < values.length; i += 1) {
          expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]);
        }
      });
    });
  });
});

describe('inferLighting: absence of lamps (mapping completeness)', () => {
  const residentialNoSidewalk = { highway: 'residential' };

  test('applies when the area is densely mapped and no lamp is nearby', () => {
    const result = infer(residentialNoSidewalk, {
      lampCount30m: 0,
      areaLampDensityPerKm: 5,
      areaWayKm: 1,
    });

    expect(result.pLit).toBeCloseTo(0.42);
    expect(result.n).toBe(6);
    expect(result.source).toBe('absence');
  });

  test('does not apply when no lamps are mapped in the area', () => {
    expect(infer(residentialNoSidewalk, {
      lampCount30m: 0,
      areaLampDensityPerKm: 0,
      areaWayKm: 1,
    })).toEqual({ pLit: 0.7, n: 3, source: 'prior' });
    expect(infer(residentialNoSidewalk, {
      lampCount30m: 0,
      areaLampDensityPerKm: 0.1,
      areaWayKm: 1,
    }).source).toBe('prior');
  });

  test('does not apply at or below the density floor of 2 lamps per km', () => {
    expect(infer(residentialNoSidewalk, {
      lampCount30m: 0,
      areaLampDensityPerKm: 2,
      areaWayKm: 1,
    }).source).toBe('prior');
  });

  test('does not apply when the area has too little mapped road', () => {
    expect(infer(residentialNoSidewalk, {
      lampCount30m: 0,
      areaLampDensityPerKm: 5,
      areaWayKm: 0.2,
    }).source).toBe('prior');
  });

  test('does not apply when a lamp is nearby', () => {
    expect(infer(residentialNoSidewalk, {
      lampCount30m: 1,
      areaLampDensityPerKm: 5,
      areaWayKm: 1,
    }).source).toBe('lamp');
  });
});

describe('ordering: lit=no <= any inferred case <= lit=yes', () => {
  test('holds for every non-tag combination in the grid', () => {
    const litNo = effectiveFor({ lit: 'no' });
    const litYes = effectiveFor({ lit: 'yes' });

    HIGHWAYS.forEach((highway) => {
      MAXSPEEDS.forEach((maxspeed) => {
        SIDEWALKS.forEach((sidewalk) => {
          LAMP_COUNTS.forEach((lampCount30m) => {
            DENSITIES.forEach((areaLampDensityPerKm) => {
              AREA_WAY_KMS.forEach((areaWayKm) => {
                const inferred = effectiveFor(
                  { highway, maxspeed, sidewalk },
                  { lampCount30m, areaLampDensityPerKm, areaWayKm },
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

describe('effectiveLit', () => {
  test('is 0.5 with no evidence', () => {
    expect(effectiveLit({ pLit: 0.95, n: 0 })).toBe(0.5);
  });

  test('shrinks strong explicit evidence towards 0.5 by n0 = 4', () => {
    expect(effectiveLit({ pLit: 0.95, n: 20 })).toBeCloseTo(0.875);
    expect(effectiveLit({ pLit: 0.05, n: 20 })).toBeCloseTo(0.125);
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

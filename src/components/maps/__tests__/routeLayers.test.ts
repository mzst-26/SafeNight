import {
  DEFAULT_CRIME_SEVERITY,
  RISK_RAMP,
  RISK_STEPS,
  UNKNOWN_RISK_COLOR,
  buildRouteLayers,
  riskBucket,
  riskToColor,
  type GeoPoint,
  type LayerSegment,
  type RouteLayerInput,
  type RouteLayerOptions,
} from '@/src/components/maps/routeLayers';

// ── Test helpers ─────────────────────────────────────────────────────────────

const BASE_LAT = 51.5;
const BASE_LNG = -0.1;
const STEP = 0.0001; // ~11 m per segment

/** Builds a chained route: segment i ends where segment i+1 starts. */
function chain(overrides: Array<Partial<LayerSegment>>): LayerSegment[] {
  return overrides.map((o, i) => ({
    start: { lat: BASE_LAT + i * STEP, lng: BASE_LNG },
    end: { lat: BASE_LAT + (i + 1) * STEP, lng: BASE_LNG },
    risk: 0.1,
    ...o,
  }));
}

const opts = (over: Partial<RouteLayerOptions> = {}): RouteLayerOptions => ({
  zoom: 15,
  ...over,
});

/** Longitude (degrees) that sits `metres` east of lng 0 at latitude `lat`. */
const lngForMetres = (metres: number, lat: number): number =>
  metres / (111320 * Math.cos((lat * Math.PI) / 180));

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value as object).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

// Colour-vision helpers (test-only): sRGB -> linear -> CIE Lab, plus the
// Machado et al. (2009) deuteranopia matrix at severity 1.0 applied in linear RGB.
const srgbToLinear = (c: number): number => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};

const hexToLinear = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(srgbToLinear) as [number, number, number];
};

const DEUTERANOPIA = [
  [0.367322, 0.860646, -0.227968],
  [0.280085, 0.672501, 0.047413],
  [-0.01182, 0.04294, 0.968881],
];

const simulateDeuteranopia = ([r, g, b]: [number, number, number]): [number, number, number] =>
  DEUTERANOPIA.map((row) => {
    const v = row[0] * r + row[1] * g + row[2] * b;
    return Math.min(1, Math.max(0, v));
  }) as [number, number, number];

const linearToLab = ([r, g, b]: [number, number, number]): [number, number, number] => {
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
};

const deltaE76 = (a: [number, number, number], b: [number, number, number]) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

const relativeLuminance = (hex: string) => {
  const [r, g, b] = hexToLinear(hex);
  return 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
};

// Minimum CIELAB distance (dE76) between adjacent ramp steps, judged under
// deuteranopia simulation. ~10 is well above the ~2.3 just-noticeable
// difference and keeps neighbouring risk bands separable without relying on hue.
const MIN_ADJACENT_DELTA_E = 10;

// ── Public types ─────────────────────────────────────────────────────────────

describe('public types', () => {
  it('exports GeoPoint as the {lat, lng} shape used by every coordinate field', () => {
    const point: GeoPoint = { lat: 51.5, lng: BASE_LNG };
    const out = buildRouteLayers({ lights: [point] }, opts({ zoom: 18 }));
    expect(out.points).toEqual([{ kind: 'light', lat: 51.5, lng: BASE_LNG }]);
  });
});

// ── Colour ramp ──────────────────────────────────────────────────────────────

describe('risk colour ramp', () => {
  it('exports six valid hex colours, one per discrete step', () => {
    expect(RISK_STEPS).toBe(6);
    expect(RISK_RAMP).toHaveLength(6);
    RISK_RAMP.forEach((hex) => expect(hex).toMatch(/^#[0-9A-Fa-f]{6}$/));
  });

  it('is frozen so consumers cannot mutate the shared palette', () => {
    expect(Object.isFrozen(RISK_RAMP)).toBe(true);
  });

  it('is strictly darker as risk increases (luminance monotone)', () => {
    const luminances = RISK_RAMP.map(relativeLuminance);
    for (let i = 1; i < luminances.length; i += 1) {
      expect(luminances[i]).toBeLessThan(luminances[i - 1]);
    }
  });

  it('runs from cool teal (low risk) to warm dark orange-brown (high risk)', () => {
    const toRgb = (hex: string) => {
      const n = parseInt(hex.slice(1), 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    };
    const [lr, lg, lb] = toRgb(RISK_RAMP[0]);
    const [hr, , hb] = toRgb(RISK_RAMP[RISK_STEPS - 1]);
    expect(lg).toBeGreaterThan(lr); // low risk: green/blue dominant
    expect(lb).toBeGreaterThan(lr);
    expect(hr).toBeGreaterThan(hb); // high risk: red/orange dominant
  });

  it('keeps adjacent steps distinguishable under normal vision', () => {
    const labs = RISK_RAMP.map((hex) => linearToLab(hexToLinear(hex)));
    for (let i = 1; i < labs.length; i += 1) {
      expect(deltaE76(labs[i], labs[i - 1])).toBeGreaterThanOrEqual(MIN_ADJACENT_DELTA_E);
    }
  });

  it('keeps adjacent steps distinguishable under deuteranopia simulation', () => {
    const labs = RISK_RAMP.map((hex) => linearToLab(simulateDeuteranopia(hexToLinear(hex))));
    for (let i = 1; i < labs.length; i += 1) {
      expect(deltaE76(labs[i], labs[i - 1])).toBeGreaterThanOrEqual(MIN_ADJACENT_DELTA_E);
    }
  });

  it('maps risk to discrete steps: 0 is the lowest colour, 1 the highest', () => {
    expect(riskToColor(0)).toBe(RISK_RAMP[0]);
    expect(riskToColor(1)).toBe(RISK_RAMP[RISK_STEPS - 1]);
    expect(riskToColor(0.5)).toBe(RISK_RAMP[3]);
  });

  it('holds one colour across each sixth of the risk range', () => {
    expect(riskToColor(0)).toBe(riskToColor(0.16));
    expect(riskToColor(0.16)).not.toBe(riskToColor(0.17));
  });

  it('clamps out-of-range risk and returns the unknown colour for non-finite risk', () => {
    expect(riskToColor(-3)).toBe(RISK_RAMP[0]);
    expect(riskToColor(7)).toBe(RISK_RAMP[RISK_STEPS - 1]);
    expect(riskToColor(Number.NaN)).toBe(UNKNOWN_RISK_COLOR);
    expect(riskToColor(Number.POSITIVE_INFINITY)).toBe(UNKNOWN_RISK_COLOR);
  });
});

describe('riskBucket', () => {
  it('returns the ramp index for finite risk, clamped to both ends', () => {
    expect(riskBucket(0)).toBe(0);
    expect(riskBucket(0.5)).toBe(3);
    expect(riskBucket(1)).toBe(RISK_STEPS - 1);
    expect(riskBucket(-2)).toBe(0);
    expect(riskBucket(9)).toBe(RISK_STEPS - 1);
  });

  it('throws a TypeError for non-finite risk instead of returning an out-of-range index', () => {
    expect(() => riskBucket(Number.NaN)).toThrow(TypeError);
    expect(() => riskBucket(Number.POSITIVE_INFINITY)).toThrow(TypeError);
    expect(() => riskBucket(Number.NEGATIVE_INFINITY)).toThrow(TypeError);
  });
});

// ── Line merging, dashing and risk input ────────────────────────────────────

describe('buildRouteLayers lines', () => {
  it('merges 240 same-bucket segments into a single polyline', () => {
    const segments = chain(Array.from({ length: 240 }, () => ({ risk: 0.1 })));
    const out = buildRouteLayers({ segments }, opts());

    expect(out.lines).toHaveLength(1);
    expect(out.lines[0].coords).toHaveLength(241);
    expect(out.lines[0].coords[0]).toEqual([BASE_LAT, BASE_LNG]);
  });

  it('splits lines only where the colour bucket changes, sharing boundary points', () => {
    const segments = chain([
      { risk: 0.1 },
      { risk: 0.1 },
      { risk: 0.1 },
      { risk: 0.9 },
      { risk: 0.9 },
      { risk: 0.1 },
      { risk: 0.1 },
    ]);
    const out = buildRouteLayers({ segments }, opts());

    expect(out.lines.map((l) => l.coords.length)).toEqual([4, 3, 3]);
    expect(out.lines.map((l) => l.color)).toEqual([
      riskToColor(0.1),
      riskToColor(0.9),
      riskToColor(0.1),
    ]);
    expect(out.lines[1].coords[0]).toEqual(out.lines[0].coords[3]);
  });

  it('splits a run when the dashed flag changes even if the colour is the same', () => {
    const segments = chain([
      { litEstimate: 'lit' },
      { litEstimate: 'estimated_unlit' },
      { litEstimate: 'lit' },
      { litEstimate: 'lit' },
    ]);
    const out = buildRouteLayers({ segments }, opts());

    expect(out.lines).toHaveLength(3);
    expect(out.lines.map((l) => l.dashed)).toEqual([false, true, false]);
  });

  it('does not connect segments across a gap in the route', () => {
    const segments = chain(Array.from({ length: 6 }, () => ({ risk: 0.1 })));
    // Break the chain between segment 2 and 3 only; 3..5 stay contiguous.
    segments[3] = { ...segments[3], start: { lat: 52, lng: 0 } };
    const out = buildRouteLayers({ segments }, opts());

    expect(out.lines).toHaveLength(2);
    expect(out.lines[1].coords[0]).toEqual([52, 0]);
  });

  it('dashes lines for estimated lighting or certainty below 0.4', () => {
    const cases: Array<[Partial<LayerSegment>, boolean]> = [
      [{ litEstimate: 'estimated_lit' }, true],
      [{ litEstimate: 'estimated_unlit' }, true],
      [{ litEstimate: 'lit' }, false],
      [{ litEstimate: 'unlit' }, false],
      [{ certainty: 0.3 }, true],
      [{ certainty: 0.4 }, false],
      [{}, false],
    ];
    cases.forEach(([extra, expected]) => {
      const out = buildRouteLayers({ segments: chain([extra]) }, opts());
      expect(out.lines[0].dashed).toBe(expected);
    });
  });

  it('dashes only the exact estimated lighting values, not any string that merely starts with "estimated"', () => {
    const cases: Array<[string, boolean]> = [
      ['estimated', false],
      ['estimated_lit_v2', false],
      ['estimated_lit', true],
      ['estimated_unlit', true],
    ];
    cases.forEach(([litEstimate, expected]) => {
      const segments = chain([{ litEstimate: litEstimate as LayerSegment['litEstimate'] }]);
      expect(buildRouteLayers({ segments }, opts()).lines[0].dashed).toBe(expected);
    });
  });

  it('colours each line from its risk and reports the mean risk of its members', () => {
    // Both members fall in the same sixth (bucket 1), so they merge.
    const segments = chain([{ risk: 0.22 }, { risk: 0.28 }]);
    const out = buildRouteLayers({ segments }, opts());

    expect(out.lines).toHaveLength(1);
    expect(out.lines[0].risk).toBeCloseTo(0.25);
    expect(out.lines[0].color).toBe(riskToColor(0.25));
  });

  it('uses 1 - safetyScore when risk is missing, and prefers risk when both exist', () => {
    const fallback = buildRouteLayers(
      { segments: chain([{ risk: undefined, safetyScore: 0.2 }]) },
      opts(),
    );
    expect(fallback.lines[0].risk).toBeCloseTo(0.8);
    expect(fallback.lines[0].color).toBe(riskToColor(0.8));

    const preferred = buildRouteLayers(
      { segments: chain([{ risk: 0.1, safetyScore: 0.2 }]) },
      opts(),
    );
    expect(preferred.lines[0].risk).toBeCloseTo(0.1);
  });

  it('omits segments with neither risk nor safetyScore rather than inventing a colour', () => {
    const segments = chain([{ risk: undefined }, { risk: 0.5 }]);
    const out = buildRouteLayers({ segments }, opts());

    expect(out.lines).toHaveLength(1);
    expect(out.lines[0].risk).toBeCloseTo(0.5);
  });

  it('clamps risk to 0..1', () => {
    const out = buildRouteLayers({ segments: chain([{ risk: 3 }]) }, opts());
    expect(out.lines[0].risk).toBe(1);
    expect(out.lines[0].color).toBe(RISK_RAMP[RISK_STEPS - 1]);
  });

  it('skips segments with invalid coordinates', () => {
    const segments = chain([{ risk: 0.1 }, { risk: 0.1 }]);
    segments.push({
      start: { lat: Number.NaN, lng: BASE_LNG },
      end: { lat: 91, lng: BASE_LNG },
      risk: 0.1,
    });
    const out = buildRouteLayers({ segments }, opts());

    expect(out.lines).toHaveLength(1);
    expect(out.lines[0].coords).toHaveLength(3);
  });

  it('skips a segment whose end is invalid even when its start is valid', () => {
    const segments = chain([{ risk: 0.1 }]);
    segments.push({
      start: { lat: BASE_LAT + STEP, lng: BASE_LNG },
      end: { lat: Number.NaN, lng: BASE_LNG },
      risk: 0.1,
    });
    const out = buildRouteLayers({ segments }, opts());

    expect(out.lines).toHaveLength(1);
    expect(out.lines[0].coords).toHaveLength(2);
  });

  it('treats a non-array segments value as no segments', () => {
    expect(buildRouteLayers({ segments: 'nope' as never }, opts()).lines).toEqual([]);
  });
});

// ── Worst-stretch callout ───────────────────────────────────────────────────

describe('buildRouteLayers worst-stretch callout', () => {
  const stretch = (over: Record<string, unknown> = {}) => ({
    start: { lat: 51.5, lng: -0.1 },
    end: { lat: 51.502, lng: -0.1 },
    lengthM: 240,
    cause: 'lighting',
    ...over,
  });

  const textFor = (lengthM: number) =>
    buildRouteLayers({ worstStretch: stretch({ lengthM }) as never }, opts()).callouts[0].text;

  it('places one callout at the midpoint with unlit wording for a lighting cause', () => {
    const out = buildRouteLayers({ worstStretch: stretch() as never }, opts());

    expect(out.callouts).toHaveLength(1);
    expect(out.callouts[0].lat).toBeCloseTo(51.501, 6);
    expect(out.callouts[0].lng).toBeCloseTo(-0.1, 6);
    expect(out.callouts[0].text).toBe('Unlit stretch · 240 m');
    expect(out.callouts[0].kind).toBe('worst-stretch');
  });

  it('places the callout at the true midpoint of a stretch that is off-axis in both lat and lng', () => {
    const out = buildRouteLayers(
      {
        worstStretch: {
          start: { lat: 51.5, lng: -0.1 },
          end: { lat: 51.502, lng: -0.104 },
          lengthM: 240,
          cause: 'lighting',
        },
      },
      opts(),
    );

    expect(out.callouts[0].lat).toBeCloseTo(51.501, 6);
    expect(out.callouts[0].lng).toBeCloseTo(-0.102, 6);
  });

  it('uses high-risk wording for any other cause', () => {
    const out = buildRouteLayers({ worstStretch: stretch({ cause: 'crime' }) as never }, opts());
    expect(out.callouts[0].text).toBe('High-risk stretch · 240 m');
  });

  it('rounds the callout length to the nearest metre', () => {
    expect(textFor(240.4)).toBe('Unlit stretch · 240 m');
    expect(textFor(240.6)).toBe('Unlit stretch · 241 m');
  });

  it('only shows the callout when the stretch is at least 50 m', () => {
    expect(buildRouteLayers({ worstStretch: stretch({ lengthM: 49.9 }) as never }, opts()).callouts).toEqual([]);
    expect(buildRouteLayers({ worstStretch: stretch({ lengthM: 50 }) as never }, opts()).callouts).toHaveLength(1);
  });

  it('emits no callout when the stretch is missing, has bad numbers or bad coordinates', () => {
    expect(buildRouteLayers({}, opts()).callouts).toEqual([]);
    expect(buildRouteLayers({ worstStretch: null }, opts()).callouts).toEqual([]);
    expect(buildRouteLayers({ worstStretch: stretch({ lengthM: Number.NaN }) as never }, opts()).callouts).toEqual([]);
    expect(
      buildRouteLayers({ worstStretch: stretch({ start: { lat: Number.NaN, lng: 0 } }) as never }, opts()).callouts,
    ).toEqual([]);
    expect(
      buildRouteLayers({ worstStretch: stretch({ end: { lat: 51.5, lng: 181 } }) as never }, opts()).callouts,
    ).toEqual([]);
  });
});

// ── Crime clustering ────────────────────────────────────────────────────────

describe('buildRouteLayers crime clusters', () => {
  /** A crime `metres` east of lng 0 at latitude `lat`. */
  const at = (metres: number, lat = BASE_LAT) => ({ lat, lng: lngForMetres(metres, lat) });

  it('never returns individual crimes as points, even when crime is highlighted', () => {
    const crimes = Array.from({ length: 5 }, (_, i) => ({ lat: 51.5 + i * 1e-5, lng: BASE_LNG, severity: 2 }));
    const out = buildRouteLayers({ crimes }, opts({ zoom: 20, highlightCategory: 'crime' }));

    expect(out.points).toEqual([]);
    expect(out.crimeClusters).toHaveLength(1);
  });

  it('groups crimes inside one grid cell into a single cluster with count and max severity', () => {
    const crimes = [
      { lat: 51.5, lng: BASE_LNG, severity: 1 },
      { lat: 51.5, lng: BASE_LNG, severity: 3 },
      { lat: 51.5, lng: BASE_LNG, severity: 2 },
    ];
    const out = buildRouteLayers({ crimes }, opts());

    expect(out.crimeClusters).toEqual([
      expect.objectContaining({ count: 3, maxSeverity: 3 }),
    ]);
  });

  it('keeps crimes in distant cells as separate clusters', () => {
    const crimes = [
      { lat: 51.5, lng: BASE_LNG, severity: 1 },
      { lat: 51.5, lng: BASE_LNG, severity: 1 },
      { lat: 51.5, lng: BASE_LNG, severity: 1 },
      { lat: 51.52, lng: BASE_LNG, severity: 1 },
      { lat: 51.52, lng: BASE_LNG, severity: 1 },
    ];
    const out = buildRouteLayers({ crimes }, opts());

    expect(out.crimeClusters.map((c) => c.count).sort()).toEqual([2, 3]);
  });

  it('orders clusters by latitude, then longitude', () => {
    // Same latitude, two cells: input is deliberately east-to-west so only a sort can fix the order.
    const crimes = [at(500), at(0)];
    const out = buildRouteLayers({ crimes }, opts());

    expect(out.crimeClusters).toHaveLength(2);
    expect(out.crimeClusters[0].lng).toBeLessThan(out.crimeClusters[1].lng);
  });

  it('respects clusterCellMetres: a huge cell merges everything, a tiny one splits it', () => {
    const crimes = [
      { lat: 51.5, lng: BASE_LNG },
      { lat: 51.52, lng: BASE_LNG },
      { lat: 51.54, lng: BASE_LNG },
    ];
    expect(buildRouteLayers({ crimes }, opts({ clusterCellMetres: 100000 })).crimeClusters).toHaveLength(1);
    expect(buildRouteLayers({ crimes }, opts({ clusterCellMetres: 10 })).crimeClusters).toHaveLength(3);
  });

  it('measures east-west spacing with cos(latitude in degrees), not radians', () => {
    // 0.0022 deg of longitude at 51.5 N is about 152 m, more than one 120 m cell.
    // A cos(radians) bug would shrink it to about 81 m and wrongly merge the pair.
    const crimes = [
      { lat: 51.5, lng: 0 },
      { lat: 51.5, lng: 0.0022 },
    ];
    expect(buildRouteLayers({ crimes }, opts()).crimeClusters).toHaveLength(2);
  });

  describe('default clusterCellMetres (120 m)', () => {
    it('clusters two crimes 100 m apart when no cell size is given', () => {
      expect(buildRouteLayers({ crimes: [at(0), at(100)] }, opts()).crimeClusters).toHaveLength(1);
    });

    it('separates two crimes 130 m apart, which straddle the 120 m grid line', () => {
      // A 140 m cell would keep these together, so this pins the default at 120 m.
      expect(buildRouteLayers({ crimes: [at(0), at(130)] }, opts()).crimeClusters).toHaveLength(2);
    });

    it('separates two crimes 140 m apart when no cell size is given', () => {
      expect(buildRouteLayers({ crimes: [at(0), at(140)] }, opts()).crimeClusters).toHaveLength(2);
    });
  });

  describe('cell boundaries', () => {
    it('splits crimes either side of a grid line (119 m and 121 m)', () => {
      // Floor puts 119 m in cell 0 and 121 m in cell 1; rounding would put both in cell 1.
      expect(buildRouteLayers({ crimes: [at(119), at(121)] }, opts()).crimeClusters).toHaveLength(2);
    });

    it('keeps crimes on the same side of a grid line together (1 m and 119 m)', () => {
      // Floor puts both in cell 0; rounding would split them (0 and 1).
      expect(buildRouteLayers({ crimes: [at(1), at(119)] }, opts()).crimeClusters).toHaveLength(1);
    });
  });

  describe('clusterCellMetres validation', () => {
    // Crimes at 0, 100 and 130 m east. With the 120 m default, {0, 100} share a cell and 130 m stands alone.
    const crimes = [at(0), at(100), at(130)];
    const defaults = buildRouteLayers({ crimes }, opts()).crimeClusters;

    it('is the default two-cluster result under the 120 m default', () => {
      expect(defaults).toHaveLength(2);
    });

    it('falls back to the default cell for zero, negative, NaN or infinite sizes', () => {
      for (const size of [0, -120, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(buildRouteLayers({ crimes }, opts({ clusterCellMetres: size })).crimeClusters).toEqual(defaults);
      }
    });
  });

  it('accepts crimes at latitudes of exactly +90 and -90', () => {
    const north = buildRouteLayers({ crimes: [{ lat: 90, lng: 0 }] }, opts());
    const south = buildRouteLayers({ crimes: [{ lat: -90, lng: 0 }] }, opts());

    expect(north.crimeClusters).toEqual([expect.objectContaining({ lat: 90, count: 1 })]);
    expect(south.crimeClusters).toEqual([expect.objectContaining({ lat: -90, count: 1 })]);
  });

  it('defaults a missing crime severity to DEFAULT_CRIME_SEVERITY and conserves the total crime count', () => {
    const crimes = [
      { lat: 51.5, lng: BASE_LNG },
      { lat: 51.5, lng: BASE_LNG, severity: Number.NaN },
      { lat: 51.52, lng: BASE_LNG, severity: 4 },
    ];
    const out = buildRouteLayers({ crimes }, opts());

    expect(out.crimeClusters.reduce((sum, c) => sum + c.count, 0)).toBe(3);
    expect(Math.max(...out.crimeClusters.map((c) => c.maxSeverity))).toBe(4);
    expect(out.crimeClusters.find((c) => c.lat < 51.51)?.maxSeverity).toBe(DEFAULT_CRIME_SEVERITY);
  });

  it('exposes DEFAULT_CRIME_SEVERITY as 0.4, matching the backend crime severity fallback', () => {
    expect(DEFAULT_CRIME_SEVERITY).toBe(0.4);
  });

  it('shows crime clusters regardless of the highlight category', () => {
    const crimes = [{ lat: 51.5, lng: BASE_LNG, severity: 1 }];
    const out = buildRouteLayers({ crimes }, opts({ highlightCategory: 'light' }));
    expect(out.crimeClusters).toHaveLength(1);
  });

  it('skips crimes with invalid coordinates', () => {
    const crimes = [{ lat: Number.NaN, lng: BASE_LNG }, { lat: 51.5, lng: 200 }, { lat: 51.5, lng: BASE_LNG }];
    const out = buildRouteLayers({ crimes }, opts());
    expect(out.crimeClusters.map((c) => c.count)).toEqual([1]);
  });

  it('skips null and non-object crime entries', () => {
    const crimes = [null, 'bad', 42, { lat: 51.5, lng: BASE_LNG }] as never;
    const out = buildRouteLayers({ crimes }, opts());
    expect(out.crimeClusters.map((c) => c.count)).toEqual([1]);
  });
});

// ── Points: zoom and highlight gating ───────────────────────────────────────

describe('buildRouteLayers point gating', () => {
  const input: RouteLayerInput = {
    lights: [{ lat: 51.5, lng: BASE_LNG }],
    cctv: [{ lat: 51.501, lng: BASE_LNG }],
    places: [{ lat: 51.502, lng: BASE_LNG }],
  };

  it('shows no lights, cctv or shops by default', () => {
    expect(buildRouteLayers(input, opts({ zoom: 15 })).points).toEqual([]);
  });

  it('shows lights from zoom 17 by default, but not at zoom 16', () => {
    expect(buildRouteLayers(input, opts({ zoom: 16 })).points).toEqual([]);
    expect(buildRouteLayers(input, opts({ zoom: 17 })).points).toEqual([
      { kind: 'light', lat: 51.5, lng: BASE_LNG },
    ]);
  });

  it('honours a custom showLightsAtZoom threshold', () => {
    expect(buildRouteLayers(input, opts({ zoom: 17, showLightsAtZoom: 18 })).points).toEqual([]);
    expect(buildRouteLayers(input, opts({ zoom: 18, showLightsAtZoom: 18 })).points).toHaveLength(1);
  });

  it('shows only cctv when cctv is highlighted, at any zoom', () => {
    const points = buildRouteLayers(input, opts({ zoom: 10, highlightCategory: 'cctv' })).points;
    expect(points).toEqual([{ kind: 'cctv', lat: 51.501, lng: BASE_LNG }]);
  });

  it('shows only shops when shop is highlighted', () => {
    const points = buildRouteLayers(input, opts({ zoom: 10, highlightCategory: 'shop' })).points;
    expect(points).toEqual([{ kind: 'shop', lat: 51.502, lng: BASE_LNG }]);
  });

  it('shows lights at low zoom only when light is highlighted', () => {
    const points = buildRouteLayers(input, opts({ zoom: 10, highlightCategory: 'light' })).points;
    expect(points).toEqual([{ kind: 'light', lat: 51.5, lng: BASE_LNG }]);
  });

  it('does not change lines or callouts when a point category is highlighted', () => {
    const segments = chain([{ risk: 0.2 }, { risk: 0.8 }]);
    const a = buildRouteLayers({ segments, lights: input.lights }, opts({ zoom: 10 }));
    const b = buildRouteLayers({ segments, lights: input.lights }, opts({ zoom: 10, highlightCategory: 'light' }));
    expect(b.lines).toEqual(a.lines);
    expect(b.callouts).toEqual(a.callouts);
  });

  it('skips light, cctv and shop points with invalid coordinates', () => {
    const bad = [{ lat: Number.NaN, lng: BASE_LNG }, { lat: 91, lng: BASE_LNG }, null] as never;
    for (const highlightCategory of ['cctv', 'shop'] as const) {
      const out = buildRouteLayers({ lights: bad, cctv: bad, places: bad }, opts({ zoom: 18, highlightCategory }));
      expect(out.points).toEqual([]);
    }
  });

  it('accepts points at latitudes of exactly +90 and -90', () => {
    const points = buildRouteLayers({ lights: [{ lat: 90, lng: 0 }, { lat: -90, lng: 0 }] }, opts({ zoom: 18 })).points;
    expect(points.map((p) => p.lat)).toEqual([90, -90]);
  });
});

// ── Point cap ───────────────────────────────────────────────────────────────

describe('buildRouteLayers point cap', () => {
  it('caps points at 150 by evenly sampling the candidates', () => {
    const lights = Array.from({ length: 1000 }, (_, i) => ({ lat: 51.5 + i * 1e-5, lng: BASE_LNG }));
    const out = buildRouteLayers({ lights }, opts({ zoom: 18 }));

    expect(out.points).toHaveLength(150);
    expect(out.points[0].lat).toBe(lights[0].lat);
    expect(out.points[1].lat).toBe(lights[Math.floor(1000 / 150)].lat);
    const indices = out.points.map((p) => Math.round((p.lat - 51.5) / 1e-5));
    expect(new Set(indices).size).toBe(150);
  });

  it('keeps every point when there are 150 or fewer', () => {
    const lights = Array.from({ length: 150 }, (_, i) => ({ lat: 51.5 + i * 1e-5, lng: BASE_LNG }));
    expect(buildRouteLayers({ lights }, opts({ zoom: 18 })).points).toHaveLength(150);
  });

  it('applies the cap across kinds combined', () => {
    // 100 lights (shown at zoom 18) + 100 cctv (highlighted) = 200 candidates
    const lights = Array.from({ length: 100 }, (_, i) => ({ lat: 51.5 + i * 1e-5, lng: BASE_LNG }));
    const cctv = Array.from({ length: 100 }, (_, i) => ({ lat: 52.5 + i * 1e-5, lng: BASE_LNG }));
    const out = buildRouteLayers({ lights, cctv }, opts({ zoom: 18, highlightCategory: 'cctv' }));

    expect(out.points).toHaveLength(150);
    expect(new Set(out.points.map((p) => p.kind))).toEqual(new Set(['light', 'cctv']));
  });
});

// ── Robustness, purity and legend ───────────────────────────────────────────

describe('buildRouteLayers robustness', () => {
  it('returns empty layers for empty, null or undefined input without throwing', () => {
    const empty = { lines: [], callouts: [], crimeClusters: [], points: [] };
    expect(buildRouteLayers({}, opts())).toMatchObject(empty);
    expect(buildRouteLayers({ segments: [] }, opts())).toMatchObject(empty);
    expect(buildRouteLayers(null as never, opts())).toMatchObject(empty);
    expect(buildRouteLayers(undefined as never, opts())).toMatchObject(empty);
  });

  it('tolerates missing options: with no zoom, zoom-gated points stay hidden', () => {
    const lights = [{ lat: 51.5, lng: BASE_LNG }];
    expect(buildRouteLayers({ lights }, null as never).points).toEqual([]);
  });

  it('treats a NaN zoom as below every threshold', () => {
    const lights = [{ lat: 51.5, lng: BASE_LNG }];
    expect(buildRouteLayers({ lights }, opts({ zoom: Number.NaN })).points).toEqual([]);
  });

  it('does not mutate the input', () => {
    const input = deepFreeze({
      segments: chain([{ risk: 0.1 }, { risk: 0.9, litEstimate: 'estimated_lit' as const }]),
      worstStretch: { start: { lat: 51.5, lng: BASE_LNG }, end: { lat: 51.51, lng: BASE_LNG }, lengthM: 300, cause: 'lighting' },
      crimes: [{ lat: 51.5, lng: BASE_LNG, severity: 2 }],
      lights: [{ lat: 51.5, lng: BASE_LNG }],
    });
    expect(() => buildRouteLayers(input as RouteLayerInput, opts({ zoom: 18 }))).not.toThrow();
  });

  it('is deterministic for the same input', () => {
    const input: RouteLayerInput = {
      segments: chain([{ risk: 0.1 }, { risk: 0.7 }, { risk: 0.7, certainty: 0.2 }]),
      crimes: [{ lat: 51.5, lng: BASE_LNG }, { lat: 51.52, lng: BASE_LNG, severity: 2 }],
    };
    expect(buildRouteLayers(input, opts())).toEqual(buildRouteLayers(input, opts()));
  });

  it('exposes a legend that matches the ramp', () => {
    const { legend } = buildRouteLayers({}, opts());

    expect(legend.ramp).toHaveLength(RISK_STEPS);
    expect(legend.ramp.map((s) => s.color)).toEqual([...RISK_RAMP]);
    expect(legend.ramp[0].from).toBe(0);
    expect(legend.ramp[RISK_STEPS - 1].to).toBe(1);
    expect(typeof legend.dashedLabel).toBe('string');
  });
});

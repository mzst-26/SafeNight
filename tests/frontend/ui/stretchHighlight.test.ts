import { buildRouteLayers } from '@/src/components/maps/routeLayers';
import {
  STRETCH_HIGHLIGHT_JS,
  worstStretchForMap,
} from '@/src/components/maps/inline/stretchHighlight';

/*
 * The worst-stretch highlight is plain JS shared by the Leaflet and MapLibre pages. The functions
 * are evaluated here from the same string the pages embed, so these tests exercise the real code.
 */
type Pt = { lat: number; lng: number };
type Stretch = { start: Pt; end: Pt; lengthM: number; cause: string | null };

const inline = new Function(
  `${STRETCH_HIGHLIGHT_JS}\nreturn { rlStretchPath, rlPathHalfway, rlStretchCalloutText };`,
)() as {
  rlStretchPath: (path: Pt[], start: Pt, end: Pt) => Pt[];
  rlPathHalfway: (path: Pt[]) => Pt | null;
  rlStretchCalloutText: (stretch: Stretch) => string;
};

const round = (pts: Pt[]) => pts.map((p) => [Number(p.lat.toFixed(6)), Number(p.lng.toFixed(6))]);

// A straight west-bound line along lat 51.5, one vertex every 0.01 degrees of longitude.
const straight: Pt[] = [0, 1, 2, 3, 4].map((i) => ({ lat: 51.5, lng: -0.1 - i * 0.01 }));

describe('rlStretchPath: the part of a route line between the two ends of its worst stretch', () => {
  test('returns both ends exactly and every route vertex between them, in route order', () => {
    const start = { lat: 51.5, lng: -0.115 };
    const end = { lat: 51.5, lng: -0.125 };
    expect(round(inline.rlStretchPath(straight, start, end))).toEqual([
      [51.5, -0.115],
      [51.5, -0.12],
      [51.5, -0.125],
    ]);
  });

  test('gives the same stretch when the two ends are passed the other way round', () => {
    const start = { lat: 51.5, lng: -0.125 };
    const end = { lat: 51.5, lng: -0.115 };
    expect(round(inline.rlStretchPath(straight, start, end))).toEqual([
      [51.5, -0.115],
      [51.5, -0.12],
      [51.5, -0.125],
    ]);
  });

  test('never includes route points outside the stretch', () => {
    const out = inline.rlStretchPath(straight, { lat: 51.5, lng: -0.115 }, { lat: 51.5, lng: -0.125 });
    const lngs = out.map((p) => p.lng);
    expect(lngs.every((lng) => lng <= -0.114999 && lng >= -0.125001)).toBe(true);
    expect(out.length).toBeLessThan(straight.length);
  });

  test('follows the bends of the line between the ends', () => {
    const bent: Pt[] = [
      { lat: 51.5, lng: -0.1 },
      { lat: 51.5, lng: -0.11 },
      { lat: 51.51, lng: -0.11 },
    ];
    const out = inline.rlStretchPath(bent, { lat: 51.5, lng: -0.105 }, { lat: 51.505, lng: -0.11 });
    expect(round(out)).toEqual([
      [51.5, -0.105],
      [51.5, -0.11],
      [51.505, -0.11],
    ]);
  });

  test('gives just the two ends when both lie on the same segment', () => {
    const out = inline.rlStretchPath(straight, { lat: 51.5, lng: -0.102 }, { lat: 51.5, lng: -0.107 });
    expect(round(out)).toEqual([
      [51.5, -0.102],
      [51.5, -0.107],
    ]);
  });

  test('is empty when the ends are the same spot, the path is too short, or a point is invalid', () => {
    const p = { lat: 51.5, lng: -0.11 };
    expect(inline.rlStretchPath(straight, p, p)).toEqual([]);
    expect(inline.rlStretchPath([straight[0]], p, { lat: 51.5, lng: -0.12 })).toEqual([]);
    expect(inline.rlStretchPath([], p, { lat: 51.5, lng: -0.12 })).toEqual([]);
    expect(inline.rlStretchPath(straight, { lat: NaN, lng: -0.11 }, { lat: 51.5, lng: -0.12 })).toEqual([]);
  });
});

describe('rlPathHalfway: the callout anchor, halfway along the drawn stretch', () => {
  test('is the point halfway along the length of the line', () => {
    const line: Pt[] = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 1 },
      { lat: 0, lng: 3 },
    ];
    const mid = inline.rlPathHalfway(line);
    expect(mid?.lat).toBeCloseTo(0, 9);
    expect(mid?.lng).toBeCloseTo(1.5, 9);
  });

  test('is null for an empty line', () => {
    expect(inline.rlPathHalfway([])).toBeNull();
  });
});

describe('rlStretchCalloutText: the same wording as the route callout', () => {
  test.each([
    ['lighting', 'Unlit stretch · 240 m'],
    [null, 'High-risk stretch · 240 m'],
  ])('cause %s reads "%s"', (cause, expected) => {
    const stretch: Stretch = {
      start: { lat: 51.5, lng: -0.1 },
      end: { lat: 51.51, lng: -0.09 },
      lengthM: 240.4,
      cause,
    };
    expect(inline.rlStretchCalloutText(stretch)).toBe(expected);
  });

  test('matches the callout text the route layers build for the same stretch', () => {
    const stretch: Stretch = {
      start: { lat: 51.5, lng: -0.1 },
      end: { lat: 51.51, lng: -0.09 },
      lengthM: 312,
      cause: 'lighting',
    };
    const spec = buildRouteLayers({ worstStretch: stretch, segments: [] }, {});
    expect(spec.callouts[0].text).toBe(inline.rlStretchCalloutText(stretch));
  });
});

describe('worstStretchForMap: the worst stretch a route sends to the map', () => {
  const path = [
    { latitude: 51.5, longitude: -0.1 },
    { latitude: 51.51, longitude: -0.09 },
  ];

  test('takes the stretch from the route safety data, as plain lat/lng points', () => {
    const route = {
      id: 'r1',
      distanceMeters: 800,
      durationSeconds: 600,
      encodedPolyline: '',
      path,
      safety: {
        worstStretch: {
          start: { lat: 51.5, lng: -0.1, extra: 'ignored' },
          end: { lat: 51.51, lng: -0.09 },
          lengthM: 210,
          cause: 'lighting',
        },
      },
    } as never;
    expect(worstStretchForMap(route)).toEqual({
      start: { lat: 51.5, lng: -0.1 },
      end: { lat: 51.51, lng: -0.09 },
      lengthM: 210,
      cause: 'lighting',
    });
  });

  test('is null when the route has no worst stretch', () => {
    expect(worstStretchForMap({ id: 'r2', path, safety: { worstStretch: null } } as never)).toBeNull();
    expect(worstStretchForMap({ id: 'r3', path } as never)).toBeNull();
  });
});

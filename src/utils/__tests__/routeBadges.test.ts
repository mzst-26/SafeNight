import { buildRouteBadges, routeMidpointByDistance } from '@/src/utils/routeBadges';

/** A point on the equator (or on the meridian) `deg` degrees from the origin. */
const eq = (deg: number) => ({ latitude: 0, longitude: deg });
const merid = (deg: number) => ({ latitude: deg, longitude: 0 });

describe('routeMidpointByDistance', () => {
  it('returns null for an empty or fully invalid path', () => {
    expect(routeMidpointByDistance([])).toBeNull();
    expect(routeMidpointByDistance([{ latitude: Number.NaN, longitude: 0 }])).toBeNull();
  });

  it('returns the only point of a single-point path', () => {
    expect(routeMidpointByDistance([merid(51.5)])).toEqual({ lat: 51.5, lng: 0 });
  });

  it('returns the first point when the path has zero length', () => {
    expect(routeMidpointByDistance([merid(51.5), merid(51.5), merid(51.5)])).toEqual({ lat: 51.5, lng: 0 });
  });

  it('returns the midpoint of a two-point path', () => {
    const mid = routeMidpointByDistance([merid(51.5), merid(51.6)]);
    expect(mid?.lat).toBeCloseTo(51.55, 9);
    expect(mid?.lng).toBeCloseTo(0, 9);
  });

  it('weights by distance, not by vertex count', () => {
    // Three vertices: the first two are close together, the third is far away.
    // Half the length is 0.5 of the way along the long leg, not the middle vertex.
    const path = [eq(0), eq(0.01), eq(1)];
    const mid = routeMidpointByDistance(path);
    expect(mid?.lat).toBeCloseTo(0, 9);
    expect(mid?.lng).toBeCloseTo(0.5, 6);
  });

  it('returns a point on the segment that contains the halfway distance', () => {
    // Lengths: 0->0.2 (0.2 deg) then 0.2->0.4 (0.2 deg). Halfway is 0.2 deg, the second vertex.
    const mid = routeMidpointByDistance([eq(0), eq(0.2), eq(0.4)]);
    expect(mid?.lng).toBeCloseTo(0.2, 9);
  });

  it('ignores invalid points and measures only the valid ones', () => {
    const path = [eq(0), { latitude: Number.NaN, longitude: 0.3 }, eq(1)];
    expect(routeMidpointByDistance(path)?.lng).toBeCloseTo(0.5, 6);
  });

  it('accepts points at the poles and antimeridian bounds', () => {
    expect(routeMidpointByDistance([{ latitude: 90, longitude: 0 }])).toEqual({ lat: 90, lng: 0 });
    expect(routeMidpointByDistance([{ latitude: 0, longitude: 180 }])).toEqual({ lat: 0, lng: 180 });
  });

  it('rejects out-of-range coordinates', () => {
    expect(routeMidpointByDistance([{ latitude: 91, longitude: 0 }])).toBeNull();
    expect(routeMidpointByDistance([{ latitude: 0, longitude: 181 }])).toBeNull();
  });

  it('does not mutate the input path', () => {
    const path = Object.freeze([Object.freeze(merid(51.5)), Object.freeze(merid(51.6))]);
    expect(() => routeMidpointByDistance(path)).not.toThrow();
  });
});

describe('buildRouteBadges', () => {
  const route = (id: string, path = [merid(51.5), merid(51.6)]) => ({ id, path });

  it('returns no badges for no routes', () => {
    expect(buildRouteBadges([], {}, null)).toEqual([]);
  });

  it('makes one badge per route that has a score, at its overview midpoint', () => {
    const badges = buildRouteBadges(
      [route('a'), route('b', [merid(52), merid(52.2)])],
      { a: { score: 62 }, b: { score: 71 } },
      'a',
    );
    expect(badges).toHaveLength(2);
    expect(badges[0]).toMatchObject({ routeId: 'a', text: '62', selected: true });
    expect(badges[0].lat).toBeCloseTo(51.55, 9);
    expect(badges[1]).toMatchObject({ routeId: 'b', text: '71', selected: false });
    expect(badges[1].lat).toBeCloseTo(52.1, 9);
  });

  it('marks only the selected route, and none when nothing is selected', () => {
    const scores = { a: { score: 50 }, b: { score: 60 } };
    const routes = [route('a'), route('b')];
    expect(buildRouteBadges(routes, scores, 'b').map((b) => b.selected)).toEqual([false, true]);
    expect(buildRouteBadges(routes, scores, null).map((b) => b.selected)).toEqual([false, false]);
  });

  it('omits routes with no score, a non-finite score, or no usable path', () => {
    const badges = buildRouteBadges(
      [route('noScore'), route('nan'), route('noPath', []), route('ok')],
      { nan: { score: Number.NaN }, noPath: { score: 40 }, ok: { score: 33 } },
      null,
    );
    expect(badges.map((b) => b.routeId)).toEqual(['ok']);
  });

  it('uses the score as the label text exactly as given', () => {
    expect(buildRouteBadges([route('a')], { a: { score: 0 } }, null)[0].text).toBe('0');
    expect(buildRouteBadges([route('a')], { a: { score: 100 } }, null)[0].text).toBe('100');
  });
});

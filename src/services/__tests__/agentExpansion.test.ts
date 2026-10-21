import { expansionRingPoints, RING_RADIUS_M } from '@/src/services/agentExpansion';
import type { LatLng } from '@/src/types/geo';

const centre: LatLng = { latitude: 51.5074, longitude: -0.1278 };

// Great-circle distance in metres, used to check the offsets independently of the implementation.
function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

describe('expansionRingPoints', () => {
  it('uses an 800 m radius', () => {
    expect(RING_RADIUS_M).toBe(800);
  });

  it('returns 8 ring points with ids r1..r8 and kind ring', () => {
    const points = expansionRingPoints(centre);
    expect(points.map((p) => p.id)).toEqual(['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8']);
    points.forEach((p) => expect(p.kind).toBe('ring'));
  });

  it('labels the points by compass direction, starting north and going clockwise', () => {
    const labels = expansionRingPoints(centre).map((p) => p.label);
    expect(labels).toEqual([
      'North area',
      'North-east area',
      'East area',
      'South-east area',
      'South area',
      'South-west area',
      'West area',
      'North-west area',
    ]);
  });

  it('places the north point about 800 m north of the centre (within 1%)', () => {
    const north = expansionRingPoints(centre)[0];
    expect(north.lat).toBeGreaterThan(centre.latitude);
    expect(Math.abs(north.lng - centre.longitude)).toBeLessThan(1e-9);
    const distance = haversineM({ lat: centre.latitude, lng: centre.longitude }, north);
    expect(Math.abs(distance - 800) / 800).toBeLessThan(0.01);
  });

  it('places every point about 800 m from the centre (within 1%)', () => {
    expansionRingPoints(centre).forEach((p) => {
      const distance = haversineM({ lat: centre.latitude, lng: centre.longitude }, p);
      expect(Math.abs(distance - 800) / 800).toBeLessThan(0.01);
    });
  });

  it('puts the east point east of the centre and the west point west of it', () => {
    const points = expansionRingPoints(centre);
    const east = points[2];
    const west = points[6];
    expect(east.lng).toBeGreaterThan(centre.longitude);
    expect(Math.abs(east.lat - centre.latitude)).toBeLessThan(1e-9);
    expect(west.lng).toBeLessThan(centre.longitude);
    expect(Math.abs(west.lat - centre.latitude)).toBeLessThan(1e-9);
  });
});

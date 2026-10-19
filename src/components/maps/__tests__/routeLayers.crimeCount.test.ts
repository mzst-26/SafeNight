import { buildRouteLayers, type CrimeInput } from '@/src/components/maps/routeLayers';

const opts = { zoom: 15 };

describe('buildRouteLayers crime count weights (v2 clusters)', () => {
  it('sums the count of pre-clustered crimes instead of counting each cluster as one', () => {
    const crimes: CrimeInput[] = [
      { lat: 51.5, lng: -0.1, count: 40, severity: 0.8 },
      { lat: 51.5001, lng: -0.1001, count: 2, severity: 0.2 },
    ];
    const out = buildRouteLayers({ crimes }, opts);
    expect(out.crimeClusters).toHaveLength(1);
    expect(out.crimeClusters[0].count).toBe(42);
    expect(out.crimeClusters[0].maxSeverity).toBe(0.8);
  });

  it('treats a crime without count as a single incident (v1 raw POIs unchanged)', () => {
    const crimes: CrimeInput[] = [{ lat: 51.5, lng: -0.1 }, { lat: 51.5, lng: -0.1 }];
    expect(buildRouteLayers({ crimes }, opts).crimeClusters[0].count).toBe(2);
  });

  it('ignores non-finite, zero and negative counts by treating them as one incident', () => {
    const crimes: CrimeInput[] = [
      { lat: 51.5, lng: -0.1, count: Number.NaN },
      { lat: 51.5, lng: -0.1, count: 0 },
      { lat: 51.5, lng: -0.1, count: -5 },
    ];
    expect(buildRouteLayers({ crimes }, opts).crimeClusters[0].count).toBe(3);
  });

  it('floors fractional counts and keeps at least one incident', () => {
    const crimes: CrimeInput[] = [{ lat: 51.5, lng: -0.1, count: 2.9 }];
    expect(buildRouteLayers({ crimes }, opts).crimeClusters[0].count).toBe(2);
  });
});

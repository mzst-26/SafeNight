import { CRIME_CLUSTER_MAP_CAP, buildRouteLayers, type CrimeInput } from '@/src/components/maps/routeLayers';

describe('buildRouteLayers crime cluster cap', () => {
  it('keeps exactly CRIME_CLUSTER_MAP_CAP clusters when there are CAP + 1 distinct cells', () => {
    // Crimes 0.01 degrees (about 1.1 km) apart in latitude: each one falls in its own 120 m cell.
    const crimes: CrimeInput[] = Array.from({ length: CRIME_CLUSTER_MAP_CAP + 1 }, (_, i) => ({
      lat: 51.5 + i * 0.01,
      lng: -0.1,
      severity: 1,
    }));

    const out = buildRouteLayers({ crimes }, { zoom: 15 });

    expect(out.crimeClusters).toHaveLength(CRIME_CLUSTER_MAP_CAP);
  });
});

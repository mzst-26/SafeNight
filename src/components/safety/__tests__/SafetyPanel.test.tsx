import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { SafetyPanel, formatWorstStretch } from '@/src/components/safety/SafetyPanel';
import type { RouteDataQuality, RouteSafety, SafeRoute, SafetyBreakdown, WorstStretch } from '@/src/services/safeRoutes';
import type { SafetyMapResult } from '@/src/services/safetyMapData';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/src/components/ui/CircleProgress', () => ({ CircleProgress: () => null }));

function makeSafetyResult(overrides: Partial<SafetyMapResult> = {}): SafetyMapResult {
  return {
    crimeCount: 3,
    streetLights: 7,
    cctvCount: 4,
    openPlaces: 5,
    safetyScore: 67,
    safetyLabel: 'Safe',
    safetyColor: '#16a34a',
    ...overrides,
  } as unknown as SafetyMapResult;
}

function makeRoute(safety: Partial<RouteSafety> = {}, crimeCount?: number): SafeRoute {
  return {
    id: 'r1',
    routeIndex: 0,
    isSafest: true,
    safety: {
      score: 67,
      label: 'Safe',
      color: '#16a34a',
      breakdown: { traffic: 50 } as SafetyBreakdown,
      roadTypes: {},
      mainRoadRatio: 40,
      ...safety,
    } as RouteSafety,
    safetySegments: [],
    routeStats: {
      sidewalkPct: 60,
      transitStopsNearby: 2,
      deadEnds: 2,
      unpavedPct: 0,
      cctvCamerasNearby: 4,
      roadNameChanges: [],
      crimeCount,
    },
  } as unknown as SafeRoute;
}

function render(safetyResult: SafetyMapResult, route: SafeRoute): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(<SafetyPanel safetyResult={safetyResult} selectedSafeRoute={route} inSidebar />);
  });
  return renderer;
}

function textNodes(renderer: ReactTestRenderer): string[] {
  const out: string[] = [];
  const walk = (node: unknown) => {
    if (node == null) return;
    if (typeof node === 'string') {
      out.push(node);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node === 'object' && 'children' in (node as object)) {
      walk((node as { children: unknown }).children);
    }
  };
  walk(renderer.toJSON());
  return out;
}

const stretch = (overrides: Partial<WorstStretch> = {}): WorstStretch => ({
  start: { lat: 51.5, lng: -0.1 },
  end: { lat: 51.5, lng: -0.11 },
  lengthM: 240,
  cause: 'lighting',
  ...overrides,
});

describe('formatWorstStretch', () => {
  it('reads an unlit stretch in metres', () => {
    expect(formatWorstStretch(stretch({ lengthM: 240, cause: 'lighting' }))).toBe('Weakest stretch: 240 m, unlit');
  });

  it('falls back to higher risk for other causes', () => {
    expect(formatWorstStretch(stretch({ lengthM: 180, cause: 'crime' }))).toBe('Weakest stretch: 180 m, higher risk');
    expect(formatWorstStretch(stretch({ lengthM: 180, cause: null }))).toBe('Weakest stretch: 180 m, higher risk');
  });

  it('uses kilometres from 1000 m upwards', () => {
    expect(formatWorstStretch(stretch({ lengthM: 1500, cause: 'lighting' }))).toBe('Weakest stretch: 1.5 km, unlit');
  });

  it('returns null when there is no stretch or the length is not finite', () => {
    expect(formatWorstStretch(null)).toBeNull();
    expect(formatWorstStretch(undefined)).toBeNull();
    expect(formatWorstStretch(stretch({ lengthM: Number.NaN }))).toBeNull();
  });
});

describe('SafetyPanel', () => {
  it('renders a v1 route as before: crime count, no weakest stretch, no unavailable chip', () => {
    const renderer = render(makeSafetyResult(), makeRoute());
    const texts = textNodes(renderer);
    expect(texts).toContain('3');
    expect(texts.join(' ')).not.toMatch(/Weakest stretch|Crime data unavailable/);
  });

  it('shows the weakest stretch line for a v2 route', () => {
    const renderer = render(makeSafetyResult(), makeRoute({ worstStretch: stretch() }));
    expect(textNodes(renderer)).toContain('Weakest stretch: 240 m, unlit');
  });

  it('shows the true crime total from routeStats on a v2 route', () => {
    const renderer = render(makeSafetyResult({ crimeCount: 3 }), makeRoute({ reason: 'x' }, 12));
    const texts = textNodes(renderer);
    expect(texts).toContain('12');
    expect(texts).not.toContain('3');
  });

  it('shows a dash, a chip and an accessible label when crime data is unavailable', () => {
    const dataQuality: RouteDataQuality = { crime: 'unavailable' };
    const renderer = render(makeSafetyResult({ crimeCount: 0 }), makeRoute({ dataQuality, reason: 'x' }, 0));
    const texts = textNodes(renderer);
    expect(texts).toContain('–');
    expect(texts).not.toContain('0');
    expect(texts).toContain('Crime data unavailable');
    const labelled = renderer.root.findAll((n) => n.props?.accessibilityLabel === 'Crime data unavailable');
    expect(labelled.length).toBeGreaterThan(0);
  });
});

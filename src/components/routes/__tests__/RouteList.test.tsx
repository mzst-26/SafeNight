import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { RouteList } from '@/src/components/routes/RouteList';
import type { RouteSafety, SafeRoute, SafetyBreakdown } from '@/src/services/safeRoutes';
import { buildRouteComparison } from '@/src/utils/routeComparison';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
// safeRoutes.ts (imported for isV2SafeRoute) loads AsyncStorage at module scope.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

function makeRoute(id: string, isSafest: boolean, safety: Partial<RouteSafety>, distanceMeters: number, durationSeconds: number): SafeRoute {
  return {
    id,
    routeIndex: 0,
    isSafest,
    safety: {
      score: 60,
      label: 'Safe',
      color: '#16a34a',
      breakdown: {} as SafetyBreakdown,
      roadTypes: {},
      mainRoadRatio: 40,
      ...safety,
    } as RouteSafety,
    safetySegments: [],
    distanceMeters,
    durationSeconds,
    summary: '',
    legs: [],
  } as unknown as SafeRoute;
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

describe('RouteList', () => {
  it('passes the comparison to each card, so non-recommended cards show a delta vs the recommended route', () => {
    // Route 1 is recommended (score 67, 2.0 mi). Route 2 is the fastest (score 62, 1.4 mi).
    const routes = [
      makeRoute('r1', true, { score: 67, certainty: 0.8, reason: 'Recommended reason' }, 3218, 2340),
      makeRoute('r2', false, { score: 62, certainty: 0.8, reason: 'x' }, 2253, 1500),
    ];
    const routeComparison = buildRouteComparison(
      routes.map((r) => ({
        id: r.id,
        score: r.safety.score,
        certainty: r.safety.certainty,
        reason: r.safety.reason,
        durationSec: r.durationSeconds,
        distanceM: r.distanceMeters,
      })),
    );

    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <RouteList
          routes={routes}
          selectedRouteId={null}
          onSelectRoute={() => {}}
          inSidebar
          routeComparison={routeComparison}
        />,
      );
    });

    const texts = textNodes(renderer);
    expect(texts).toContain('Recommended reason');
    // r2 is 965 m (0.6 mi) shorter than r1 and 5 pts lower.
    expect(texts).toContain('0.6 mi shorter · 5 pts lower');
  });
});

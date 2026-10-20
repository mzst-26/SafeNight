import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { RouteCard } from '@/src/components/routes/RouteCard';
import { RouteList } from '@/src/components/routes/RouteList';
import type { SafeRoute, SafetyBreakdown } from '@/src/services/safeRoutes';
import * as mockAsyncStorage from '@react-native-async-storage/async-storage/jest/async-storage-mock';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@react-native-async-storage/async-storage', () => mockAsyncStorage);

function makeRoute(id: string, index: number): SafeRoute {
  return {
    id,
    routeIndex: index,
    isSafest: index === 0,
    safety: {
      score: 60,
      label: 'Safe',
      color: '#16a34a',
      breakdown: {} as SafetyBreakdown,
      roadTypes: {},
      mainRoadRatio: 40,
    },
    safetySegments: [],
    distanceMeters: 1000 + index,
    durationSeconds: 600 + index,
    summary: '',
    legs: [],
  } as unknown as SafeRoute;
}

function allText(node: unknown): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(allText).join('');
  if (typeof node === 'object' && 'children' in (node as object)) {
    return allText((node as { children: unknown }).children);
  }
  return '';
}

describe('RouteList overflow notice (F-4 / T-93)', () => {
  const routes = Array.from({ length: 7 }, (_, i) => makeRoute(`r${i}`, i));

  function render(list: SafeRoute[]): ReactTestRenderer {
    let r!: ReactTestRenderer;
    act(() => {
      r = create(<RouteList routes={list} selectedRouteId={null} onSelectRoute={() => {}} inSidebar />);
    });
    return r;
  }

  it('renders five cards and a "+2 more routes not shown" line for seven routes', () => {
    const r = render(routes);
    expect(r.root.findAllByType(RouteCard)).toHaveLength(5);
    expect(allText(r.toJSON())).toContain('+2 more routes not shown');
  });

  it('shows no overflow line when five or fewer routes are given', () => {
    const r = render(routes.slice(0, 5));
    expect(r.root.findAllByType(RouteCard)).toHaveLength(5);
    expect(allText(r.toJSON())).not.toContain('more routes not shown');
  });
});

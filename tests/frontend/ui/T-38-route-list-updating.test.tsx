import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { RouteCard } from '@/src/components/routes/RouteCard';
import { RouteList } from '@/src/components/routes/RouteList';
import type { SafeRoute } from '@/src/services/safeRoutes';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

function allText(node: unknown): string[] {
  const out: string[] = [];
  const walk = (n: unknown) => {
    if (n == null || typeof n === 'boolean') return;
    if (typeof n === 'string' || typeof n === 'number') {
      out.push(String(n));
      return;
    }
    if (Array.isArray(n)) {
      n.forEach(walk);
      return;
    }
    if (typeof n === 'object' && 'children' in (n as object)) {
      walk((n as { children: unknown }).children);
    }
  };
  walk(node);
  return out;
}

const routes = [
  {
    id: 'a',
    routeIndex: 0,
    isSafest: true,
    safety: { score: 60, label: 'Safe', color: '#16a34a', breakdown: {}, roadTypes: {}, mainRoadRatio: 40 },
    safetySegments: [],
    distanceMeters: 1000,
    durationSeconds: 600,
    summary: '',
    legs: [],
  },
] as unknown as SafeRoute[];

describe('RouteList while updating for a new time (T-38)', () => {
  it('does not render tappable route cards and shows the waiting message', () => {
    const onSelectRoute = jest.fn();
    let r!: ReactTestRenderer;
    act(() => {
      r = create(
        <RouteList
          routes={routes}
          selectedRouteId="a"
          onSelectRoute={onSelectRoute}
          updatingLabel="Updating for 17:10"
        />,
      );
    });

    expect(r.root.findAllByType(RouteCard)).toHaveLength(0);
    expect(allText(r.toJSON())).toContain('Waiting for routes for 17:10');
    expect(onSelectRoute).not.toHaveBeenCalled();
  });

  it('still renders selectable cards when no update is pending', () => {
    let r!: ReactTestRenderer;
    act(() => {
      r = create(<RouteList routes={routes} selectedRouteId="a" onSelectRoute={jest.fn()} />);
    });
    expect(r.root.findAllByType(RouteCard)).toHaveLength(1);
  });
});

describe('app/index.tsx Start Navigation while updating (T-38)', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'app/index.tsx'), 'utf8');
  const labels = [
    ...source.matchAll(/accessibilityLabel="Start navigation"/g),
    ...source.matchAll(/accessibilityLabel=\{isWeb \? "Get the app to navigate" : "Start navigation"\}/g),
  ];

  it('finds the Start Navigation controls', () => {
    expect(labels.length).toBeGreaterThanOrEqual(2);
  });

  it('disables every Start Navigation control while the route list is updating', () => {
    for (const match of labels) {
      const before = source.slice(Math.max(0, match.index! - 400), match.index!);
      expect(before).toContain('disabled={!!h.timeUpdatingLabel}');
    }
  });
});

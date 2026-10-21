import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { AIInsightsButton } from '@/src/components/ui/AIInsightsButton';
import { RouteList } from '@/src/components/routes/RouteList';
import type { SafeRoute } from '@/src/services/safeRoutes';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const route = (id: string, isSafest: boolean, leaveAtIso?: string) =>
  ({
    id,
    routeIndex: 0,
    isSafest,
    safety: {
      score: 60,
      label: 'Safe',
      color: '#16a34a',
      breakdown: {},
      roadTypes: {},
      mainRoadRatio: 40,
      timeline: leaveAtIso ? { leaveAtIso, arriveAtIso: leaveAtIso, label: 'daylight' } : undefined,
    },
    safetySegments: [],
    distanceMeters: 1000,
    durationSeconds: 600,
    summary: '',
    legs: [],
  }) as unknown as SafeRoute;

const mounted: ReactTestRenderer[] = [];

afterEach(() => {
  // Stops the bounce loop; otherwise it outlives the test and crashes the run.
  while (mounted.length) mounted.pop()?.unmount();
});

function render(props: Partial<React.ComponentProps<typeof RouteList>>): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      <RouteList routes={[route('best', true, '2026-12-01T01:30:00.000Z'), route('other', false)]} selectedRouteId="best" onSelectRoute={() => {}} {...props} />,
    );
  });
  mounted.push(renderer);
  return renderer;
}

describe('RouteList AI Insights bar', () => {
  test('shows the bar above the recommended card when a handler is given', () => {
    const renderer = render({ onExplainRoute: () => {} });
    const bars = renderer.root.findAllByType(AIInsightsButton);
    expect(bars).toHaveLength(1);
    expect(bars[0].props.tone).toBe('late');
  });

  test('shows no bar without a handler', () => {
    const renderer = render({});
    expect(renderer.root.findAllByType(AIInsightsButton)).toHaveLength(0);
  });

  test('hides the bar during navigation, when safety is hidden', () => {
    const renderer = render({ onExplainRoute: () => {}, hideSafety: true });
    expect(renderer.root.findAllByType(AIInsightsButton)).toHaveLength(0);
  });
});

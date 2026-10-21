import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { RouteCard } from '@/src/components/routes/RouteCard';
import type { RouteSafety, SafeRoute, SafetyBreakdown } from '@/src/services/safeRoutes';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const LABEL = 'Why we recommend this route';

function makeRoute(isSafest: boolean): SafeRoute {
  const safety: RouteSafety = {
    score: 67,
    label: 'Safe',
    color: '#16a34a',
    breakdown: {} as SafetyBreakdown,
    roadTypes: {},
    mainRoadRatio: 40,
  };
  return {
    id: isSafest ? 'best' : 'other',
    routeIndex: 0,
    isSafest,
    safety,
    safetySegments: [],
    distanceMeters: 3218,
    durationSeconds: 2340,
    summary: '',
    legs: [],
  } as unknown as SafeRoute;
}

function render(props: Partial<React.ComponentProps<typeof RouteCard>>): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      <RouteCard
        route={makeRoute(true)}
        index={0}
        isSelected={false}
        onSelect={() => {}}
        {...props}
      />,
    );
  });
  return renderer;
}

function explainButtons(renderer: ReactTestRenderer) {
  return renderer.root.findAll(
    (n) => n.props.accessibilityLabel === LABEL && typeof n.props.onPress === 'function',
  );
}

describe('RouteCard explain circle', () => {
  test('recommended card with onExplain shows the circle and calls onExplain when tapped', () => {
    const onExplain = jest.fn();
    const renderer = render({ route: makeRoute(true), onExplain });

    const buttons = explainButtons(renderer);
    expect(buttons.length).toBeGreaterThan(0);
    act(() => {
      buttons[0].props.onPress();
    });
    expect(onExplain).toHaveBeenCalledTimes(1);
  });

  test('other routes never show the circle', () => {
    const renderer = render({ route: makeRoute(false), onExplain: () => {} });
    expect(explainButtons(renderer)).toHaveLength(0);
  });

  test('no circle without an onExplain handler', () => {
    const renderer = render({ route: makeRoute(true) });
    expect(explainButtons(renderer)).toHaveLength(0);
  });

  test('no circle while safety is hidden during navigation', () => {
    const renderer = render({ route: makeRoute(true), onExplain: () => {}, hideSafety: true });
    expect(explainButtons(renderer)).toHaveLength(0);
  });
});

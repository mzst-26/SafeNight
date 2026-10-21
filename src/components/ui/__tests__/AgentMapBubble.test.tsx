import React from 'react';
import { StyleSheet } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import RouteMap from '@/src/components/maps/RouteMap';
import { AGENT_BUBBLE_SIZE, AgentMapBubble } from '@/src/components/ui/AgentMapBubble';
import { glassSurface } from '@/src/components/ui/glass';
import type { DirectionsRoute } from '@/src/types/geo';

// RouteMap is mocked so this test does not depend on the instanceId change landing in RouteMap.
jest.mock('@/src/components/maps/RouteMap', () => ({
  __esModule: true,
  default: jest.fn(() => null),
}));

const mockedRouteMap = RouteMap as unknown as jest.Mock;

const origin = { latitude: 51.5, longitude: -0.13 };
const destination = { latitude: 51.52, longitude: -0.1 };

const routes: DirectionsRoute[] = [
  {
    id: 'safe-route-0',
    distanceMeters: 1200,
    durationSeconds: 900,
    encodedPolyline: '',
    path: [origin, destination],
  },
];

const mounted: ReactTestRenderer[] = [];

afterEach(() => {
  while (mounted.length) {
    const renderer = mounted.pop();
    act(() => {
      renderer?.unmount();
    });
  }
  mockedRouteMap.mockClear();
});

function renderBubble(props: Partial<React.ComponentProps<typeof AgentMapBubble>> = {}) {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      <AgentMapBubble
        origin={origin}
        destination={destination}
        routes={routes}
        selectedRouteId="safe-route-0"
        {...props}
      />,
    );
  });
  mounted.push(renderer);
  return renderer;
}

function lastMapProps(): Record<string, unknown> {
  const calls = mockedRouteMap.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1][0] as Record<string, unknown>;
}

describe('AgentMapBubble', () => {
  it('exports a 180 px bubble size', () => {
    expect(AGENT_BUBBLE_SIZE).toBe(180);
  });

  it('renders the agent map with the given routes and instanceId "agent"', () => {
    renderBubble();

    const props = lastMapProps();
    expect(props.instanceId).toBe('agent');
    expect(props.origin).toEqual(origin);
    expect(props.destination).toEqual(destination);
    expect(props.routes).toEqual(routes);
    expect(props.selectedRouteId).toBe('safe-route-0');
  });

  it('shows "Checking the map" under the map by default', () => {
    const renderer = renderBubble();

    expect(JSON.stringify(renderer.toJSON())).toContain('Checking the map');
  });

  it('shows the status prop under the map when given', () => {
    const renderer = renderBubble({ status: 'Looking at the dark stretch' });

    const text = JSON.stringify(renderer.toJSON());
    expect(text).toContain('Looking at the dark stretch');
    expect(text).not.toContain('Checking the map');
  });

  it('is a rounded square glass surface of AGENT_BUBBLE_SIZE', () => {
    const renderer = renderBubble();

    const root = renderer.toJSON() as unknown as { props: { style: unknown } };
    const style = StyleSheet.flatten(root.props.style as never) as Record<string, unknown>;
    expect(style.width).toBe(AGENT_BUBBLE_SIZE);
    expect(style.height).toBe(AGENT_BUBBLE_SIZE);
    expect(style.borderRadius).toBeGreaterThan(0);
    expect(style.backgroundColor).toBe(glassSurface.backgroundColor);
    expect(style.overflow).toBe('hidden');
  });
});

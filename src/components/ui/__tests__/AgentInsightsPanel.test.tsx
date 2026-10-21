import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { AgentInsightsPanel } from '@/src/components/ui/AgentInsightsPanel';
import { postAgentInsights, type AgentContext, type AgentInsightsResponse } from '@/src/services/agentClient';
import { captureMapSnapshot } from '@/src/services/mapSnapshot';
import { expansionRingPoints, fetchRouteThroughPoint } from '@/src/services/agentExpansion';
import { setMapController, type MapController } from '@/src/services/mapController';
import type { SafeRoute } from '@/src/services/safeRoutes';
import type { DirectionsRoute } from '@/src/types/geo';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/src/services/agentClient', () => {
  const actual = jest.requireActual('@/src/services/agentClient');
  return { ...actual, postAgentInsights: jest.fn() };
});
jest.mock('@/src/services/mapSnapshot', () => ({ captureMapSnapshot: jest.fn() }));
jest.mock('@/src/services/agentExpansion', () => {
  const actual = jest.requireActual('@/src/services/agentExpansion');
  return { ...actual, fetchRouteThroughPoint: jest.fn() };
});

// The bubble is checked through the status line it is given; its map (RouteMap) is not under test here.
const mockStatusLog: string[] = [];
const mockBubbleRoutes: unknown[][] = [];
jest.mock('@/src/components/ui/AgentMapBubble', () => ({
  AgentMapBubble: (props: { status?: string; routes?: unknown[] }) => {
    mockStatusLog.push(props.status ?? '');
    mockBubbleRoutes.push(props.routes ?? []);
    return null;
  },
}));

const mockedPost = postAgentInsights as jest.MockedFunction<typeof postAgentInsights>;
const mockedCapture = captureMapSnapshot as jest.MockedFunction<typeof captureMapSnapshot>;

const SNAP_1 = 'data:image/jpeg;base64,AAAA';
const SNAP_2 = 'data:image/jpeg;base64,BBBB';

const context: AgentContext = {
  body: {
    bestRouteId: 'safe-route-0',
    routes: [],
    trip: {},
    candidatePoints: [],
  },
  candidates: [{ id: 'p1', label: 'Middle of the weakest stretch', lat: 51.51, lng: -0.12, kind: 'stretch_midpoint' }],
  routes: [
    {
      id: 'safe-route-0',
      path: [
        { latitude: 51.5, longitude: -0.13 },
        { latitude: 51.52, longitude: -0.1 },
      ],
      worstStretch: null,
    },
    {
      id: 'safe-route-1',
      path: [
        { latitude: 51.4, longitude: -0.2 },
        { latitude: 51.41, longitude: -0.19 },
      ],
      worstStretch: null,
    },
  ],
};

const mapContext: AgentContext = {
  ...context,
  map: {
    origin: { latitude: 51.5, longitude: -0.13 },
    destination: { latitude: 51.52, longitude: -0.1 },
    routes: [] as DirectionsRoute[],
    selectedRouteId: 'safe-route-0',
  },
};

const response = (overrides: Partial<AgentInsightsResponse>): AgentInsightsResponse => ({
  analysis: { routes: [] },
  decision: { kind: 'keep', routeId: 'safe-route-0', reasons: ['The dark stretch is short.'] },
  message: 'Your route is the best choice tonight.',
  actions: [],
  ...overrides,
});

const mounted: ReactTestRenderer[] = [];

beforeEach(() => {
  mockedCapture.mockReset();
  mockedCapture.mockResolvedValue(null);
  mockStatusLog.length = 0;
});

afterEach(() => {
  while (mounted.length) {
    const renderer = mounted.pop();
    act(() => {
      renderer?.unmount();
    });
  }
  mockedPost.mockReset();
  setMapController(null);
  setMapController(null, 'agent');
});

async function renderPanel(props: Partial<React.ComponentProps<typeof AgentInsightsPanel>> = {}) {
  const onClose = jest.fn();
  const onUseRoute = jest.fn();
  const onSetViaPin = jest.fn();
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <AgentInsightsPanel
        visible
        onClose={onClose}
        context={context}
        onUseRoute={onUseRoute}
        onSetViaPin={onSetViaPin}
        {...props}
      />,
    );
  });
  // Let the rounds on open settle inside act, so their state updates are not left dangling.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  mounted.push(renderer);
  return { renderer, onClose, onUseRoute, onSetViaPin };
}

function button(renderer: ReactTestRenderer, label: string) {
  return renderer.root.findAll(
    (n) => n.props.accessibilityLabel === label && typeof n.props.onPress === 'function',
  );
}

function rerouteButtons(renderer: ReactTestRenderer) {
  return renderer.root.findAll(
    (n) =>
      typeof n.props.accessibilityLabel === 'string' &&
      n.props.accessibilityLabel.startsWith('Reroute via ') &&
      typeof n.props.onPress === 'function',
  );
}

function textOf(renderer: ReactTestRenderer): string {
  return JSON.stringify(renderer.toJSON());
}

async function press(renderer: ReactTestRenderer, label: string) {
  const [node] = button(renderer, label);
  if (!node) throw new Error(`no button labelled ${label}`);
  await act(async () => {
    await node.props.onPress();
  });
}

describe('AgentInsightsPanel', () => {
  test('shows the walker message and the reasons for the decision', async () => {
    mockedPost.mockResolvedValue(response({}));
    const { renderer } = await renderPanel();
    const text = textOf(renderer);
    expect(text).toContain('Your route is the best choice tonight.');
    expect(text).toContain('The dark stretch is short.');
  });

  test('always shows the Keep my route option, for keep, switch and error', async () => {
    mockedPost.mockResolvedValueOnce(response({}));
    const keep = await renderPanel();
    expect(button(keep.renderer, 'Keep my route')).toHaveLength(1);

    mockedPost.mockResolvedValueOnce(
      response({ decision: { kind: 'switch', routeId: 'safe-route-1', reasons: ['x'] } }),
    );
    const sw = await renderPanel();
    expect(button(sw.renderer, 'Keep my route')).toHaveLength(1);

    mockedPost.mockRejectedValueOnce(new Error('offline'));
    const failed = await renderPanel();
    expect(button(failed.renderer, 'Keep my route')).toHaveLength(1);
  });

  test('shows Use this route only when the decision is switch', async () => {
    mockedPost.mockResolvedValueOnce(response({}));
    const keep = await renderPanel();
    expect(button(keep.renderer, 'Use this route')).toHaveLength(0);

    mockedPost.mockResolvedValueOnce(
      response({ decision: { kind: 'switch', routeId: 'safe-route-1', reasons: ['x'] } }),
    );
    const sw = await renderPanel();
    expect(button(sw.renderer, 'Use this route')).toHaveLength(1);
  });

  test('Use this route follows the recommended route when it differs from the best route', async () => {
    mockedPost.mockResolvedValue(
      response({ recommendedRouteId: 'safe-route-1', decision: { kind: 'keep', routeId: 'safe-route-0', reasons: [] } }),
    );
    const { renderer, onUseRoute } = await renderPanel();
    await press(renderer, 'Use this route');
    expect(onUseRoute).toHaveBeenCalledWith('safe-route-1');
  });

  test('tapping Use this route selects the switch route', async () => {
    mockedPost.mockResolvedValue(
      response({ decision: { kind: 'switch', routeId: 'safe-route-1', reasons: ['x'] } }),
    );
    const { renderer, onUseRoute } = await renderPanel();
    await press(renderer, 'Use this route');
    expect(onUseRoute).toHaveBeenCalledWith('safe-route-1');
  });

  test('tapping Keep my route closes the panel and selects nothing', async () => {
    mockedPost.mockResolvedValue(response({}));
    const { renderer, onClose, onUseRoute } = await renderPanel();
    await press(renderer, 'Keep my route');
    expect(onClose).toHaveBeenCalled();
    expect(onUseRoute).not.toHaveBeenCalled();
  });

  test('a question shows its choices, and choosing one calls the endpoint with the answer', async () => {
    mockedPost.mockResolvedValueOnce(
      response({
        question: {
          id: 'q1',
          text: 'Do you want a shorter walk?',
          choices: [
            { id: 'yes', label: 'Yes, shorter' },
            { id: 'no', label: 'No, keep it' },
          ],
        },
      }),
    );
    const { renderer } = await renderPanel();
    expect(textOf(renderer)).toContain('Do you want a shorter walk?');

    mockedPost.mockResolvedValueOnce(response({}));
    await press(renderer, 'Yes, shorter');
    expect(mockedPost).toHaveBeenLastCalledWith(
      expect.objectContaining({ answer: { questionId: 'q1', choiceId: 'yes' }, round: 1 }),
    );
  });

  test('offers one Reroute via option per proposed point, labelled with the client candidate label', async () => {
    mockedPost.mockResolvedValueOnce(
      response({
        actions: [
          { type: 'propose_reroute_via', candidateId: 'p1', label: 'Quick safe shortcut, tap Yes', requiresConfirmation: true },
        ],
      }),
    );
    const { renderer } = await renderPanel();
    expect(button(renderer, 'Reroute via Middle of the weakest stretch')).toHaveLength(1);
    expect(textOf(renderer)).not.toContain('Quick safe shortcut');
  });

  test('a failed follow-up clears the reroute options from the earlier answer', async () => {
    mockedPost.mockResolvedValueOnce(
      response({
        question: { id: 'q1', text: 'Shorter?', choices: [{ id: 'yes', label: 'Yes' }] },
        actions: [
          { type: 'propose_reroute_via', candidateId: 'p1', label: 'x', requiresConfirmation: true },
        ],
      }),
    );
    const { renderer } = await renderPanel();
    expect(button(renderer, 'Reroute via Middle of the weakest stretch')).toHaveLength(1);

    mockedPost.mockRejectedValueOnce(new Error('offline'));
    await press(renderer, 'Yes');
    expect(rerouteButtons(renderer)).toHaveLength(0);
  });

  test('offers no reroute option when the agent proposed none', async () => {
    mockedPost.mockResolvedValueOnce(response({}));
    const { renderer } = await renderPanel();
    expect(rerouteButtons(renderer)).toHaveLength(0);
  });

  test('shows no confirm prompt for a reroute; the options replace the yes/no step', async () => {
    mockedPost.mockResolvedValueOnce(
      response({
        actions: [{ type: 'propose_reroute_via', candidateId: 'p1', label: 'Middle', requiresConfirmation: true }],
      }),
    );
    const { renderer } = await renderPanel();
    expect(textOf(renderer)).not.toContain('Reroute via this point?');
    expect(button(renderer, 'Yes')).toHaveLength(0);
    expect(button(renderer, 'No')).toHaveLength(0);
  });

  test('tapping a reroute option sets the via pin once, closes the panel and says it is recalculating', async () => {
    mockedPost.mockResolvedValueOnce(
      response({
        actions: [{ type: 'propose_reroute_via', candidateId: 'p1', label: 'Middle', requiresConfirmation: true }],
      }),
    );
    const { renderer, onSetViaPin, onClose } = await renderPanel();
    await press(renderer, 'Reroute via Middle of the weakest stretch');
    expect(onSetViaPin).toHaveBeenCalledTimes(1);
    expect(onSetViaPin).toHaveBeenCalledWith({ latitude: 51.51, longitude: -0.12 });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(textOf(renderer)).toContain('Recalculating your route via Middle of the weakest stretch');
  });

  test('a show_findings action highlights the route on the agent map, not the walker map', async () => {
    const agent: MapController = {
      panTo: jest.fn(),
      zoomBy: jest.fn(),
      fitBounds: jest.fn(),
      highlight: jest.fn(() => true),
    };
    const main: MapController = {
      panTo: jest.fn(),
      zoomBy: jest.fn(),
      fitBounds: jest.fn(),
      highlight: jest.fn(() => true),
    };
    setMapController(agent, 'agent');
    setMapController(main);
    mockedPost.mockResolvedValueOnce(
      response({ actions: [{ type: 'show_findings', routeId: 'safe-route-0' }] }),
    );
    await renderPanel();
    expect(agent.highlight).toHaveBeenCalledWith('safe-route-0');
    expect(main.highlight).not.toHaveBeenCalled();
  });
});

describe('AgentInsightsPanel round loop (contract v3)', () => {
  test('round 1 carries a session number, round 1, no results and the agent map snapshot', async () => {
    mockedCapture.mockResolvedValue(SNAP_1);
    mockedPost.mockResolvedValueOnce(response({ status: 'done' }));
    await renderPanel();

    expect(mockedCapture).toHaveBeenCalledWith('agent');
    expect(mockedPost).toHaveBeenCalledTimes(1);
    expect(mockedPost).toHaveBeenCalledWith(
      expect.objectContaining({
        round: 1,
        results: [],
        snapshot: SNAP_1,
        sessionNumber: expect.any(Number),
      }),
    );
  });

  test('a continue status runs the actions on the agent map, then posts round 2 with their results and a new snapshot', async () => {
    const agent: MapController = {
      panTo: jest.fn(),
      zoomBy: jest.fn(),
      fitBounds: jest.fn(),
      highlight: jest.fn(() => true),
    };
    const main: MapController = {
      panTo: jest.fn(),
      zoomBy: jest.fn(),
      fitBounds: jest.fn(),
      highlight: jest.fn(() => true),
    };
    setMapController(agent, 'agent');
    setMapController(main);
    mockedCapture.mockResolvedValueOnce(SNAP_1).mockResolvedValueOnce(SNAP_2);
    mockedPost
      .mockResolvedValueOnce(
        response({ status: 'continue', actions: [{ type: 'pan_to', candidateId: 'p1' }] }),
      )
      .mockResolvedValueOnce(response({ status: 'done' }));
    await renderPanel();

    expect(agent.panTo).toHaveBeenCalledWith(51.51, -0.12, undefined);
    expect(main.panTo).not.toHaveBeenCalled();
    expect(mockedCapture).toHaveBeenNthCalledWith(2, 'agent');
    expect(mockedPost).toHaveBeenCalledTimes(2);
    const first = mockedPost.mock.calls[0][0];
    const second = mockedPost.mock.calls[1][0];
    expect(second).toEqual(
      expect.objectContaining({
        round: 2,
        results: [{ type: 'pan_to', ok: true }],
        snapshot: SNAP_2,
      }),
    );
    expect(second.sessionNumber).toBe(first.sessionNumber);
  });

  test('a done status ends the rounds after one request', async () => {
    mockedPost.mockResolvedValue(response({ status: 'done' }));
    await renderPanel();
    expect(mockedPost).toHaveBeenCalledTimes(1);
  });

  test('stops at round 5 even when the agent still says continue', async () => {
    mockedPost.mockResolvedValue(response({ status: 'continue' }));
    const { renderer } = await renderPanel();
    expect(mockedPost).toHaveBeenCalledTimes(5);
    expect(mockedPost.mock.calls[4][0]).toEqual(expect.objectContaining({ round: 5 }));
    expect(button(renderer, 'Keep my route')).toHaveLength(1);
  });

  test('the bubble status line says what the agent is doing: Checking the map, Looking at Route 2, then Done', async () => {
    // Hold the capture after round 1 so the state between the two rounds can be read.
    let releaseCapture: (value: string) => void = () => undefined;
    mockedCapture
      .mockResolvedValueOnce(SNAP_1)
      .mockImplementationOnce(
        () =>
          new Promise<string | null>((resolve) => {
            releaseCapture = (value) => resolve(value);
          }),
      );
    mockedPost
      .mockResolvedValueOnce(
        response({ status: 'continue', actions: [{ type: 'fit_route', routeId: 'safe-route-1' }] }),
      )
      .mockResolvedValueOnce(response({ status: 'done' }));

    await renderPanel({ context: mapContext });
    expect(mockStatusLog[mockStatusLog.length - 1]).toBe('Looking at Route 2');

    await act(async () => {
      releaseCapture(SNAP_2);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(mockStatusLog).toContain('Checking the map');
    expect(mockStatusLog[mockStatusLog.length - 1]).toBe('Done');
  });

  test('a failed round shows the failure text and no reroute options', async () => {
    mockedPost
      .mockResolvedValueOnce(
        response({
          status: 'continue',
          actions: [{ type: 'propose_reroute_via', candidateId: 'p1', label: 'x', requiresConfirmation: true }],
        }),
      )
      .mockRejectedValueOnce(new Error('offline'));
    const { renderer } = await renderPanel();

    expect(textOf(renderer)).toContain('Could not reach AI Insights right now. Your route is unchanged.');
    expect(rerouteButtons(renderer)).toHaveLength(0);
    expect(button(renderer, 'Use this route')).toHaveLength(0);
  });
});

describe('AgentInsightsPanel expand_search (E1)', () => {
  const fetchMock = fetchRouteThroughPoint as jest.MockedFunction<typeof fetchRouteThroughPoint>;

  // A route the agent's search found through a ring point: safety fields the client scorer reads.
  const foundRoute = (): SafeRoute =>
    ({
      id: 'raw',
      distanceMeters: 1100,
      durationSeconds: 900,
      encodedPolyline: '',
      path: [
        { latitude: 51.5, longitude: -0.13 },
        { latitude: 51.53, longitude: -0.09 },
      ],
      safety: { score: 74, label: 'Safe', color: '#0a0', mainRoadRatio: 40, worstStretch: null },
    }) as unknown as SafeRoute;

  test('an expand_search round adds the new routes to the next round body and to the agent map', async () => {
    const ringContext: AgentContext = {
      ...mapContext,
      candidates: [...mapContext.candidates, ...expansionRingPoints({ latitude: 51.51, longitude: -0.12 })],
    };
    fetchMock.mockResolvedValue(foundRoute());
    mockedCapture.mockResolvedValue(SNAP_1);
    mockedPost
      .mockResolvedValueOnce(response({ status: 'continue', actions: [{ type: 'expand_search', candidateIds: ['r1'] }] }))
      .mockResolvedValueOnce(response({ status: 'done' }));

    await renderPanel({ context: ringContext });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mockedPost).toHaveBeenCalledTimes(2);
    const second = mockedPost.mock.calls[1][0];
    expect(second.results).toEqual([{ type: 'expand_search', ok: true }]);
    expect(second.routes.map((r) => r.routeId)).toEqual(['expanded-route-1']);
    expect(second.routes[0].routeId.startsWith('expanded-route-')).toBe(true);
    // The map bubble is given the new route as well.
    expect(mockBubbleRoutes[mockBubbleRoutes.length - 1]).toHaveLength(1);
  });


  test('a recommended expanded route gives a Reroute option through its ring point, not Use this route', async () => {
    const ringPoints = expansionRingPoints({ latitude: 51.51, longitude: -0.12 });
    const east = ringPoints[2];
    const ringContext: AgentContext = {
      ...mapContext,
      candidates: [...mapContext.candidates, ...ringPoints],
    };
    fetchMock.mockResolvedValue(foundRoute());
    mockedCapture.mockResolvedValue(SNAP_1);
    mockedPost.mockResolvedValueOnce(
      response({
        status: 'done',
        actions: [{ type: 'expand_search', candidateIds: ['r3'] }],
        decision: { kind: 'switch', routeId: 'expanded-route-1', reasons: ['The east route is shorter.'] },
        recommendedRouteId: 'expanded-route-1',
      }),
    );

    const { renderer, onSetViaPin, onClose } = await renderPanel({ context: ringContext });

    expect(button(renderer, 'Use this route')).toHaveLength(0);
    expect(button(renderer, 'Reroute via East area')).toHaveLength(1);
    expect(button(renderer, 'Keep my route')).toHaveLength(1);

    await press(renderer, 'Reroute via East area');
    expect(onSetViaPin).toHaveBeenCalledTimes(1);
    expect(onSetViaPin).toHaveBeenCalledWith({ latitude: east.lat, longitude: east.lng });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

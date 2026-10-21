import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { AgentInsightsPanel } from '@/src/components/ui/AgentInsightsPanel';
import { postAgentInsights, type AgentContext, type AgentInsightsResponse } from '@/src/services/agentClient';
import { setMapController, type MapController } from '@/src/services/mapController';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/src/services/agentClient', () => {
  const actual = jest.requireActual('@/src/services/agentClient');
  return { ...actual, postAgentInsights: jest.fn() };
});

const mockedPost = postAgentInsights as jest.MockedFunction<typeof postAgentInsights>;

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
  ],
};

const response = (overrides: Partial<AgentInsightsResponse>): AgentInsightsResponse => ({
  analysis: { routes: [] },
  decision: { kind: 'keep', routeId: 'safe-route-0', reasons: ['The dark stretch is short.'] },
  message: 'Your route is the best choice tonight.',
  actions: [],
  ...overrides,
});

const mounted: ReactTestRenderer[] = [];

afterEach(() => {
  while (mounted.length) {
    const renderer = mounted.pop();
    act(() => {
      renderer?.unmount();
    });
  }
  mockedPost.mockReset();
  setMapController(null);
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
  // Let the request on open settle inside act, so its state updates are not left dangling.
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
    expect(mockedPost).toHaveBeenLastCalledWith({
      ...context.body,
      answer: { questionId: 'q1', choiceId: 'yes' },
    });
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

  test('a show_findings action highlights the route on the registered map', async () => {
    const controller: MapController = {
      panTo: jest.fn(),
      zoomBy: jest.fn(),
      fitBounds: jest.fn(),
      highlight: jest.fn(() => true),
    };
    setMapController(controller);
    mockedPost.mockResolvedValueOnce(
      response({ actions: [{ type: 'show_findings', routeId: 'safe-route-0' }] }),
    );
    await renderPanel();
    expect(controller.highlight).toHaveBeenCalledWith('safe-route-0');
  });
});

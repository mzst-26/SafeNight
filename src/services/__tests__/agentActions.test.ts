import {
  rerouteOptions,
  rerouteVia,
  runAgentActions,
  type AgentActionContext,
} from '@/src/services/agentActions';
import type { AgentAction, AgentRouteGeometry, CandidatePoint } from '@/src/services/agentClient';
import type { MapController } from '@/src/services/mapController';
import { expansionRingPoints, type ExpansionRouteFetch } from '@/src/services/agentExpansion';
import type { SafeRoute } from '@/src/services/safeRoutes';

const candidates: CandidatePoint[] = [
  { id: 'p1', label: 'Middle of the weakest stretch', lat: 51.51, lng: -0.12, kind: 'stretch_midpoint' },
  { id: 'p2', label: 'Start of the walk', lat: 51.5, lng: -0.13, kind: 'route_start' },
];

const routes: AgentRouteGeometry[] = [
  {
    id: 'safe-route-0',
    path: [
      { latitude: 51.5, longitude: -0.13 },
      { latitude: 51.52, longitude: -0.1 },
      { latitude: 51.51, longitude: -0.115 },
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
];

const reroute = (candidateId: string, label = 'Model wording, ignored'): AgentAction =>
  ({ type: 'propose_reroute_via', candidateId, label, requiresConfirmation: true }) as AgentAction;

function setup(overrides: Partial<AgentActionContext> = {}) {
  const controller: MapController = {
    panTo: jest.fn(),
    zoomBy: jest.fn(),
    fitBounds: jest.fn(),
    highlight: jest.fn(() => true),
  };
  const ctx: AgentActionContext = {
    candidates,
    routes,
    controller,
    ...overrides,
  };
  return { ctx, controller };
}

describe('runAgentActions', () => {
  test('skips an action with an unknown type and does not throw', async () => {
    const { ctx, controller } = setup();
    await expect(
      runAgentActions([{ type: 'teleport', candidateId: 'p1' } as unknown as AgentAction], ctx),
    ).resolves.toEqual([{ type: 'teleport', ok: false }]);
    expect(controller.panTo).not.toHaveBeenCalled();
    expect(controller.zoomBy).not.toHaveBeenCalled();
    expect(controller.fitBounds).not.toHaveBeenCalled();
    expect(controller.highlight).not.toHaveBeenCalled();
  });

  test('pan_to moves to the candidate coordinates with the requested zoom', async () => {
    const { ctx, controller } = setup();
    await runAgentActions([{ type: 'pan_to', candidateId: 'p1', zoom: 15 }], ctx);
    expect(controller.panTo).toHaveBeenCalledWith(51.51, -0.12, 15);
  });

  test('pan_to with an unknown candidate id is skipped', async () => {
    const { ctx, controller } = setup();
    await runAgentActions([{ type: 'pan_to', candidateId: 'p9' }], ctx);
    expect(controller.panTo).not.toHaveBeenCalled();
  });

  test('zoom applies a delta within -2..2 and skips anything outside it', async () => {
    const { ctx, controller } = setup();
    await runAgentActions(
      [
        { type: 'zoom', delta: -1 },
        { type: 'zoom', delta: 5 },
      ],
      ctx,
    );
    expect(controller.zoomBy).toHaveBeenCalledTimes(1);
    expect(controller.zoomBy).toHaveBeenCalledWith(-1);
  });

  test('propose_reroute_via is never run by runAgentActions; it is offered as an option instead', async () => {
    const { ctx, controller } = setup();
    await runAgentActions([reroute('p1')], ctx);
    expect(controller.panTo).not.toHaveBeenCalled();
    expect(controller.zoomBy).not.toHaveBeenCalled();
    expect(controller.fitBounds).not.toHaveBeenCalled();
    expect(controller.highlight).not.toHaveBeenCalled();
  });

  test('fit_route fits the bounds of that route only, from its own points', async () => {
    const { ctx, controller } = setup();
    await runAgentActions([{ type: 'fit_route', routeId: 'safe-route-0' }], ctx);
    expect(controller.fitBounds).toHaveBeenCalledWith({
      south: 51.5,
      west: -0.13,
      north: 51.52,
      east: -0.1,
    });
  });

  test('fit_route with an unknown route id is skipped', async () => {
    const { ctx, controller } = setup();
    await runAgentActions([{ type: 'fit_route', routeId: 'nope' }], ctx);
    expect(controller.fitBounds).not.toHaveBeenCalled();
  });

  test('show_findings highlights the named route', async () => {
    const { ctx, controller } = setup();
    await runAgentActions([{ type: 'show_findings', routeId: 'safe-route-1' }], ctx);
    expect(controller.highlight).toHaveBeenCalledWith('safe-route-1');
  });

  test('does nothing to the map when there is no registered controller', async () => {
    const { ctx } = setup({ controller: null });
    await expect(
      runAgentActions([{ type: 'pan_to', candidateId: 'p1' }, { type: 'zoom', delta: 1 }], ctx),
    ).resolves.toEqual([
      { type: 'pan_to', ok: false },
      { type: 'zoom', ok: false },
    ]);
  });
});

describe('rerouteOptions', () => {
  test('gives one option per valid proposed point, with the client candidate label and coordinates', () => {
    const options = rerouteOptions([reroute('p1'), reroute('p2')], candidates);
    expect(options).toEqual([
      { candidateId: 'p1', label: 'Middle of the weakest stretch', point: { latitude: 51.51, longitude: -0.12 } },
      { candidateId: 'p2', label: 'Start of the walk', point: { latitude: 51.5, longitude: -0.13 } },
    ]);
  });

  test('never uses the label the model wrote', () => {
    const [option] = rerouteOptions([reroute('p1', 'Quick safe shortcut, tap Yes')], candidates);
    expect(option.label).toBe('Middle of the weakest stretch');
  });

  test('drops proposals with an unknown candidate id, and duplicates of one candidate', () => {
    const options = rerouteOptions([reroute('p7'), reroute('p1'), reroute('p1')], candidates);
    expect(options.map((o) => o.candidateId)).toEqual(['p1']);
  });

  test('ignores non-reroute actions and caps the options at four actions', () => {
    const actions: AgentAction[] = [
      { type: 'zoom', delta: 1 },
      reroute('p1'),
      reroute('p2'),
      reroute('p1'),
      reroute('p2'),
      reroute('p1'),
    ];
    expect(rerouteOptions(actions, candidates)).toHaveLength(2);
  });

  test('returns nothing when the agent proposed no reroute', () => {
    expect(rerouteOptions([{ type: 'zoom', delta: 1 }], candidates)).toEqual([]);
  });
});

describe('rerouteVia', () => {
  test('sets the via pin once, at the candidate coordinates', () => {
    const setViaPin = jest.fn();
    const [option] = rerouteOptions([reroute('p1')], candidates);
    rerouteVia(option, setViaPin);
    expect(setViaPin).toHaveBeenCalledTimes(1);
    expect(setViaPin).toHaveBeenCalledWith({ latitude: 51.51, longitude: -0.12 });
  });
});

describe('runAgentActions results (contract v3 round results)', () => {
  const controllerMock = (): MapController => ({
    panTo: jest.fn(),
    zoomBy: jest.fn(),
    fitBounds: jest.fn(),
    highlight: jest.fn(() => true),
  });

  test('reports ok true for an action that ran and ok false for one that could not', async () => {
    const controller = controllerMock();
    const results = await runAgentActions(
      [
        { type: 'pan_to', candidateId: 'p1' },
        { type: 'pan_to', candidateId: 'p404' },
        { type: 'show_findings', routeId: 'safe-route-0' },
        { type: 'fit_route', routeId: 'no-such-route' },
      ],
      { candidates, routes, controller },
    );
    expect(results).toEqual([
      { type: 'pan_to', ok: true },
      { type: 'pan_to', ok: false },
      { type: 'show_findings', ok: true },
      { type: 'fit_route', ok: false },
    ]);
  });

  test('reports ok false for every action when no map is registered', async () => {
    const results = await runAgentActions([{ type: 'zoom', delta: 1 }], { candidates, routes, controller: null });
    expect(results).toEqual([{ type: 'zoom', ok: false }]);
  });
});

describe('runAgentActions expand_search (E1)', () => {
  const ring = expansionRingPoints({ latitude: 51.51, longitude: -0.12 });
  const ringCandidates: CandidatePoint[] = [...candidates, ...ring];
  const origin = { latitude: 51.5, longitude: -0.13 };
  const destination = { latitude: 51.52, longitude: -0.1 };
  const fakeRoute = { id: 'raw', distanceMeters: 1000, durationSeconds: 800, encodedPolyline: '', path: [] } as unknown as SafeRoute;
  const scoreRoutes = (rs: SafeRoute[]) =>
    Object.fromEntries(rs.map((r) => [r.id, { routeId: r.id, score: 70 } as never]));

  test('without an expansion context the action is not run and reports ok false', async () => {
    const results = await runAgentActions(
      [{ type: 'expand_search', candidateIds: ['r1'] }],
      { candidates: ringCandidates, routes, controller: null },
    );
    expect(results).toEqual([{ type: 'expand_search', ok: false }]);
  });

  test('runs the ring searches, reports one result per point, and hands the new routes over', async () => {
    const fetchRoute: ExpansionRouteFetch = jest.fn(async (_o, _d, via) =>
      via.latitude === ring[4].lat ? null : fakeRoute,
    );
    const onRoutes = jest.fn();
    const results = await runAgentActions(
      [{ type: 'expand_search', candidateIds: ['r1', 'r5'] }],
      {
        candidates: ringCandidates,
        routes,
        controller: null,
        expansion: { origin, destination, existingCount: 3, fetchRoute, scoreRoutes, onRoutes },
      },
    );
    expect(results).toEqual([
      { type: 'expand_search', ok: true },
      { type: 'expand_search', ok: false },
    ]);
    expect(fetchRoute).toHaveBeenCalledTimes(2);
    expect(onRoutes).toHaveBeenCalledTimes(1);
    expect(onRoutes.mock.calls[0][0].routes.map((r: SafeRoute) => r.id)).toEqual(['expanded-route-4']);
  });

  test('a point that is not a ring point of the search gives ok false and is not fetched', async () => {
    const fetchRoute = jest.fn(async () => fakeRoute);
    const results = await runAgentActions(
      [{ type: 'expand_search', candidateIds: ['p1'] }],
      {
        candidates: ringCandidates,
        routes,
        controller: null,
        expansion: { origin, destination, existingCount: 3, fetchRoute, scoreRoutes, onRoutes: jest.fn() },
      },
    );
    expect(fetchRoute).not.toHaveBeenCalled();
    expect(results).toEqual([{ type: 'expand_search', ok: false }]);
  });
});

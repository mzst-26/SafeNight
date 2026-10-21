import { runAgentActions, type AgentActionContext } from '@/src/services/agentActions';
import type { AgentAction, AgentRouteGeometry, CandidatePoint } from '@/src/services/agentClient';
import type { MapController } from '@/src/services/mapController';

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
    confirm: jest.fn(async () => true),
    setViaPin: jest.fn(),
    ...overrides,
  };
  return { ctx, controller };
}

describe('runAgentActions', () => {
  test('skips an action with an unknown type and does not throw', async () => {
    const { ctx, controller } = setup();
    await expect(
      runAgentActions([{ type: 'teleport', candidateId: 'p1' } as unknown as AgentAction], ctx),
    ).resolves.toBeUndefined();
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

  test('propose_reroute_via never calls the controller before confirm resolves yes', async () => {
    const { ctx, controller } = setup();
    let answer!: (value: boolean) => void;
    ctx.confirm = jest.fn(() => new Promise<boolean>((resolve) => (answer = resolve)));

    const run = runAgentActions(
      [{ type: 'propose_reroute_via', candidateId: 'p1', label: 'Stretch middle', requiresConfirmation: true }],
      ctx,
    );
    // Confirmation is still open: nothing has moved and no pin is set.
    await Promise.resolve();
    expect(ctx.confirm).toHaveBeenCalledTimes(1);
    expect(controller.panTo).not.toHaveBeenCalled();
    expect(ctx.setViaPin).not.toHaveBeenCalled();

    answer(true);
    await run;
    expect(ctx.setViaPin).toHaveBeenCalledWith({ latitude: 51.51, longitude: -0.12 });
    expect(controller.panTo).not.toHaveBeenCalled();
  });

  test('confirm no means nothing moves and no via pin is set', async () => {
    const { ctx, controller } = setup({ confirm: jest.fn(async () => false) });
    await runAgentActions(
      [{ type: 'propose_reroute_via', candidateId: 'p1', label: 'Stretch middle', requiresConfirmation: true }],
      ctx,
    );
    expect(ctx.confirm).toHaveBeenCalledTimes(1);
    expect(ctx.setViaPin).not.toHaveBeenCalled();
    expect(controller.panTo).not.toHaveBeenCalled();
  });

  test('propose_reroute_via with an unknown candidate never asks for confirmation', async () => {
    const { ctx } = setup();
    await runAgentActions(
      [{ type: 'propose_reroute_via', candidateId: 'p7', label: 'Nowhere', requiresConfirmation: true }],
      ctx,
    );
    expect(ctx.confirm).not.toHaveBeenCalled();
    expect(ctx.setViaPin).not.toHaveBeenCalled();
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
    ).resolves.toBeUndefined();
  });
});

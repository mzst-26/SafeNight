import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { RouteCard, confidenceTier, formatRouteDelta } from '@/src/components/routes/RouteCard';
import { riskToColor } from '@/src/components/maps/routeLayers';
import { textContrastProblems } from '@/src/utils/__tests__/contrastHelpers';
import type { RouteComparison } from '@/src/utils/routeComparison';
import type { RouteSafety, SafeRoute, SafetyBreakdown } from '@/src/services/safeRoutes';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
// safeRoutes.ts (imported for isV2SafeRoute) loads AsyncStorage at module scope.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const METRES_PER_MILE = 1609.344;

function makeRoute(overrides: { id?: string; isSafest?: boolean; safety?: Partial<RouteSafety> } = {}): SafeRoute {
  const safety: RouteSafety = {
    score: 67,
    label: 'Safe',
    color: '#16a34a',
    breakdown: {} as SafetyBreakdown,
    roadTypes: {},
    mainRoadRatio: 40,
    ...overrides.safety,
  };
  return {
    id: overrides.id ?? 'r1',
    routeIndex: 0,
    isSafest: overrides.isSafest ?? false,
    safety,
    safetySegments: [],
    distanceMeters: 3218,
    durationSeconds: 2340,
    summary: '',
    legs: [],
  } as unknown as SafeRoute;
}

function makeComparison(overrides: Partial<RouteComparison>): RouteComparison {
  return {
    routeId: 'r2',
    score: 62,
    certainty: null,
    reason: null,
    dataQuality: null,
    durationSec: 2400,
    distanceM: 2000,
    deltaScoreVsFastest: 0,
    deltaDistanceVsFastest: 0,
    ...overrides,
  };
}

function renderCard(props: Partial<React.ComponentProps<typeof RouteCard>> & { route: SafeRoute }): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      <RouteCard index={0} isSelected={false} onSelect={() => {}} {...props} />,
    );
  });
  return renderer;
}

/** All string children rendered as text, in order. */
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

function findByA11yLabel(renderer: ReactTestRenderer, label: string) {
  return renderer.root.findAll((n) => n.props?.accessibilityLabel === label);
}

describe('formatRouteDelta', () => {
  const recommendedOnFastest = makeComparison({
    routeId: 'rec',
    deltaDistanceVsFastest: 0,
    deltaScoreVsFastest: 0,
  });

  it('describes a longer, safer route against the recommended route', () => {
    const comparison = makeComparison({
      deltaDistanceVsFastest: METRES_PER_MILE * 0.6,
      deltaScoreVsFastest: 5,
    });
    expect(formatRouteDelta(comparison, recommendedOnFastest)).toBe('+0.6 mi · 5 pts safer');
  });

  it('describes a shorter, less safe route', () => {
    const comparison = makeComparison({
      deltaDistanceVsFastest: -METRES_PER_MILE * 0.4,
      deltaScoreVsFastest: -4,
    });
    expect(formatRouteDelta(comparison, recommendedOnFastest)).toBe('0.4 mi shorter · 4 pts lower');
  });

  it('is relative to the recommended route, not the fastest route', () => {
    const recommended = makeComparison({ routeId: 'rec', deltaDistanceVsFastest: 1000, deltaScoreVsFastest: 3 });
    const comparison = makeComparison({
      deltaDistanceVsFastest: 1000 + METRES_PER_MILE * 0.6,
      deltaScoreVsFastest: 8,
    });
    expect(formatRouteDelta(comparison, recommended)).toBe('+0.6 mi · 5 pts safer');
  });

  it('uses the singular for a one point difference', () => {
    const comparison = makeComparison({ deltaDistanceVsFastest: 0, deltaScoreVsFastest: 1 });
    expect(formatRouteDelta(comparison, recommendedOnFastest)).toBe('1 pt safer');
  });

  it('omits the distance part when the length difference rounds to zero', () => {
    const comparison = makeComparison({ deltaDistanceVsFastest: 10, deltaScoreVsFastest: -2 });
    expect(formatRouteDelta(comparison, recommendedOnFastest)).toBe('2 pts lower');
  });

  it('returns null when nothing differs', () => {
    expect(formatRouteDelta(makeComparison({}), recommendedOnFastest)).toBeNull();
  });

  it('returns null when a delta is missing, and never renders NaN', () => {
    const comparison = makeComparison({ deltaDistanceVsFastest: null, deltaScoreVsFastest: null });
    expect(formatRouteDelta(comparison, recommendedOnFastest)).toBeNull();
    const partial = makeComparison({ deltaDistanceVsFastest: METRES_PER_MILE, deltaScoreVsFastest: null });
    const text = formatRouteDelta(partial, recommendedOnFastest);
    expect(text).toBe('+1.0 mi');
    expect(text).not.toMatch(/NaN/);
  });
});

describe('RouteCard', () => {
  it('renders a v1 route exactly as before: no reason, delta, or confidence chip', () => {
    const route = makeRoute({ isSafest: true });
    const renderer = renderCard({
      route,
      comparison: makeComparison({ deltaScoreVsFastest: 5 }),
      recommendedComparison: makeComparison({ routeId: 'r1' }),
    });
    const texts = textNodes(renderer);
    expect(texts).toContain('Top Safety Score');
    expect(texts.join(' ')).not.toMatch(/safer|lower|Estimated|reason/);
    expect(findByA11yLabel(renderer, 'Lighting partly estimated')).toHaveLength(0);
  });

  it('shows the safety reason on the recommended v2 card', () => {
    const route = makeRoute({
      isSafest: true,
      safety: { reason: '+5 safer than fastest · avoids a 240 m unlit path', certainty: 0.8 },
    });
    const renderer = renderCard({ route });
    expect(textNodes(renderer)).toContain('+5 safer than fastest · avoids a 240 m unlit path');
  });

  it('shows the delta line on a non-recommended v2 card', () => {
    const route = makeRoute({ id: 'r2', safety: { score: 62, certainty: 0.8, reason: 'x' } });
    const renderer = renderCard({
      route,
      index: 1,
      comparison: makeComparison({
        routeId: 'r2',
        deltaDistanceVsFastest: METRES_PER_MILE * 0.6,
        deltaScoreVsFastest: 5,
      }),
      recommendedComparison: makeComparison({ routeId: 'r1', deltaDistanceVsFastest: 0, deltaScoreVsFastest: 0 }),
    });
    expect(textNodes(renderer)).toContain('+0.6 mi · 5 pts safer');
  });

  it('shows no delta line on a v1 non-recommended card', () => {
    const route = makeRoute({ id: 'r2', safety: { score: 62 } });
    const renderer = renderCard({
      route,
      index: 1,
      comparison: makeComparison({ deltaScoreVsFastest: 5, deltaDistanceVsFastest: 900 }),
      recommendedComparison: makeComparison({ routeId: 'r1', deltaScoreVsFastest: 0, deltaDistanceVsFastest: 0 }),
    });
    expect(textNodes(renderer).join(' ')).not.toMatch(/safer|lower|shorter|\+/);
  });

  it('shows an Estimated chip when certainty is below 0.4, the same threshold the map dashes at', () => {
    const route = makeRoute({ safety: { certainty: 0.3, reason: 'x' } });
    const renderer = renderCard({ route });
    expect(textNodes(renderer)).toContain('Estimated');
    expect(findByA11yLabel(renderer, 'Lighting partly estimated').length).toBeGreaterThan(0);
  });

  it('hides the Estimated chip at certainty 0.45, which the map still draws solid', () => {
    const route = makeRoute({ safety: { certainty: 0.45, reason: 'x' } });
    const renderer = renderCard({ route });
    expect(textNodes(renderer)).not.toContain('Estimated');
  });

  it('shows the Estimated chip at certainty exactly 0.39 and hides it at exactly 0.4', () => {
    expect(textNodes(renderCard({ route: makeRoute({ safety: { certainty: 0.39, reason: 'x' } }) }))).toContain('Estimated');
    expect(textNodes(renderCard({ route: makeRoute({ safety: { certainty: 0.4, reason: 'x' } }) }))).not.toContain('Estimated');
  });

  it('renders the recommended badge with #047857 text on #DCFCE7 at 12px or larger', () => {
    const renderer = renderCard({ route: makeRoute({ isSafest: true, safety: { reason: 'x', certainty: 0.8 } }) });
    const badge = renderer.root.findAll(
      (n) => n.type === Text && n.props.children === '★ Recommended',
    )[0];
    const style = StyleSheet.flatten(badge.props.style);
    expect(style.color).toBe('#047857');
    expect(style.fontSize).toBeGreaterThanOrEqual(12);
    const pill = badge.parent;
    expect(pill).not.toBeNull();
    expect(StyleSheet.flatten(pill!.props.style).backgroundColor.toUpperCase()).toBe('#DCFCE7');
  });

  it('keeps every route card text at 12px or larger', () => {
    const renderer = renderCard({
      route: makeRoute({ isSafest: true, safety: { reason: 'x', certainty: 0.3, dataQuality: { lighting: 'estimated' } } }),
    });
    const sizes = renderer.root
      .findAll((n) => n.type === Text)
      .map((n) => StyleSheet.flatten(n.props.style)?.fontSize)
      .filter((s): s is number => typeof s === 'number');
    expect(sizes.length).toBeGreaterThan(0);
    sizes.forEach((s) => expect(s).toBeGreaterThanOrEqual(12));
  });

  it('shows the Estimated chip when lighting data is estimated, even with high certainty', () => {
    const route = makeRoute({
      safety: { certainty: 0.9, reason: 'x', dataQuality: { lighting: 'estimated' } },
    });
    const renderer = renderCard({ route });
    expect(textNodes(renderer)).toContain('Estimated');
  });

  it('hides the Estimated chip when certainty is high and lighting is not estimated', () => {
    const route = makeRoute({
      safety: { certainty: 0.8, reason: 'x', dataQuality: { lighting: 'verified' } },
    });
    const renderer = renderCard({ route });
    expect(textNodes(renderer)).not.toContain('Estimated');
  });
});

describe('confidenceTier', () => {
  const safety = (certainty: number | null | undefined, lighting?: 'verified' | 'mixed' | 'estimated') =>
    ({ certainty, dataQuality: lighting ? { lighting } : undefined }) as Partial<RouteSafety>;

  it('is verified when lighting is verified and certainty is at least 0.6', () => {
    expect(confidenceTier(safety(0.6, 'verified') as RouteSafety)).toBe('verified');
    expect(confidenceTier(safety(0.95, 'verified') as RouteSafety)).toBe('verified');
  });

  it('is mostly mapped just under the verified line, at 0.59 with verified lighting', () => {
    expect(confidenceTier(safety(0.59, 'verified') as RouteSafety)).toBe('mostly');
  });

  it('is mostly mapped for mixed lighting when certainty is not below 0.4', () => {
    expect(confidenceTier(safety(0.9, 'mixed') as RouteSafety)).toBe('mostly');
  });

  it('is mostly mapped when certainty is 0.4 up to 0.6, lighting permitting', () => {
    expect(confidenceTier(safety(0.4) as RouteSafety)).toBe('mostly');
    expect(confidenceTier(safety(0.5, 'verified') as RouteSafety)).toBe('mostly');
  });

  it('is estimated when lighting is estimated, whatever the certainty', () => {
    expect(confidenceTier(safety(0.95, 'estimated') as RouteSafety)).toBe('estimated');
  });

  it('is estimated when certainty is below 0.4, even with mixed lighting', () => {
    expect(confidenceTier(safety(0.39, 'mixed') as RouteSafety)).toBe('estimated');
    expect(confidenceTier(safety(0) as RouteSafety)).toBe('estimated');
  });

  it('is null when there is nothing to say', () => {
    expect(confidenceTier({} as RouteSafety)).toBeNull();
    expect(confidenceTier(safety(null, 'verified') as RouteSafety)).toBeNull();
    expect(confidenceTier(safety(0.9) as RouteSafety)).toBeNull();
  });
});

describe('RouteCard confidence text', () => {
  it('shows Verified on a verified, confident v2 card', () => {
    const renderer = renderCard({
      route: makeRoute({ safety: { certainty: 0.8, reason: 'x', dataQuality: { lighting: 'verified' } } }),
    });
    expect(textNodes(renderer)).toContain('Verified');
  });

  it('shows Mostly mapped in place of the Estimated chip for mid certainty', () => {
    const renderer = renderCard({ route: makeRoute({ safety: { certainty: 0.5, reason: 'x' } }) });
    expect(textNodes(renderer)).toContain('Mostly mapped');
    expect(textNodes(renderer)).not.toContain('Estimated');
  });

  it('keeps the Estimated accessibility label on the estimated tier', () => {
    const renderer = renderCard({ route: makeRoute({ safety: { certainty: 0.2, reason: 'x' } }) });
    expect(findByA11yLabel(renderer, 'Lighting partly estimated').length).toBeGreaterThan(0);
  });

  it('sets the tier text at 12px', () => {
    const renderer = renderCard({ route: makeRoute({ safety: { certainty: 0.5, reason: 'x' } }) });
    const tier = renderer.root.findAll((n) => n.type === Text && n.props.children === 'Mostly mapped')[0];
    expect(StyleSheet.flatten(tier.props.style).fontSize).toBe(12);
  });
});

describe('RouteCard single encoding of safety colour', () => {
  const dotOf = (renderer: ReactTestRenderer) =>
    renderer.root.findAll((n) => n.type === View && StyleSheet.flatten(n.props.style)?.width === 6)[0];

  it('colours a v2 score dot from the map risk ramp, ignoring the backend band colour', () => {
    const renderer = renderCard({
      route: makeRoute({ safety: { score: 67, color: '#558B2F', certainty: 0.8, reason: 'x' } }),
    });
    expect(StyleSheet.flatten(dotOf(renderer).props.style).backgroundColor).toBe(riskToColor(1 - 67 / 100));
  });

  it('keeps the backend band colour on a v1 score dot', () => {
    const renderer = renderCard({ route: makeRoute({ safety: { score: 67, color: '#16a34a' } }) });
    expect(StyleSheet.flatten(dotOf(renderer).props.style).backgroundColor).toBe('#16a34a');
  });

  it('gives the score chip a 20% tint of the same colour as its dot', () => {
    const renderer = renderCard({
      route: makeRoute({ safety: { score: 20, color: '#558B2F', certainty: 0.8, reason: 'x' } }),
    });
    const dot = StyleSheet.flatten(dotOf(renderer).props.style).backgroundColor as string;
    const chip = dotOf(renderer).parent!;
    expect(StyleSheet.flatten(chip.props.style).backgroundColor).toBe(`${dot}20`);
  });
});

describe('RouteCard text contrast (WCAG AA, 4.5:1 against the real background)', () => {
  const comparison = (routeId: string, deltaScoreVsFastest: number, deltaDistanceVsFastest: number) =>
    makeComparison({ routeId, deltaScoreVsFastest, deltaDistanceVsFastest });

  it.each([
    ['v1 unselected', makeRoute({ safety: { color: '#558B2F' } }), {}],
    ['v1 recommended and selected', makeRoute({ isSafest: true, safety: { color: '#F9A825' } }), { isSelected: true }],
    [
      'v2 recommended, verified',
      makeRoute({ isSafest: true, safety: { reason: 'x', certainty: 0.9, dataQuality: { lighting: 'verified' } } }),
      {},
    ],
    [
      'v2 other route, selected with details and delta',
      makeRoute({ id: 'r2', safety: { score: 62, reason: 'x', certainty: 0.3 } }),
      {
        index: 1,
        isSelected: true,
        detailsPanel: <View />,
        comparison: comparison('r2', 5, 900),
        recommendedComparison: comparison('r1', 0, 0),
      },
    ],
    [
      'v2 recommended, selected, estimated',
      makeRoute({ isSafest: true, safety: { reason: 'x', certainty: 0.2 } }),
      { isSelected: true, detailsPanel: <View /> },
    ],
  ])('keeps every text colour at 4.5:1 or better: %s', (_name, route, extra) => {
    const renderer = renderCard({ route, ...(extra as object) });
    expect(textNodes(renderer).length).toBeGreaterThan(0);
    expect(textContrastProblems(renderer)).toEqual([]);
  });
});

describe('RouteCard timeline text', () => {
  const timeline = {
    leaveAtIso: '2026-10-21T17:10:00+01:00',
    arriveAtIso: '2026-10-21T17:50:00+01:00',
    darknessAtStart: 0,
    darknessAtArrival: 0.8,
    label: 'dark_by_arrival' as const,
  };

  it('shows the timeline summary when safety.timeline exists', () => {
    const r = renderCard({ route: makeRoute({ safety: { timeline } }) });
    expect(textNodes(r)).toContain('Leaves 17:10 · Arrives 17:50 · Dark by arrival');
  });

  it('renders nothing extra for a v1 route', () => {
    const r = renderCard({ route: makeRoute() });
    expect(textNodes(r).some((t) => t.startsWith('Leaves '))).toBe(false);
  });
});

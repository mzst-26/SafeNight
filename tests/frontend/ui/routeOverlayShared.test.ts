/**
 * @jest-environment jsdom
 */
import { BADGES_JS } from '@/src/components/maps/inline/badges';
import { CORE_JS } from '@/src/components/maps/inline/core';
import { FORMAT_JS } from '@/src/components/maps/inline/format';
import { LEGEND_JS } from '@/src/components/maps/inline/legend';
import { ROUTE_OVERLAY_CSS } from '@/src/components/maps/inline/overlayCss';
import { SCREEN_CLUSTER_JS } from '@/src/components/maps/inline/screenCluster';
import {
  RL_ATTRIBUTION_HEIGHT_PX,
  RL_DASH,
  RL_DASH_PX,
  RL_DASH_UNITS,
  RL_LEGEND_ATTRIBUTION_GAP_PX,
  RL_LINE_OPACITY,
  RL_LINE_WIDTH,
  RL_TOUCH_TARGET_PX,
} from '@/src/components/maps/mapConstants';
import { buildMapHtml } from '@/src/components/maps/RouteMap.native';
import { buildLeafletHtml } from '@/src/components/maps/RouteMap.web';
import { RISK_RAMP } from '@/src/components/maps/routeLayers';

jest.mock('react-native-webview', () => ({ WebView: () => null }));

/*
 * The shared inline pieces are evaluated exactly the way the map templates run them
 * (a plain script), against a real DOM. Both renderers interpolate these same strings,
 * so testing them here pins web and native together.
 */

type Shared = {
  safeLabel: (t: unknown) => string;
  rlColor: (c: unknown, fallback: string | null) => string | null;
  normalizePinColor: (c: unknown) => string;
  rlCrimeLabel: (n: number) => string;
  rlCrimeAria: (n: number) => string;
  rlPillAria: (i: number, t: string, sel: boolean) => string;
  rlBuildCrimeBadge: (n: number) => HTMLElement;
  rlBuildCallout: (t: string) => HTMLElement;
  rlBuildPill: (b: any, i: number, onSelect?: (id: string) => void) => HTMLElement;
  rlBuildLegend: (root: HTMLElement, opts?: { dashArray?: string }) => {
    update: (legend: any) => void;
    setVisible: (on: boolean) => void;
  };
};

function load(innerWidth = 420): Shared {
  const win = { innerWidth } as unknown as Window;
  return new Function(
    'window',
    'document',
    `${CORE_JS}${FORMAT_JS}${BADGES_JS}${LEGEND_JS}
return { safeLabel, rlColor, normalizePinColor, rlCrimeLabel, rlCrimeAria, rlPillAria,
  rlBuildCrimeBadge, rlBuildCallout, rlBuildPill, rlBuildLegend };`,
  )(win, document);
}

const ramp = (colors: string[]) => colors.map((color, i) => ({ from: i / 6, to: (i + 1) / 6, color }));

describe('shared inline core', () => {
  const shared = load();

  it('escapes markup characters', () => {
    expect(shared.safeLabel(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
    expect(shared.safeLabel(null)).toBe('');
  });

  it('whitelists six-digit hex colours only', () => {
    expect(shared.rlColor('#abcdef', null)).toBe('#abcdef');
    expect(shared.rlColor('#abc', 'x')).toBe('x');
    expect(shared.rlColor('"><img src=x>', 'x')).toBe('x');
    expect(shared.rlColor(5, 'x')).toBe('x');
  });

  it('accepts three- and six-digit pin colours and falls back to red', () => {
    expect(shared.normalizePinColor('#abc')).toBe('#abc');
    expect(shared.normalizePinColor(' #112233 ')).toBe('#112233');
    expect(shared.normalizePinColor('red')).toBe('#ef4444');
  });
});

describe('shared crime badge', () => {
  const shared = load();

  it('shows the count, caps the label at 99+ and switches to the large size from 100', () => {
    expect(shared.rlCrimeLabel(5)).toBe('5');
    expect(shared.rlCrimeLabel(99)).toBe('99');
    expect(shared.rlCrimeLabel(100)).toBe('99+');
    expect(shared.rlBuildCrimeBadge(99).className).toBe('rl-crime');
    expect(shared.rlBuildCrimeBadge(100).className).toBe('rl-crime rl-crime-lg');
    expect(shared.rlBuildCrimeBadge(250).textContent).toBe('99+');
  });

  it('is announced as an image with a pluralised crime count', () => {
    const one = shared.rlBuildCrimeBadge(1);
    expect(one.getAttribute('role')).toBe('img');
    expect(one.getAttribute('aria-label')).toBe('1 crime reported');
    expect(shared.rlBuildCrimeBadge(12).getAttribute('aria-label')).toBe('12 crimes reported');
    expect(shared.rlBuildCrimeBadge(150).getAttribute('aria-label')).toBe('150 crimes reported');
  });

  it('floors fractional counts', () => {
    expect(shared.rlBuildCrimeBadge(3.9).textContent).toBe('3');
  });
});

describe('shared callout', () => {
  it('sets the text as text, never as markup', () => {
    const el = load().rlBuildCallout('<b>Unlit</b> 240 m');
    expect(el.className).toBe('rl-callout');
    expect(el.textContent).toBe('<b>Unlit</b> 240 m');
    expect(el.querySelector('b')).toBeNull();
  });
});

describe('shared score pill', () => {
  const shared = load();
  const badge = (over: Record<string, unknown> = {}) => ({ routeId: 'r1', text: '62', selected: false, ...over });

  it('wraps a compact pill in a transparent hit area and labels it for assistive tech', () => {
    const hit = shared.rlBuildPill(badge(), 1);
    expect(hit.className).toBe('rl-pill-hit');
    expect(hit.querySelector('.rl-pill')?.textContent).toBe('62');
    expect(hit.getAttribute('role')).toBe('button');
    expect(hit.getAttribute('aria-label')).toBe('Route 2 score 62, tap to select');
    expect(shared.rlPillAria(0, '48', true)).toBe('Route 1 score 48, selected');
  });

  it('marks the selected pill instead of making it a button', () => {
    const hit = shared.rlBuildPill(badge({ selected: true }), 0);
    expect(hit.className).toContain('rl-pill-hit-sel');
    expect(hit.querySelector('.rl-pill-sel')).not.toBeNull();
    expect(hit.getAttribute('role')).toBeNull();
    expect(hit.getAttribute('aria-current')).toBe('true');
  });

  it('selects the route on tap for a non-selected pill only, and always swallows the tap', () => {
    const onSelect = jest.fn();
    const stop = { preventDefault: jest.fn(), stopPropagation: jest.fn() };

    const other = shared.rlBuildPill(badge(), 0, onSelect);
    other.dispatchEvent(Object.assign(new Event('click'), stop));
    expect(onSelect).toHaveBeenCalledWith('r1');

    onSelect.mockClear();
    const chosen = shared.rlBuildPill(badge({ selected: true }), 0, onSelect);
    chosen.dispatchEvent(new Event('click'));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('escapes pill text by construction (text node)', () => {
    const hit = shared.rlBuildPill(badge({ text: '<u>x</u>' }), 0);
    expect(hit.querySelector('u')).toBeNull();
    expect(hit.innerHTML).toContain('&lt;u&gt;');
  });
});

describe('shared overlay CSS', () => {
  it('sizes the pill 32x28 visually inside a >=44x44 hit area', () => {
    expect(ROUTE_OVERLAY_CSS).toMatch(/\.rl-pill-hit\{[^}]*min-width:44px;min-height:44px/);
    expect(ROUTE_OVERLAY_CSS).toMatch(/\.rl-pill\{[^}]*min-width:32px;height:28px/);
  });

  it('caps the legend at 200px wide', () => {
    expect(ROUTE_OVERLAY_CSS).toMatch(/\.rl-legend\{[^}]*max-width:min\(200px,46vw\)/);
  });

  it('makes the whole legend header row a full-width tap target of at least 44px', () => {
    const rule = ROUTE_OVERLAY_CSS.match(/\.rl-legend-head\{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toContain(`min-height:${RL_TOUCH_TARGET_PX}px`);
    expect(rule).toContain('width:100%');
    expect(rule).toContain('align-items:center');
    expect(rule).toContain('box-sizing:border-box');
  });

  it('keeps the legend compact: padding sits inside the header, not around the legend', () => {
    expect(ROUTE_OVERLAY_CSS).toMatch(/\.rl-legend\{[^}]*padding:0[;}]/);
    expect(ROUTE_OVERLAY_CSS).toMatch(/\.rl-legend-head\{[^}]*padding:0 10px/);
  });

  it('styles the persistent notes line at 12px', () => {
    expect(ROUTE_OVERLAY_CSS).toMatch(/\.rl-legend-notes\{[^}]*padding:/);
    expect(ROUTE_OVERLAY_CSS).toMatch(/\.rl-legend-note\{[^}]*font-size:12px/);
  });
});

describe('shared line constants', () => {
  it('derives the MapLibre dash units and the legend px pattern from the single RL_DASH string', () => {
    const [dot, gap] = RL_DASH.split(' ').map(Number);
    expect(RL_DASH_PX).toEqual([dot, gap]);
    expect(RL_DASH_UNITS[0] * RL_LINE_WIDTH).toBeCloseTo(dot, 10);
    expect(RL_DASH_UNITS[1] * RL_LINE_WIDTH).toBeCloseTo(gap, 10);
    // Same period on both renderers: Leaflet px pattern == MapLibre units * line width.
    expect((RL_DASH_UNITS[0] + RL_DASH_UNITS[1]) * RL_LINE_WIDTH).toBeCloseTo(dot + gap, 10);
  });

  it('shares one solid line opacity', () => {
    expect(RL_LINE_OPACITY).toBe(1);
  });

  it('keeps the legend bottom margin at least the attribution height plus 4px', () => {
    expect(RL_LEGEND_ATTRIBUTION_GAP_PX).toBeGreaterThanOrEqual(4);
    expect(RL_ATTRIBUTION_HEIGHT_PX).toBeGreaterThan(0);
  });
});

describe('shared legend', () => {
  const make = (width = 420, dashArray = '0.1 15') => {
    const shared = load(width);
    const root = document.createElement('div');
    const ctl = shared.rlBuildLegend(root, { dashArray });
    return { root, ctl, body: root.querySelector('.rl-legend-body') as HTMLElement };
  };
  const spec = (over: Record<string, unknown> = {}) => ({
    ramp: ramp([...RISK_RAMP]),
    dashedLabel: 'Dashed: estimated',
    ...over,
  });

  it('is a hidden labelled region whose header button controls the body', () => {
    const { root, body } = make();
    expect(root.style.display).toBe('none');
    expect(root.getAttribute('role')).toBe('region');
    expect(root.getAttribute('aria-label')).toBe('Route safety legend');
    const head = root.querySelector('.rl-legend-head') as HTMLElement;
    expect(head.getAttribute('aria-controls')).toBe(body.id);
    expect(head.getAttribute('aria-expanded')).toBe('false');
  });

  it('draws one discrete swatch per ramp colour, Safer on the left and Riskier on the right', () => {
    const { ctl, body } = make();
    ctl.update(spec());
    const swatches = Array.from(body.querySelectorAll('.rl-legend-swatch')) as HTMLElement[];
    expect(swatches).toHaveLength(6);
    expect(swatches.map((s) => s.style.background)).toHaveLength(6);
    expect(body.innerHTML).not.toContain('gradient');
    const labels = Array.from(body.querySelector('.rl-legend-scale')!.children).map((c) => c.textContent);
    expect(labels).toEqual(['Safer', 'Riskier']);
  });

  it('reads colours only from the spec and drops non six-digit-hex values', () => {
    const { ctl, body } = make();
    ctl.update(spec({ ramp: [{ color: '"><img src=x onerror=1>' }, { color: '#abcdef' }, { color: 'red' }] }));
    expect(body.querySelectorAll('.rl-legend-swatch')).toHaveLength(1);
    expect(body.querySelector('img')).toBeNull();
  });

  it('shows no swatch row without usable colours but keeps the dotted sample', () => {
    const { ctl, body } = make();
    ctl.update(spec({ ramp: [] }));
    expect(body.querySelector('.rl-legend-swatches')).toBeNull();
    expect(body.querySelector('.rl-legend-dash-label')?.textContent).toBe('Dashed: estimated');
  });

  it('uses the renderer dash pattern for the dotted sample and the default label as fallback', () => {
    const web = make(420, RL_DASH);
    web.ctl.update({});
    expect(web.body.querySelector('svg line')?.getAttribute('stroke-dasharray')).toBe(RL_DASH);
    expect(web.body.querySelector('.rl-legend-dash-label')?.textContent).toBe('Estimated lighting');

    const native = make(420, RL_DASH_PX.join(' '));
    native.ctl.update(spec());
    expect(native.body.querySelector('svg line')?.getAttribute('stroke-dasharray')).toBe(RL_DASH);
  });

  it('renders notes as text, at most four, in a persistent line outside the collapsible body', () => {
    const { root, ctl, body } = make();
    ctl.update(spec({ notes: ['<b>x</b>', 'b', 'c', 'd', 'e'] }));
    const notes = Array.from(root.querySelectorAll('.rl-legend-note'));
    expect(notes.map((n) => n.textContent)).toEqual(['<b>x</b>', 'b', 'c', 'd']);
    expect(root.querySelector('b')).toBeNull();
    expect(body.querySelector('.rl-legend-note')).toBeNull();
    const holder = root.querySelector('.rl-legend-notes') as HTMLElement;
    expect(holder.contains(notes[0])).toBe(true);
    expect(body.contains(holder)).toBe(false);
  });

  it('places the notes directly under the header, before the body', () => {
    const { root, ctl } = make();
    ctl.update(spec({ notes: ['Crime data unavailable'] }));
    const order = Array.from(root.children).map((c) => c.className.split(' ')[0]);
    expect(order).toEqual(['rl-legend-head', 'rl-legend-notes', 'rl-legend-body']);
  });

  it('shows a caveat dot on the collapsed button when there are notes, and the notes open with the legend', () => {
    const narrow = make(390);
    narrow.ctl.update(spec({ notes: ['Crime data unavailable'] }));
    narrow.ctl.setVisible(true);
    expect(narrow.root.classList.contains('rl-legend-collapsed')).toBe(true);
    expect(narrow.root.classList.contains('rl-legend-has-notes')).toBe(true);
    const head = narrow.root.querySelector('.rl-legend-head') as HTMLElement;
    expect(head.getAttribute('aria-label')).toBe('Route safety legend, has notes');
    head.click();
    const holder = narrow.root.querySelector('.rl-legend-notes') as HTMLElement;
    expect(holder.style.display).not.toBe('none');
    expect(holder.textContent).toBe('Crime data unavailable');
  });

  it('hides the notes line when there are no notes and clears stale notes on update', () => {
    const { root, ctl } = make();
    ctl.update(spec({ notes: ['old'] }));
    ctl.update(spec());
    const holder = root.querySelector('.rl-legend-notes') as HTMLElement;
    expect(holder.style.display).toBe('none');
    expect(root.querySelectorAll('.rl-legend-note')).toHaveLength(0);
  });

  it('starts collapsed at every width on first show and remembers the toggle', () => {
    for (const width of [390, 420]) {
      const { root, body, ctl } = make(width);
      ctl.setVisible(true);
      expect(root.style.display).toBe('');
      expect(root.classList.contains('rl-legend-collapsed')).toBe(true);
      expect(root.classList.contains('rl-legend-collapsed')).toBe(true);
    }
    const { root, body, ctl } = make(420);
    ctl.setVisible(true);
    const head = root.querySelector('.rl-legend-head') as HTMLElement;
    head.click();
    expect(root.classList.contains('rl-legend-collapsed')).toBe(false);
    expect(head.getAttribute('aria-expanded')).toBe('true');
    head.click();
    expect(root.classList.contains('rl-legend-collapsed')).toBe(true);
    expect(head.getAttribute('aria-expanded')).toBe('false');
    ctl.update(spec());
    ctl.setVisible(true);
    expect(root.classList.contains('rl-legend-collapsed')).toBe(true);
    ctl.setVisible(false);
    expect(root.style.display).toBe('none');
  });
});

describe('web and native templates share the same pieces', () => {
  const web = buildLeafletHtml(false);
  const native = buildMapHtml();
  const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

  it.each([
    ['core', CORE_JS],
    ['format', FORMAT_JS],
    ['badges', BADGES_JS],
    ['legend', LEGEND_JS],
    ['screen cluster', SCREEN_CLUSTER_JS],
    ['overlay css', ROUTE_OVERLAY_CSS],
  ])('interpolates the %s module verbatim into both templates', (_name, chunk) => {
    expect(web).toContain(chunk);
    expect(native).toContain(chunk);
  });

  it.each([
    'function safeLabel(',
    'function normalizePinColor(',
    'function rlBuildLegend(',
    'function rlBuildPill(',
    'function mergeScreenClusters(',
    'function separatePills(',
  ])(
    'defines %s exactly once per template',
    (decl) => {
      expect(count(web, decl)).toBe(1);
      expect(count(native, decl)).toBe(1);
    },
  );

  it('no longer carries the old per-renderer legend, pill and crime class names', () => {
    expect(web).not.toContain('rl-ramp');
    expect(native).not.toContain('rl-legend-bar');
    expect(native).not.toContain('rl-cluster');
    expect(web).not.toContain('rl-badge-sel');
  });
});

describe('map key and callout sizing', () => {
  it('explains the grey lines, the route score pills and the red crime circles in the legend body', () => {
    const shared = load(420);
    const root = document.createElement('div');
    shared.rlBuildLegend(root, { dashArray: '0.1 15' }).update({ ramp: [], dashedLabel: 'Dashed: estimated' });
    const text = root.querySelector('.rl-legend-key')!.textContent ?? '';
    expect(text).toContain('Grey line: other route options');
    expect(text).toContain('Number on a route: its safety score');
    expect(text).toContain('Red circle: reported crimes nearby');
  });

  it('sizes the callout to its text so the background covers the whole label', () => {
    expect(ROUTE_OVERLAY_CSS).toMatch(/\.rl-callout\{[^}]*width:max-content/);
  });
});

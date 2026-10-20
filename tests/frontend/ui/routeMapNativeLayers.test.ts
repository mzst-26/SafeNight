import fs from 'node:fs';
import path from 'node:path';

import {
  buildMapHtml,
  buildNativeRouteLayerCollections,
  NATIVE_MAP_ATTRIBUTION,
  RL_DASH_PX,
  RL_DASH_UNITS,
  RL_DEFAULT_DASHED_LABEL,
  RL_LINE_WIDTH,
  RL_REPLACED_KINDS,
  type NativeRouteLayerCollections,
} from '@/src/components/maps/RouteMap.native';
import { RISK_RAMP, type RouteLayerSpec } from '@/src/components/maps/routeLayers';

// The WebView native module is not available under jest; the map script is run against fakes below.
jest.mock('react-native-webview', () => ({ WebView: () => null }));

const nativeSource = fs.readFileSync(
  path.join(process.cwd(), 'src/components/maps/RouteMap.native.tsx'),
  'utf8',
);

// ── Fixtures ─────────────────────────────────────────────────────────────────

/** Builder-shaped spec: line coords are [lat, lng] (see routeLayers.ts buildLines). */
const spec: RouteLayerSpec = {
  lines: [
    { coords: [[51.5, -0.1], [51.501, -0.1]], risk: 0.1, color: RISK_RAMP[0], dashed: false },
    { coords: [[51.501, -0.1], [51.502, -0.1]], risk: 0.9, color: RISK_RAMP[5], dashed: true },
    { coords: [[51.502, -0.1], [51.503, -0.1]], risk: 0.5, color: RISK_RAMP[2], dashed: false },
  ],
  callouts: [{ lat: 51.5015, lng: -0.1, text: 'Unlit stretch · 240 m', kind: 'worst-stretch' }],
  crimeClusters: [
    { lat: 51.5, lng: -0.11, count: 12, maxSeverity: 0.7 },
    { lat: 51.51, lng: -0.12, count: 3, maxSeverity: 0.4 },
  ],
  points: [
    { kind: 'light', lat: 51.5005, lng: -0.1 },
    { kind: 'cctv', lat: 51.5006, lng: -0.1 },
    { kind: 'shop', lat: 51.5007, lng: -0.1 },
  ],
  legend: {
    ramp: RISK_RAMP.map((color, i) => ({ from: i / 6, to: (i + 1) / 6, color })),
    dashedLabel: 'Dashed: estimated lighting or low certainty',
  },
};

const emptySpec: RouteLayerSpec = {
  lines: [],
  callouts: [],
  crimeClusters: [],
  points: [],
  legend: { ramp: [], dashedLabel: '' },
};

// ── Pure helper: RouteLayerSpec -> GeoJSON FeatureCollections ────────────────

describe('buildNativeRouteLayerCollections (pure)', () => {
  it('emits every line in casing and splits solid from dashed', () => {
    const c: NativeRouteLayerCollections = buildNativeRouteLayerCollections(spec, null);
    expect(c.casing.features).toHaveLength(3);
    expect(c.solid.features).toHaveLength(2);
    expect(c.dashed.features).toHaveLength(1);
    expect(c.solid.features.map((f) => f.properties.color)).toEqual([RISK_RAMP[0], RISK_RAMP[2]]);
    expect(c.dashed.features[0].properties.color).toBe(RISK_RAMP[5]);
  });

  it('never puts a dashed line into the solid collection', () => {
    const c = buildNativeRouteLayerCollections(spec, null);
    const solidColours = c.solid.features.map((f) => f.properties.color);
    expect(solidColours).not.toContain(RISK_RAMP[5]);
  });

  it('converts builder [lat, lng] coordinates to GeoJSON [lng, lat]', () => {
    const c = buildNativeRouteLayerCollections(spec, null);
    expect(c.solid.features[0].geometry).toEqual({
      type: 'LineString',
      coordinates: [
        [-0.1, 51.5],
        [-0.1, 51.501],
      ],
    });
  });

  it('emits crime only as cluster badges with count labels, never individual crime features', () => {
    const c = buildNativeRouteLayerCollections(spec, null);
    expect(c.clusters.features).toHaveLength(2);
    expect(c.clusters.features.map((f) => f.properties.label)).toEqual(['12', '3']);
    expect(c.clusters.features[0].properties.count).toBe(12);
    expect(c.clusters.features[0].properties.maxSeverity).toBe(0.7);
    expect(Object.keys(c).sort()).toEqual(
      ['callouts', 'casing', 'clusters', 'dashed', 'points', 'solid'],
    );
  });

  it('caps crime badge labels at 99+ like the web renderer', () => {
    const big: RouteLayerSpec = {
      ...spec,
      crimeClusters: [{ lat: 51.5, lng: -0.11, count: 120, maxSeverity: 0.7 }],
    };
    const c = buildNativeRouteLayerCollections(big, null);
    expect(c.clusters.features[0].properties.label).toBe('99+');
    expect(c.clusters.features[0].properties.count).toBe(120);
  });

  it('emits the worst-stretch callout text unchanged', () => {
    const c = buildNativeRouteLayerCollections(spec, null);
    expect(c.callouts.features).toHaveLength(1);
    expect(c.callouts.features[0].properties.text).toBe('Unlit stretch · 240 m');
    expect(c.callouts.features[0].geometry.coordinates).toEqual([-0.1, 51.5015]);
  });

  it('always includes lights (the layer minzoom gates them) and gates cctv and shops on highlight', () => {
    const none = buildNativeRouteLayerCollections(spec, null);
    expect(none.points.features.map((f) => f.properties.kind)).toEqual(['light']);

    const cctv = buildNativeRouteLayerCollections(spec, 'cctv');
    expect(cctv.points.features.map((f) => f.properties.kind)).toEqual(['light', 'cctv']);

    const shop = buildNativeRouteLayerCollections(spec, 'shop');
    expect(shop.points.features.map((f) => f.properties.kind)).toEqual(['light', 'shop']);
  });

  it('flags the highlighted category for emphasis (larger radius in the renderer)', () => {
    const c = buildNativeRouteLayerCollections(spec, 'cctv');
    const byKind = Object.fromEntries(c.points.features.map((f) => [f.properties.kind, f.properties.emph]));
    expect(byKind).toEqual({ light: 0, cctv: 1 });
  });

  it('drops non-finite coordinates instead of throwing', () => {
    const bad: RouteLayerSpec = {
      ...spec,
      lines: [{ coords: [[Number.NaN, -0.1], [51.6, -0.1]], risk: 0.2, color: RISK_RAMP[0], dashed: false }],
      crimeClusters: [{ lat: Number.POSITIVE_INFINITY, lng: 0, count: 2, maxSeverity: 0.4 }],
    };
    const c = buildNativeRouteLayerCollections(bad, null);
    expect(c.casing.features).toHaveLength(0);
    expect(c.clusters.features).toHaveLength(0);
  });

  it('returns empty collections for an empty spec', () => {
    const c = buildNativeRouteLayerCollections(emptySpec, null);
    for (const fc of [c.casing, c.solid, c.dashed, c.clusters, c.callouts, c.points]) {
      expect(fc).toEqual({ type: 'FeatureCollection', features: [] });
    }
  });
});

// ── Source inspection: supply chain and legacy path ──────────────────────────

describe('RouteMap.native MapLibre supply chain', () => {
  it('pins maplibre-gl to the exact 4.7.1 release, not a floating major', () => {
    expect(nativeSource).toContain('https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js');
    expect(nativeSource).toContain('https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css');
    expect(nativeSource).not.toContain('maplibre-gl@4/');
  });

  it('carries verified SRI hashes (sha384) for the pinned script and stylesheet', () => {
    expect(nativeSource).toContain(
      'integrity="sha384-SYKAG6cglRMN0RVvhNeBY0r3FYKNOJtznwA0v7B5Vp9tr31xAHsZC0DqkQ/pZDmj"',
    );
    expect(nativeSource).toContain(
      'integrity="sha384-MinO0mNliZ3vwppuPOUnGa+iq619pfMhLVUXfC4LHwSCvF9H+6P/KO4Q7qBOYV5V"',
    );
    expect(nativeSource).toMatch(/maplibre-gl\.js"[^>]*crossorigin="anonymous"/);
    expect(nativeSource).toMatch(/maplibre-gl\.css"[^>]*crossorigin="anonymous"/);
  });

  it('leaves the WebView originWhitelist unchanged', () => {
    expect(nativeSource).toContain('originWhitelist={["*"]}');
  });
});

describe('RouteMap.native legacy path (routeLayers null) is untouched', () => {
  it('keeps the legacy unselected, segment and safety-circle paint values', () => {
    expect(nativeSource).toContain(
      "paint:{'line-color':'#98a2b3','line-opacity':0.5,'line-width':5}",
    );
    expect(nativeSource).toContain(
      "paint:{'line-color':['get','color'],'line-opacity':0.9,'line-width':7}",
    );
    expect(nativeSource).toContain("map.addLayer({ id:'safety-circles', type:'circle', source:'safety-markers',");
  });

  it('keeps legacy segment drawing as the default source of route-segments', () => {
    expect(nativeSource).toContain(
      "map.getSource('route-segments').setData({type:'FeatureCollection',features:segF});",
    );
    expect(nativeSource).toContain('if(data.segments&&data.segments.length>0){');
  });
});

// ── Fake MapLibre + DOM: runs the real inline map script ─────────────────────

type Listener = (ev?: any) => void;
type Point = { x: number; y: number };
type RenderFn = (point: Point, layers: string[]) => Array<{ properties: Record<string, unknown> }>;

class FakeEl {
  tagName: string;
  id: string;
  className = '';
  parentElement: FakeEl | null = null;
  children: FakeEl[] = [];
  listeners: Record<string, Listener[]> = {};
  attributes: Record<string, string> = {};
  style: Record<string, any> = {};
  private text = '';
  private html = '';

  constructor(tag = 'div', id = '') {
    this.tagName = tag;
    this.id = id;
  }

  get textContent(): string {
    return this.text;
  }

  set textContent(value: string) {
    this.text = String(value);
    this.html = '';
    this.children = [];
  }

  get innerHTML(): string {
    return this.html;
  }

  set innerHTML(value: string) {
    this.html = String(value);
    this.text = '';
    this.children = [];
  }

  get classList() {
    const self = this;
    const classes = () => self.className.split(/\s+/).filter(Boolean);
    const write = (list: string[]) => {
      self.className = list.join(' ');
    };
    return {
      contains: (c: string) => classes().includes(c),
      add: (c: string) => write(Array.from(new Set([...classes(), c]))),
      remove: (c: string) => write(classes().filter((x) => x !== c)),
      toggle: (c: string, force?: boolean) => {
        const has = classes().includes(c);
        const next = force === undefined ? !has : force;
        write(next ? Array.from(new Set([...classes(), c])) : classes().filter((x) => x !== c));
        return next;
      },
    };
  }

  setAttribute(key: string, value: string) {
    this.attributes[key] = String(value);
  }

  getAttribute(key: string) {
    return this.attributes[key] ?? null;
  }

  addEventListener(ev: string, fn: Listener) {
    (this.listeners[ev] ??= []).push(fn);
  }

  appendChild(child: FakeEl) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  querySelector() {
    return null;
  }

  remove() {
    /* detached */
  }
}

const chain = (): any => {
  const fn: any = function () {
    return fn;
  };
  return new Proxy(fn, {
    get: (target, prop) => (prop in target ? target[prop as any] : (target[prop as any] = chain())),
    apply: () => fn,
  });
};

const quietConsole = { log: () => undefined, warn: () => undefined, error: () => undefined };

function loadNativeMap(opts: { innerWidth?: number } = {}) {
  const script = buildMapHtml().match(/<script>([\s\S]*?)<\/script>/)?.[1];
  if (!script) throw new Error('inline map script not found in buildMapHtml output');

  const posted: Array<{ type: string; [k: string]: any }> = [];
  const markers: FakeMarker[] = [];
  const layers: any[] = [];
  const sources: Record<string, { data: any; setData: (d: any) => void }> = {};
  const handlers: Array<{ ev: string; layer?: string; fn: Listener }> = [];
  let rendered: RenderFn = () => [];

  class FakeMarker {
    options: any;
    ll: any = null;
    constructor(options: any) {
      this.options = options;
    }
    setLngLat(ll: any) {
      this.ll = ll;
      return this;
    }
    addTo() {
      markers.push(this);
      return this;
    }
    remove() {
      const i = markers.indexOf(this);
      if (i >= 0) markers.splice(i, 1);
    }
    getElement() {
      return this.options.element;
    }
    setSubpixelPositioning() {
      /* no-op */
    }
    getLngLat() {
      return this.ll;
    }
  }

  const explicit: Record<string, any> = {
    on: (ev: string, a: any, b?: any) => {
      if (typeof a === 'function') handlers.push({ ev, fn: a });
      else handlers.push({ ev, layer: a, fn: b });
      return map;
    },
    once: (ev: string, fn: Listener) => {
      handlers.push({ ev, fn });
      return map;
    },
    addSource: (id: string, spec: { data: any }) => {
      const src = {
        data: spec.data,
        setData: (d: any) => {
          src.data = d;
        },
      };
      sources[id] = src;
    },
    getSource: (id: string) => sources[id],
    addLayer: (spec: any) => {
      layers.push(spec);
      return map;
    },
    getLayer: (id: string) => layers.find((l) => l.id === id),
    getStyle: () => ({ layers: [] }),
    queryRenderedFeatures: (point: Point, o?: { layers?: string[] }) =>
      rendered(point, o?.layers ?? []),
    getZoom: () => 13,
    getCenter: () => ({ lat: 51.5, lng: -0.12 }),
    getCanvas: () => ({ style: {} }),
  };
  const map: any = new Proxy(explicit, {
    get: (target, prop) => (prop in target ? target[prop as any] : (target[prop as any] = chain())),
  });

  function MapCtor() {
    return map;
  }
  function NavigationControl() {
    /* no-op */
  }
  const maplibregl = { Map: MapCtor, Marker: FakeMarker, NavigationControl };

  const elements: Record<string, FakeEl> = {};
  const doc = {
    body: new FakeEl('body'),
    createElement: (tag: string) => new FakeEl(tag),
    getElementById: (id: string) => (elements[id] ??= new FakeEl('div', id)),
  };
  const win = {
    innerWidth: opts.innerWidth ?? 420,
    innerHeight: 800,
    addEventListener: () => undefined,
    ReactNativeWebView: { postMessage: (s: string) => posted.push(JSON.parse(s)) },
  };

  const page = new Function(
    'window',
    'document',
    'maplibregl',
    'console',
    'requestAnimationFrame',
    'setTimeout',
    'clearTimeout',
    'setInterval',
    'clearInterval',
    `${script}\nreturn { updateMap: updateMap };`,
  )(win, doc, maplibregl, quietConsole, () => 0, () => 0, () => undefined, () => 0, () => undefined);

  // The style is "loaded": run the same 'load' handler the real map runs.
  handlers.filter((h) => h.ev === 'load').forEach((h) => h.fn({}));

  const lngLat = { lat: 51.5, lng: -0.1 };

  return {
    updateMap: (data: Record<string, any>) => page.updateMap(data),
    posted,
    markers,
    layers,
    elements,
    sourceData: (id: string) => sources[id]?.data,
    setRendered: (fn: RenderFn) => {
      rendered = fn;
    },
    /** Fires a map event the way MapLibre does: layer-specific listeners, then general ones. */
    fire: (ev: string, point: Point) => {
      handlers
        .filter((h) => h.ev === ev && h.layer)
        .forEach((h) => h.fn({ point, lngLat, features: rendered(point, [h.layer as string]) }));
      handlers
        .filter((h) => h.ev === ev && !h.layer)
        .forEach((h) => h.fn({ point, lngLat }));
    },
    layerSpec: (id: string) => layers.find((l) => l.id === id),
    markersWithClass: (cls: string) =>
      markers.filter((m) => String(m.options.element?.className ?? '').split(/\s+/).includes(cls)),
  };
}

type NativeHarness = ReturnType<typeof loadNativeMap>;

const layerPayload = (s: RouteLayerSpec = spec, highlight: string | null = null) => ({
  ...buildNativeRouteLayerCollections(s, highlight),
  highlightCategory: highlight,
  legend: s.legend,
});

const baseData = (over: Record<string, any> = {}) => ({
  origin: null,
  destination: null,
  routes: [],
  segments: [],
  safetyMarkers: [],
  roadLabels: [],
  showExtraDetail: false,
  fitBounds: false,
  friendMarkers: [],
  routeLayers: null,
  routeBadges: [],
  ...over,
});

const selectRouteMessages = (h: NativeHarness) =>
  h.posted.filter((m) => m.type === 'selectRoute').map((m) => m.id);

// ── Paint and layer configuration (checked on the layer objects the script adds) ──

describe('RouteMap.native routeLayers paint (MapLibre layer specs)', () => {
  let h: NativeHarness;
  beforeEach(() => {
    h = loadNativeMap();
  });

  it('draws a white casing (width 11, opacity 0.9) under the colour-driven solid line', () => {
    expect(h.layerSpec('rl-casing').paint).toMatchObject({
      'line-color': '#ffffff',
      'line-width': 11,
      'line-opacity': 0.9,
    });
    expect(h.layerSpec('rl-solid').paint['line-color']).toEqual(['get', 'color']);
  });

  it('draws dashed estimated lines with round caps and the line-width-multiple dash pattern [0.1, 2.1]', () => {
    expect(RL_DASH_UNITS).toEqual([0.1, 2.1]);
    expect(h.layerSpec('rl-dashed').paint['line-dasharray']).toEqual([0.1, 2.1]);
    expect(h.layerSpec('rl-dashed').layout['line-cap']).toBe('round');
    expect(h.layerSpec('rl-dashed').paint['line-width']).toBe(RL_LINE_WIDTH);
  });

  it('renders unselected routes #667085 at width 4, opacity 1, with a 40px wide invisible hit layer', () => {
    expect(h.layerSpec('rl-unselected-line').paint).toMatchObject({
      'line-color': '#667085',
      'line-opacity': 1,
      'line-width': 4,
    });
    expect(h.layerSpec('rl-unselected-hit').paint).toMatchObject({ 'line-width': 40, 'line-opacity': 0 });
  });

  it('gates lights by minzoom 17 and lets a light highlight show them at any zoom', () => {
    expect(h.layerSpec('rl-lights').minzoom).toBe(17);
    expect(nativeSource).toMatch(/setLayerZoomRange\('rl-lights'/);
  });

  it('gates cctv and shop points on the highlighted category in the builder, and sends the highlight to the WebView', () => {
    expect(nativeSource).toContain('p.kind === "light" || p.kind === highlight');
    expect(nativeSource).toContain('highlightCategory: p.highlightCategory ?? null,');
    expect(h.layerSpec('rl-cctv').paint['circle-color']).toBe('#8b5cf6');
    expect(h.layerSpec('rl-shop').paint['circle-color']).toBe('#22c55e');
  });
});

// ── Tap precedence: the selected route wins over the wide unselected hit layer ──

describe('RouteMap.native tap handling in routeLayers mode', () => {
  it('gives the selected route precedence over the wide unselected hit layer', () => {
    const h = loadNativeMap();
    h.updateMap(baseData({ routeLayers: layerPayload() }));
    h.setRendered((_p, layers) => {
      if (layers.includes('rl-solid')) return [{ properties: {} }];
      if (layers.includes('rl-unselected-hit')) return [{ properties: { routeId: 'b' } }];
      return [];
    });
    h.fire('click', { x: 10, y: 10 });
    expect(selectRouteMessages(h)).toEqual([]);
    // A tap on the selected route is a plain map press, as on the legacy path.
    expect(h.posted.filter((m) => m.type === 'press')).toHaveLength(1);
  });

  it('selects the unselected route under the finger when no selected-route feature is there', () => {
    const h = loadNativeMap();
    h.updateMap(baseData({ routeLayers: layerPayload() }));
    h.setRendered((_p, layers) =>
      layers.includes('rl-unselected-hit') ? [{ properties: { routeId: 'b' } }] : [],
    );
    h.fire('click', { x: 10, y: 10 });
    expect(selectRouteMessages(h)).toEqual(['b']);
    expect(h.posted.find((m) => m.type === 'press')).toBeUndefined();
  });

  it('still reports a plain map press when nothing route-related is under the finger', () => {
    const h = loadNativeMap();
    h.updateMap(baseData({ routeLayers: layerPayload() }));
    h.setRendered(() => []);
    h.fire('click', { x: 10, y: 10 });
    expect(selectRouteMessages(h)).toEqual([]);
    expect(h.posted.filter((m) => m.type === 'press')).toHaveLength(1);
  });
});

// ── Route score badges (routeBadges prop) ────────────────────────────────────

describe('RouteMap.native route badges', () => {
  const badges = [
    { routeId: 'a', lat: 51.5, lng: -0.1, text: '62', selected: true },
    { routeId: 'b', lat: 51.51, lng: -0.1, text: '48', selected: false },
  ];

  it('renders one pill per route in routeLayers mode, with the selected one emphasised', () => {
    const h = loadNativeMap();
    h.updateMap(baseData({ routeLayers: layerPayload(), routeBadges: badges }));
    const pills = h.markersWithClass('rl-route-badge');
    expect(pills.map((m) => m.options.element.textContent)).toEqual(['62', '48']);
    expect(pills[0].options.element.className).toContain('selected');
    expect(pills[1].options.element.className).not.toContain('selected');
  });

  it('does not draw route badges outside routeLayers mode', () => {
    const h = loadNativeMap();
    h.updateMap(baseData({ routeLayers: null, routeBadges: badges }));
    expect(h.markersWithClass('rl-route-badge')).toHaveLength(0);
  });

  it('tapping a non-selected badge posts selectRoute for its routeId, and the selected badge does nothing', () => {
    const h = loadNativeMap();
    h.updateMap(baseData({ routeLayers: layerPayload(), routeBadges: badges }));
    const [selectedPill, otherPill] = h.markersWithClass('rl-route-badge');
    const stop = { stopPropagation: () => undefined, preventDefault: () => undefined };
    selectedPill.options.element.listeners.click[0](stop);
    expect(selectRouteMessages(h)).toEqual([]);
    otherPill.options.element.listeners.click[0](stop);
    expect(selectRouteMessages(h)).toEqual(['b']);
  });

  it('wires routeBadges into the React update payload and its effect dependencies', () => {
    expect(nativeSource).toMatch(/routeBadges: p\.routeBadges/);
    expect(nativeSource).toMatch(/highlightCategory,\s*routeBadges,\s*pushUpdate,/);
    expect(nativeSource).toMatch(/propsRef\.current = \{[\s\S]*?routeBadges,/);
  });
});

// ── Crime badges and worst-stretch callout ───────────────────────────────────

describe('RouteMap.native crime badges and callout', () => {
  it('sizes a normal crime badge as the 32px class and a 100+ badge as the large class with a 99+ label', () => {
    const h = loadNativeMap();
    const big: RouteLayerSpec = {
      ...spec,
      crimeClusters: [
        { lat: 51.5, lng: -0.11, count: 12, maxSeverity: 0.7 },
        { lat: 51.51, lng: -0.12, count: 120, maxSeverity: 0.4 },
      ],
    };
    h.updateMap(baseData({ routeLayers: layerPayload(big) }));
    const badges = h.markersWithClass('rl-cluster');
    expect(badges.map((m) => m.options.element.textContent)).toEqual(['12', '99+']);
    expect(badges[0].options.element.className).toBe('rl-cluster');
    expect(badges[1].options.element.className).toContain('rl-cluster-lg');
  });

  it('places the callout as a white pill 10px above the stretch midpoint (bottom anchor, offset -10)', () => {
    const h = loadNativeMap();
    h.updateMap(baseData({ routeLayers: layerPayload() }));
    const [callout] = h.markersWithClass('rl-callout');
    expect(callout.options.element.textContent).toBe('Unlit stretch · 240 m');
    expect(callout.options.anchor).toBe('bottom');
    expect(callout.options.offset).toEqual([0, -10]);
    expect(callout.ll).toEqual([-0.1, 51.5015]);
  });

  it('keeps the crime and callout CSS aligned with the web sizes', () => {
    const css = buildMapHtml();
    const rule = (sel: string) => css.match(new RegExp(`(?:^|[\\s}])${sel.replace(/\./g, '\\.')}\\{[^}]*\\}`))?.[0] ?? '';
    const cluster = rule('.rl-cluster');
    expect(cluster).toContain('min-width:32px');
    expect(cluster).toContain('font-size:13px');
    expect(cluster).toContain('font-weight:700');
    expect(rule('.rl-cluster.rl-cluster-lg')).toMatch(/width:36px/);
    const callout = rule('.rl-callout');
    expect(callout).toContain('background:#fff');
    expect(callout).toContain('font-size:13px');
    expect(callout).toContain('font-weight:600');
    expect(callout).toContain('border-radius:999px');
  });
});

// ── Legend ───────────────────────────────────────────────────────────────────

describe('RouteMap.native legend', () => {
  it('uses the dashed legend label from the spec, with the estimated-lighting fallback', () => {
    expect(RL_DEFAULT_DASHED_LABEL).toBe('Estimated lighting');
    const h = loadNativeMap();
    h.updateMap(baseData({ routeLayers: layerPayload() }));
    expect(h.elements['rlLegendDashLabel'].textContent).toBe('Dashed: estimated lighting or low certainty');

    const fallback = loadNativeMap();
    fallback.updateMap(baseData({ routeLayers: layerPayload({ ...spec, legend: { ...spec.legend, dashedLabel: '' } }) }));
    expect(fallback.elements['rlLegendDashLabel'].textContent).toBe('Estimated lighting');
  });

  it('renders legend notes as separate text lines (never markup)', () => {
    const h = loadNativeMap();
    const withNotes = { ...spec, legend: { ...spec.legend, notes: ['First note', '<b>Second</b>'] } } as RouteLayerSpec;
    h.updateMap(baseData({ routeLayers: layerPayload(withNotes) }));
    const notes = h.elements['rlLegendNotes'].children;
    expect(notes.map((n) => n.textContent)).toEqual(['First note', '<b>Second</b>']);
    expect(notes.every((n) => n.className === 'rl-legend-note')).toBe(true);
  });

  it('shows the legend only in routeLayers mode', () => {
    const h = loadNativeMap();
    h.updateMap(baseData({ routeLayers: layerPayload() }));
    expect(h.elements['rlLegend'].className).toContain('on');
    h.updateMap(baseData({ routeLayers: null }));
    expect(h.elements['rlLegend'].className).not.toContain('on');
  });

  it('starts collapsed when the viewport is narrower than 400px and expanded otherwise', () => {
    const narrow = loadNativeMap({ innerWidth: 390 });
    narrow.updateMap(baseData({ routeLayers: layerPayload() }));
    expect(narrow.elements['rlLegend'].className).toContain('collapsed');

    const wide = loadNativeMap({ innerWidth: 420 });
    wide.updateMap(baseData({ routeLayers: layerPayload() }));
    expect(wide.elements['rlLegend'].className).not.toContain('collapsed');
  });

  it('toggles collapsed from the header button', () => {
    const h = loadNativeMap({ innerWidth: 420 });
    h.updateMap(baseData({ routeLayers: layerPayload() }));
    const toggle = h.elements['rlLegendToggle'];
    toggle.listeners.click[0]({ preventDefault: () => undefined, stopPropagation: () => undefined });
    expect(h.elements['rlLegend'].className).toContain('collapsed');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('draws the dashed swatch with the same pattern as the map (line-width multiples converted to px)', () => {
    expect(RL_DASH_PX).toEqual([0.7, 14.7]);
    expect(buildMapHtml()).toContain('stroke-dasharray="0.7 14.7"');
    expect(buildMapHtml()).not.toContain('stroke-dasharray="0.1 12"');
  });

  it('sets the legend text sizes to at least 12px', () => {
    const css = buildMapHtml();
    expect(css).toMatch(/\.rl-legend\{[^}]*font-size:1[2-9]px/);
    expect(css).toMatch(/\.rl-legend-note\{[^}]*font-size:1[2-9]px/);
    expect(css).toMatch(/\.rl-legend\{[^}]*left:12px/);
  });
});

// ── Attribution ──────────────────────────────────────────────────────────────

describe('RouteMap.native attribution', () => {
  it('credits MapTiler and OpenStreetMap, the providers of the style and tiles', () => {
    expect(NATIVE_MAP_ATTRIBUTION).toBe('© MapTiler © OpenStreetMap contributors');
    expect(buildMapHtml()).toContain(`class="rl-attrib"`);
    expect(buildMapHtml()).toContain(`>${NATIVE_MAP_ATTRIBUTION}</div>`);
  });

  it('is always visible, bottom-right, 11px, and click-through', () => {
    const css = buildMapHtml();
    const rule = css.match(/\.rl-attrib\{[^}]*\}/)?.[0] ?? '';
    expect(rule).toContain('pointer-events:none');
    expect(rule).toMatch(/right:\d+px/);
    expect(rule).toMatch(/bottom:\d+px/);
    expect(rule).toContain('font-size:11px');
    expect(rule).not.toContain('display:none');
  });

  it('sits below the legend so it never overlaps it', () => {
    const css = buildMapHtml();
    const attribBottom = Number(css.match(/\.rl-attrib\{[^}]*bottom:(\d+)px/)?.[1]);
    const legendBottom = Number(css.match(/\.rl-legend\{[^}]*bottom:(\d+)px/)?.[1]);
    // 11px text with 2px padding is about 16px tall.
    expect(attribBottom + 18).toBeLessThanOrEqual(legendBottom);
  });
});

// ── Friend names are text, never markup ──────────────────────────────────────

describe('RouteMap.native friend labels', () => {
  it('renders a friend name containing markup as literal text', () => {
    const h = loadNativeMap();
    h.updateMap(
      baseData({
        friendMarkers: [{ userId: 'u1', name: '<u>x</u>', lat: 51.5, lng: -0.1, path: [], routePath: [] }],
      }),
    );
    const [friend] = h.markersWithClass('friend-marker');
    const label = friend.options.element.children.find((c: { className: string }) =>
      c.className === 'friend-label',
    );
    expect(label?.textContent).toBe('<u>x</u>');
    expect(friend.options.element.innerHTML).not.toContain('<u>x</u>');
  });
});

// ── Markers replaced by the route layers ─────────────────────────────────────

describe('RouteMap.native safety markers in routeLayers mode', () => {
  const kinds = ['crime', 'shop', 'light', 'bus_stop', 'cctv', 'dead_end', 'via'];
  const markers = kinds.map((kind, i) => ({
    id: `m-${kind}`,
    kind,
    label: kind,
    lat: 51.5 + i * 0.001,
    lng: -0.1,
  }));
  const candidate = {
    id: 'search-candidate:1',
    kind: 'search_candidate',
    label: 'Cafe',
    lat: 51.52,
    lng: -0.1,
    pinColor: '#ef4444',
    isSelected: false,
  };

  it('hides crime, light, cctv, shop, bus_stop, dead_end and via, as the web renderer does', () => {
    expect(RL_REPLACED_KINDS).toEqual(['crime', 'light', 'cctv', 'shop', 'bus_stop', 'dead_end', 'via']);
    const h = loadNativeMap();
    h.updateMap(baseData({ routeLayers: layerPayload(), safetyMarkers: [...markers, candidate] }));
    const drawn = (h.sourceData('safety-markers').features as Array<{ properties: { kind: string } }>).map(
      (f) => f.properties.kind,
    );
    expect(drawn).toEqual(['search_candidate']);
  });

  it('still draws every safety marker kind on the legacy path', () => {
    const h = loadNativeMap();
    h.updateMap(baseData({ routeLayers: null, safetyMarkers: markers }));
    const drawn = (h.sourceData('safety-markers').features as Array<{ properties: { kind: string } }>).map(
      (f) => f.properties.kind,
    );
    expect(drawn.sort()).toEqual([...kinds].sort());
  });
});

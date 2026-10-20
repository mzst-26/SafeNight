import fs from 'node:fs';
import path from 'node:path';

import {
  NATIVE_MAP_ATTRIBUTION as SHARED_NATIVE_ATTRIBUTION,
  OSM_ATTRIBUTION,
  RL_DASH,
  RL_DASH_PX,
  RL_DASH_UNITS,
  RL_DEFAULT_DASHED_LABEL,
  RL_FALLBACK_BLUE,
  RL_LINE_OPACITY,
  RL_LINE_WIDTH,
  RL_RELAYOUT_DEBOUNCE_MS,
  RL_REPLACED_KINDS,
} from '@/src/components/maps/mapConstants';
import {
  buildMapHtml,
  buildNativeRouteLayerCollections,
  NATIVE_MAP_ATTRIBUTION,
  type NativeRouteLayerCollections,
} from '@/src/components/maps/RouteMap.native';
import { FakeEl } from './helpers/fakeDom';
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
    expect(c.clusters.features.map((f) => f.properties.count)).toEqual([12, 3]);
    expect(c.clusters.features[0].properties.count).toBe(12);
    expect(c.clusters.features[0].properties.maxSeverity).toBe(0.7);
    expect(Object.keys(c).sort()).toEqual(
      ['callouts', 'casing', 'clusters', 'dashed', 'points', 'solid'],
    );
  });

  it('passes the raw cluster count through (the shared inline badge builder caps the label at 99+)', () => {
    const big: RouteLayerSpec = {
      ...spec,
      crimeClusters: [{ lat: 51.5, lng: -0.11, count: 120, maxSeverity: 0.7 }],
    };
    const c = buildNativeRouteLayerCollections(big, null);
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
type RenderFn = (point: Point, layers: string[]) => { properties: Record<string, unknown> }[];

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

function loadNativeMap(
  opts: {
    innerWidth?: number;
    zoom?: number;
    /** Maps [lng, lat] to container pixels; defaults to Web Mercator scale 256 * 2^zoom / 360 px per degree. */
    project?: ((lngLat: [number, number], zoom: number) => Point) | null;
  } = {},
) {
  const script = buildMapHtml().match(/<script>([\s\S]*?)<\/script>/)?.[1];
  if (!script) throw new Error('inline map script not found in buildMapHtml output');

  const posted: { type: string; [k: string]: any }[] = [];
  const markers: FakeMarker[] = [];
  const layers: any[] = [];
  const sources: Record<string, { data: any; setData: (d: any) => void }> = {};
  const handlers: { ev: string; layer?: string; fn: Listener }[] = [];
  let rendered: RenderFn = () => [];
  const state = { zoom: opts.zoom ?? 13 };
  const timers = new Map<number, { fn: () => void; ms: number }>();
  let timerId = 0;
  const project =
    opts.project ||
    (([lng, lat]: [number, number], zoom: number): Point => {
      const perDeg = (256 * 2 ** zoom) / 360;
      return { x: lng * perDeg, y: -lat * perDeg };
    });

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
    getZoom: () => state.zoom,
    getPitch: () => 0,
    project: (ll: [number, number]) => project(ll, state.zoom),
    getCenter: () => ({ lat: 51.5, lng: -0.12 }),
    getCanvas: () => ({ style: {} }),
  };
  if (opts.project === null) delete explicit.project;
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
  )(
    win,
    doc,
    maplibregl,
    quietConsole,
    () => 0,
    (fn: () => void, ms: number) => {
      timers.set(++timerId, { fn, ms });
      return timerId;
    },
    (id: number) => {
      timers.delete(id);
    },
    () => 0,
    () => undefined,
  );

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
    setZoom: (z: number) => {
      state.zoom = z;
    },
    /** Fires a general (non-layer) map event, e.g. zoomend or moveend. */
    fireMapEvent: (ev: string) => handlers.filter((h) => h.ev === ev && !h.layer).forEach((h) => h.fn({})),
    pendingRelayouts: () => Array.from(timers.values()).filter((t) => t.ms === RL_RELAYOUT_DEBOUNCE_MS).length,
    /** Runs the debounced overlay relayout timers only; other page timers stay pending. */
    flushRelayout: () => {
      Array.from(timers.entries())
        .filter(([, t]) => t.ms === RL_RELAYOUT_DEBOUNCE_MS)
        .forEach(([id, t]) => {
          timers.delete(id);
          t.fn();
        });
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

  it('draws solid and dashed lines at the same opacity as the web renderer (one shared constant)', () => {
    expect(h.layerSpec('rl-solid').paint['line-opacity']).toBe(RL_LINE_OPACITY);
    expect(h.layerSpec('rl-dashed').paint['line-opacity']).toBe(RL_LINE_OPACITY);
    expect(RL_LINE_OPACITY).toBe(1);
  });

  it('draws dashed estimated lines with round caps and the line-width-multiple dash pattern derived from RL_DASH', () => {
    const [dot, gap] = RL_DASH.split(' ').map(Number);
    expect(RL_DASH_UNITS[0]).toBeCloseTo(dot / RL_LINE_WIDTH, 12);
    expect(RL_DASH_UNITS[1]).toBeCloseTo(gap / RL_LINE_WIDTH, 12);
    expect(h.layerSpec('rl-dashed').paint['line-dasharray']).toEqual(RL_DASH_UNITS);
    expect(h.layerSpec('rl-dashed').layout['line-cap']).toBe('round');
    expect(h.layerSpec('rl-dashed').paint['line-width']).toBe(RL_LINE_WIDTH);
  });

  it('renders unselected routes #667085 at width 4, opacity 1, with a 44px wide invisible hit layer (touch target)', () => {
    expect(h.layerSpec('rl-unselected-line').paint).toMatchObject({
      'line-color': '#667085',
      'line-opacity': 1,
      'line-width': 4,
    });
    expect(h.layerSpec('rl-unselected-hit').paint).toMatchObject({ 'line-width': 44, 'line-opacity': 0 });
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
    const pills = h.markersWithClass('rl-pill-hit');
    expect(pills.map((m) => m.options.element.textContent)).toEqual(['62', '48']);
    expect(pills[0].options.element.className).toContain('rl-pill-hit-sel');
    expect(pills[1].options.element.className).not.toContain('rl-pill-hit-sel');
    expect(pills[0].options.element.querySelector('.rl-pill-sel')).not.toBeNull();
  });

  it('does not draw route badges outside routeLayers mode', () => {
    const h = loadNativeMap();
    h.updateMap(baseData({ routeLayers: null, routeBadges: badges }));
    expect(h.markersWithClass('rl-pill-hit')).toHaveLength(0);
  });

  it('tapping a non-selected badge posts selectRoute for its routeId, and the selected badge does nothing', () => {
    const h = loadNativeMap();
    h.updateMap(baseData({ routeLayers: layerPayload(), routeBadges: badges }));
    const [selectedPill, otherPill] = h.markersWithClass('rl-pill-hit');
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
    const badges = h.markersWithClass('rl-crime');
    expect(badges.map((m) => m.options.element.textContent)).toEqual(['12', '99+']);
    expect(badges[0].options.element.className).toBe('rl-crime');
    expect(badges[1].options.element.className).toContain('rl-crime-lg');
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

  it('uses the shared overlay CSS: crime 32px (36px large) at 13px bold, callout a 13px 600-weight glass pill', () => {
    const css = buildMapHtml();
    const rule = (sel: string) => css.match(new RegExp(`(?:^|[\\s}])${sel.replace(/\./g, '\\.')}\\{[^}]*\\}`))?.[0] ?? '';
    const crime = rule('.rl-crime');
    expect(crime).toContain('width:32px');
    expect(crime).toContain('font:700 13px');
    expect(rule('.rl-crime-lg')).toContain('width:36px');
    const callout = rule('.rl-callout');
    expect(callout).toContain("background:rgba(255,255,255,.7)");
    expect(callout).toContain('font:600 13px');
    expect(callout).toContain('border-radius:999px');
  });

  it('announces crime badges as images with their count', () => {
    const h = loadNativeMap();
    h.updateMap(baseData({ routeLayers: layerPayload() }));
    const badges = h.markersWithClass('rl-crime');
    expect(badges.map((m) => m.options.element.getAttribute('aria-label'))).toEqual([
      '12 crimes reported',
      '3 crimes reported',
    ]);
    expect(badges[0].options.element.getAttribute('role')).toBe('img');
  });

  it('gives each pill a >=44px transparent hit area, a compact visible pill and an aria label', () => {
    const css = buildMapHtml();
    expect(css).toMatch(/\.rl-pill-hit\{[^}]*min-width:44px;min-height:44px/);
    expect(css).toMatch(/\.rl-pill\{[^}]*min-width:32px;height:28px/);
    const h = loadNativeMap();
    h.updateMap(
      baseData({
        routeLayers: layerPayload(),
        routeBadges: [
          { routeId: 'a', lat: 51.5, lng: -0.1, text: '62', selected: true },
          { routeId: 'b', lat: 51.51, lng: -0.1, text: '48', selected: false },
        ],
      }),
    );
    const [first, second] = h.markersWithClass('rl-pill-hit').map((m) => m.options.element);
    expect(first.getAttribute('aria-label')).toBe('Route 1 score 62, selected');
    expect(second.getAttribute('aria-label')).toBe('Route 2 score 48, tap to select');
    expect(second.getAttribute('role')).toBe('button');
  });
});

// ── Legend ───────────────────────────────────────────────────────────────────

describe('RouteMap.native legend', () => {
  const legendRoot = (h: NativeHarness) => h.elements['rlLegend'];
  const body = (h: NativeHarness) => legendRoot(h).querySelector('.rl-legend-body');

  it('uses the dashed legend label from the spec, with the estimated-lighting fallback', () => {
    expect(RL_DEFAULT_DASHED_LABEL).toBe('Estimated lighting');
    const h = loadNativeMap();
    h.updateMap(baseData({ routeLayers: layerPayload() }));
    expect(body(h)!.querySelector('.rl-legend-dash-label')!.textContent).toBe(
      'Dashed: estimated lighting or low certainty',
    );

    const fallback = loadNativeMap();
    fallback.updateMap(baseData({ routeLayers: layerPayload({ ...spec, legend: { ...spec.legend, dashedLabel: '' } }) }));
    expect(body(fallback)!.querySelector('.rl-legend-dash-label')!.textContent).toBe('Estimated lighting');
  });

  it('renders legend notes as separate text lines (never markup)', () => {
    const h = loadNativeMap();
    const withNotes = { ...spec, legend: { ...spec.legend, notes: ['First note', '<b>Second</b>'] } } as RouteLayerSpec;
    h.updateMap(baseData({ routeLayers: layerPayload(withNotes) }));
    const notes = legendRoot(h).querySelectorAll('.rl-legend-note');
    expect(notes.map((n) => n.textContent)).toEqual(['First note', '<b>Second</b>']);
    expect(body(h)!.querySelectorAll('.rl-legend-note')).toHaveLength(0);
  });

  it('draws six discrete swatches from spec.legend.ramp with Safer on the left and Riskier on the right', () => {
    const h = loadNativeMap();
    h.updateMap(baseData({ routeLayers: layerPayload() }));
    const swatches = body(h)!.querySelectorAll('.rl-legend-swatch');
    expect(swatches.map((sw) => sw.style.background)).toEqual([...RISK_RAMP]);
    expect(body(h)!.querySelector('.rl-legend-scale')!.children.map((c) => c.textContent)).toEqual(['Safer', 'Riskier']);
    expect(body(h)!.innerHTML).not.toContain('gradient');
  });

  it('exposes a labelled region whose toggle controls the body', () => {
    const h = loadNativeMap();
    h.updateMap(baseData({ routeLayers: layerPayload() }));
    expect(legendRoot(h).getAttribute('role')).toBe('region');
    expect(legendRoot(h).getAttribute('aria-label')).toBe('Route safety legend');
    const head = legendRoot(h).querySelector('.rl-legend-head')!;
    expect(head.getAttribute('aria-controls')).toBe(body(h)!.id);
  });

  it('shows the legend only in routeLayers mode', () => {
    const h = loadNativeMap();
    h.updateMap(baseData({ routeLayers: layerPayload() }));
    expect(legendRoot(h).style.display).toBe('');
    h.updateMap(baseData({ routeLayers: null }));
    expect(legendRoot(h).style.display).toBe('none');
  });

  it('starts collapsed at every width and expands from the header button', () => {
    for (const innerWidth of [390, 420]) {
      const h = loadNativeMap({ innerWidth });
      h.updateMap(baseData({ routeLayers: layerPayload() }));
      expect(legendRoot(h).className).toContain('rl-legend-collapsed');
      expect(legendRoot(h).querySelector('.rl-legend-head')!.getAttribute('aria-expanded')).toBe('false');
    }
  });

  it('toggles from the header button and keeps the state across updates', () => {
    const h = loadNativeMap({ innerWidth: 420 });
    h.updateMap(baseData({ routeLayers: layerPayload() }));
    const toggle = legendRoot(h).querySelector('.rl-legend-head')!;
    const press = () => toggle.listeners.click[0]({ preventDefault: () => undefined, stopPropagation: () => undefined });
    press();
    expect(legendRoot(h).className).not.toContain('rl-legend-collapsed');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    h.updateMap(baseData({ routeLayers: layerPayload() }));
    expect(legendRoot(h).className).not.toContain('rl-legend-collapsed');
    press();
    expect(legendRoot(h).className).toContain('rl-legend-collapsed');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('draws the dashed swatch with the same pattern as the map (line-width multiples converted to px)', () => {
    expect(RL_DASH_PX).toEqual([0.1, 15]);
    const h = loadNativeMap();
    h.updateMap(baseData({ routeLayers: layerPayload() }));
    expect(body(h)!.innerHTML).toContain(`stroke-dasharray="${RL_DASH}"`);
    // Each dash period (units * line width) equals the px pattern the web renderer uses.
    expect((RL_DASH_UNITS[0] + RL_DASH_UNITS[1]) * RL_LINE_WIDTH).toBeCloseTo(15.1, 10);
  });

  it('sets the legend text sizes to at least 12px, at most 200px wide, placed bottom-left', () => {
    const css = buildMapHtml();
    expect(css).toMatch(/\.rl-legend\{[^}]*font:600 1[2-9]px/);
    expect(css).toMatch(/\.rl-legend-note\{[^}]*font-size:1[2-9]px/);
    expect(css).toMatch(/\.rl-legend\{[^}]*max-width:min\(200px,46vw\)/);
    expect(css).toMatch(/\.rl-legend\{[^}]*left:12px/);
  });
});

// ── Attribution ──────────────────────────────────────────────────────────────

describe('RouteMap.native attribution', () => {
  it('credits MapTiler and OpenStreetMap, the providers of the style and tiles', () => {
    expect(NATIVE_MAP_ATTRIBUTION).toBe('© MapTiler © OpenStreetMap contributors');
    expect(NATIVE_MAP_ATTRIBUTION).toBe(SHARED_NATIVE_ATTRIBUTION);
    expect(NATIVE_MAP_ATTRIBUTION.endsWith(OSM_ATTRIBUTION)).toBe(true);
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
    const drawn = (h.sourceData('safety-markers').features as { properties: { kind: string } }[]).map(
      (f) => f.properties.kind,
    );
    expect(drawn).toEqual(['search_candidate']);
  });

  it('still draws every safety marker kind on the legacy path', () => {
    const h = loadNativeMap();
    h.updateMap(baseData({ routeLayers: null, safetyMarkers: markers }));
    const drawn = (h.sourceData('safety-markers').features as { properties: { kind: string } }[]).map(
      (f) => f.properties.kind,
    );
    expect(drawn.sort()).toEqual([...kinds].sort());
  });
});

// ── updateMap split into per-concern functions: smoke ────────────────────────

describe('RouteMap.native updateMap concerns', () => {
  it('renders navigation, friends, the selected candidate card and the range circle without throwing', () => {
    const h = loadNativeMap();
    const path = [
      { lat: 51.5, lng: -0.1 },
      { lat: 51.501, lng: -0.1 },
      { lat: 51.502, lng: -0.1 },
    ];
    expect(() =>
      h.updateMap(
        baseData({
          origin: { lat: 51.5, lng: -0.1 },
          destination: { lat: 51.502, lng: -0.1 },
          routes: [{ id: 'a', selected: true, path }],
          navLocation: { lat: 51.5005, lng: -0.1 },
          navHeading: 40,
          maxDistanceKm: 2,
          fitBounds: true,
          friendMarkers: [{ userId: 'u1', name: 'Sam', lat: 51.5, lng: -0.1, path, routePath: path }],
          safetyMarkers: [
            { id: 'search-candidate:1', kind: 'search_candidate', label: 'Cafe', lat: 51.51, lng: -0.1, isSelected: true, pinColor: '#ef4444' },
            { id: 'crime-1', kind: 'crime', label: 'Crime', lat: 51.5005, lng: -0.1 },
          ],
        }),
      ),
    ).not.toThrow();
    expect(h.markersWithClass('friend-marker')).toHaveLength(1);
    expect(h.markersWithClass('search-pin-wrap')).toHaveLength(1);
    expect(h.markersWithClass('hazard-label')).toHaveLength(1);
    expect(h.sourceData('range-circle').features).toHaveLength(0);
    expect(h.sourceData('friend-planned-routes').features).toHaveLength(1);
  });
});


// ── FX3: screen-space merging, pill separation, fallback line, legend notes ──────

describe('RouteMap.native legend notes', () => {
  const legendRoot = (h: NativeHarness) => h.elements['rlLegend'];
  const withNotes = (notes: string[]) => ({ ...spec, legend: { ...spec.legend, notes } }) as RouteLayerSpec;

  it('shows a caveat dot on the collapsed button and opens the note with the legend', () => {
    const h = loadNativeMap({ innerWidth: 390 });
    h.updateMap(baseData({ routeLayers: layerPayload(withNotes(['Crime data unavailable'])) }));
    expect(legendRoot(h).className).toContain('rl-legend-has-notes');
    legendRoot(h).querySelector('.rl-legend-head')!.listeners.click[0]({});
    const holder = legendRoot(h).querySelector('.rl-legend-notes')!;
    expect(holder.style.display).not.toBe('none');
    expect(holder.querySelector('.rl-legend-note')!.textContent).toBe('Crime data unavailable');
  });

  it('keeps the caveat dot after the user collapses the legend', () => {
    const h = loadNativeMap({ innerWidth: 420 });
    h.updateMap(baseData({ routeLayers: layerPayload(withNotes(['Crime data unavailable'])) }));
    const head = legendRoot(h).querySelector('.rl-legend-head')!;
    head.listeners.click[0]({});
    head.listeners.click[0]({});
    expect(legendRoot(h).className).toContain('rl-legend-collapsed');
    expect(legendRoot(h).className).toContain('rl-legend-has-notes');
  });

  it('gives the legend header a full-width 44px tap target', () => {
    const rule = buildMapHtml().match(/\.rl-legend-head\{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toContain('min-height:44px');
    expect(rule).toContain('width:100%');
  });
});

describe('RouteMap.native screen-space badge layout', () => {
  const perDeg = (zoom: number) => (256 * 2 ** zoom) / 360;
  const cluster = (lat: number, lng: number, count: number, maxSeverity = 0.5) => ({ lat, lng, count, maxSeverity });
  const crimeOnly = (clusters: ReturnType<typeof cluster>[]): RouteLayerSpec => ({ ...emptySpec, crimeClusters: clusters });
  const labels = (h: NativeHarness) => h.markersWithClass('rl-crime').map((m) => m.options.element.textContent);
  const draw = (h: NativeHarness, clusters: ReturnType<typeof cluster>[], badges: unknown[] = []) =>
    h.updateMap(baseData({ routeLayers: layerPayload(crimeOnly(clusters)), routeBadges: badges }));
  const relayout = (h: NativeHarness, ev: 'zoomend' | 'moveend' = 'zoomend') => {
    h.fireMapEvent(ev);
    h.flushRelayout();
  };

  describe('crime badges', () => {
    it('merges badges that overlap on screen into one badge with the summed count at the weighted position', () => {
      const h = loadNativeMap({ zoom: 16 });
      draw(h, [cluster(51.5, -0.1, 5), cluster(51.5001, -0.1, 3), cluster(51.5, -0.1001, 2)]);
      const badges = h.markersWithClass('rl-crime');
      expect(badges).toHaveLength(1);
      expect(badges[0].options.element.textContent).toBe('10');
      expect(badges[0].options.element.getAttribute('aria-label')).toBe('10 crimes reported');
      expect(badges[0].ll[0]).toBeCloseTo((-0.1 * 5 + -0.1 * 3 + -0.1001 * 2) / 10, 8);
      expect(badges[0].ll[1]).toBeCloseTo((51.5 * 5 + 51.5001 * 3 + 51.5 * 2) / 10, 8);
    });

    it('keeps badges that are far apart on screen separate', () => {
      const h = loadNativeMap({ zoom: 16 });
      draw(h, [cluster(51.5, -0.1, 5), cluster(51.51, -0.1, 3)]);
      expect(labels(h)).toEqual(['5', '3']);
    });

    it('caps the merged label at 99+ and uses the large badge', () => {
      const h = loadNativeMap({ zoom: 16 });
      draw(h, [cluster(51.5, -0.1, 60), cluster(51.5, -0.1001, 60)]);
      const [badge] = h.markersWithClass('rl-crime');
      expect(badge.options.element.textContent).toBe('99+');
      expect(badge.options.element.className).toContain('rl-crime-lg');
      expect(badge.options.element.getAttribute('aria-label')).toBe('120 crimes reported');
    });

    it('at city zoom keeps crowded badges at least 44px apart and conserves the total count', () => {
      const h = loadNativeMap({ zoom: 14 });
      const crowded = Array.from({ length: 12 }, (_, i) => cluster(51.5 + i * 0.001, -0.1 + (i % 2) * 0.0005, i + 1));
      draw(h, crowded);
      const badges = h.markersWithClass('rl-crime');
      expect(badges.length).toBeGreaterThan(0);
      expect(badges.length).toBeLessThan(12);
      const px = badges.map((b) => ({ x: b.ll[0] * perDeg(14), y: -b.ll[1] * perDeg(14) }));
      for (let i = 0; i < px.length; i++) {
        for (let j = i + 1; j < px.length; j++) {
          expect(Math.hypot(px[i].x - px[j].x, px[i].y - px[j].y)).toBeGreaterThanOrEqual(44);
        }
      }
      const total = badges.reduce((sum, b) => sum + Number(b.options.element.getAttribute('aria-label')!.split(' ')[0]), 0);
      expect(total).toBe(crowded.reduce((sum, c) => sum + c.count, 0));
    });

    it('re-merges on zoom out and splits on zoom in, after the debounce', () => {
      const h = loadNativeMap({ zoom: 17 });
      draw(h, [cluster(51.5, -0.1, 4), cluster(51.501, -0.1, 3)]);
      expect(labels(h)).toEqual(['4', '3']);

      h.setZoom(14);
      h.fireMapEvent('zoomend');
      expect(labels(h)).toEqual(['4', '3']);
      h.flushRelayout();
      expect(labels(h)).toEqual(['7']);

      h.setZoom(17);
      relayout(h, 'moveend');
      expect(labels(h)).toEqual(['4', '3']);
    });

    it('debounces a burst of zoomend and moveend events into one relayout', () => {
      const h = loadNativeMap({ zoom: 17 });
      draw(h, [cluster(51.5, -0.1, 4)]);
      h.fireMapEvent('zoomend');
      h.fireMapEvent('zoomend');
      h.fireMapEvent('moveend');
      expect(h.pendingRelayouts()).toBe(1);
    });

    it('leaves the markers alone when a move ends without a zoom change', () => {
      const h = loadNativeMap({ zoom: 17 });
      draw(h, [cluster(51.5, -0.1, 4), cluster(51.51, -0.1, 3)]);
      const before = h.markersWithClass('rl-crime');
      relayout(h, 'moveend');
      const after = h.markersWithClass('rl-crime');
      expect(after[0]).toBe(before[0]);
      expect(after[1]).toBe(before[1]);
    });

    it('removes the old markers on relayout (no duplicates) and keeps callout and pills', () => {
      const h = loadNativeMap({ zoom: 17 });
      h.updateMap(
        baseData({
          routeLayers: layerPayload({ ...spec, crimeClusters: [cluster(51.5, -0.1, 4), cluster(51.501, -0.1, 3)] }),
          routeBadges: [{ routeId: 'a', lat: 51.5, lng: -0.1, text: '62', selected: true }],
        }),
      );
      h.setZoom(14);
      relayout(h);
      expect(h.markersWithClass('rl-crime')).toHaveLength(1);
      expect(h.markersWithClass('rl-callout')).toHaveLength(1);
      expect(h.markersWithClass('rl-pill-hit')).toHaveLength(1);
    });

    it('does not draw crime badges outside routeLayers mode, also after a relayout', () => {
      const h = loadNativeMap({ zoom: 17 });
      h.updateMap(baseData({ routeLayers: null }));
      h.setZoom(14);
      relayout(h);
      expect(h.markersWithClass('rl-crime')).toHaveLength(0);
    });

    it('draws every cluster unmerged when the map cannot project', () => {
      const h = loadNativeMap({ zoom: 16, project: null });
      draw(h, [cluster(51.5, -0.1, 5), cluster(51.5001, -0.1, 3)]);
      expect(labels(h)).toEqual(['5', '3']);
    });
  });

  describe('score pills', () => {
    const badge = (routeId: string, lat: number, lng: number, text: string, selected = false) => ({
      routeId,
      lat,
      lng,
      text,
      selected,
    });

    it('moves the later of two coinciding pills down by 44px with a marker offset', () => {
      const h = loadNativeMap({ zoom: 16 });
      draw(h, [], [badge('a', 51.5, -0.1, '62'), badge('b', 51.5, -0.1, '48')]);
      const [first, second] = h.markersWithClass('rl-pill-hit');
      expect(first.options.offset).toBeUndefined();
      expect(second.options.offset).toEqual([0, 44]);
      expect(second.ll).toEqual([-0.1, 51.5]);
    });

    it('moves a selected pill off a merged crime badge it would cover, the badge staying put', () => {
      const h = loadNativeMap({ zoom: 16 });
      const badgeLat = 51.5 + 3.6 / perDeg(16);
      draw(h, [cluster(badgeLat, -0.1, 30), cluster(badgeLat, -0.1, 16)], [badge('a', 51.5, -0.1, '78', true)]);
      const [crime] = h.markersWithClass('rl-crime');
      expect(crime.options.element.textContent).toBe('46');
      expect(crime.options.offset).toBeUndefined();
      const [pill] = h.markersWithClass('rl-pill-hit');
      const shift = pill.options.offset ? pill.options.offset[1] : 0;
      expect(Math.abs(shift)).toBeLessThanOrEqual(44);
      const badgeY = -badgeLat * perDeg(16);
      const pillY = -51.5 * perDeg(16) + shift;
      expect(Math.abs(pillY - badgeY)).toBeGreaterThanOrEqual(22 + 16 - 1e-6);
    });

    it('leaves pills that are 44px or more apart alone', () => {
      const h = loadNativeMap({ zoom: 16 });
      draw(h, [], [badge('a', 51.5, -0.1, '62'), badge('b', 51.51, -0.1, '48')]);
      h.markersWithClass('rl-pill-hit').forEach((m) => expect(m.options.offset).toBeUndefined());
    });

    it('separates again after a zoom change and keeps taps selecting the route', () => {
      const h = loadNativeMap({ zoom: 17 });
      draw(h, [], [badge('a', 51.5, -0.1, '62'), badge('b', 51.501, -0.1, '48')]);
      h.markersWithClass('rl-pill-hit').forEach((m) => expect(m.options.offset).toBeUndefined());

      h.setZoom(14);
      relayout(h);
      const [, second] = h.markersWithClass('rl-pill-hit');
      const dy = second.options.offset[1];
      expect(dy).toBeLessThan(0); // the more northerly pill sits higher on screen, so it moves up
      expect(dy).toBeGreaterThanOrEqual(-44);
      expect(0.001 * perDeg(14) - dy).toBeCloseTo(44, 0);

      second.options.element.listeners.click[0]({ stopPropagation: () => undefined, preventDefault: () => undefined });
      expect(selectRouteMessages(h)).toEqual(['b']);
    });
  });
});

describe('RouteMap.native fallback route line', () => {
  const path = [
    { lat: 51.5, lng: -0.1 },
    { lat: 51.501, lng: -0.1 },
    { lat: 51.502, lng: -0.1 },
  ];
  const routes = [
    { id: 'a', selected: false, path: [{ lat: 51.5, lng: -0.11 }, { lat: 51.51, lng: -0.11 }] },
    { id: 'b', selected: true, path },
  ];
  const lngLat = path.map((p): [number, number] => [p.lng, p.lat]);

  it('draws the selected route as one blue line with a casing when the spec has no usable lines', () => {
    const h = loadNativeMap();
    h.updateMap(baseData({ routes, routeLayers: layerPayload(emptySpec) }));

    const solid = h.sourceData('rl-solid').features;
    const casing = h.sourceData('rl-casing').features;
    expect(solid).toHaveLength(1);
    expect(solid[0].properties.color).toBe(RL_FALLBACK_BLUE);
    expect(solid[0].geometry).toEqual({ type: 'LineString', coordinates: lngLat });
    expect(casing).toHaveLength(1);
    expect(casing[0].geometry).toEqual({ type: 'LineString', coordinates: lngLat });
    expect(h.sourceData('rl-dashed').features).toHaveLength(0);
  });

  it('also falls back when every spec line is invalid', () => {
    const h = loadNativeMap();
    const bad: RouteLayerSpec = {
      ...emptySpec,
      lines: [{ coords: [[Number.NaN, 0], [1, 1]], risk: 0.1, color: RISK_RAMP[0], dashed: false }],
    };
    h.updateMap(baseData({ routes, routeLayers: layerPayload(bad) }));
    expect(h.sourceData('rl-solid').features.map((f: any) => f.properties.color)).toEqual([RL_FALLBACK_BLUE]);
  });

  it('keeps the spec lines (no fallback) when the spec has usable lines, even only dashed ones', () => {
    const h = loadNativeMap();
    h.updateMap(baseData({ routes, routeLayers: layerPayload() }));
    expect(h.sourceData('rl-solid').features.map((f: any) => f.properties.color)).toEqual([RISK_RAMP[0], RISK_RAMP[2]]);

    const dashedOnly: RouteLayerSpec = { ...emptySpec, lines: [spec.lines[1]] };
    h.updateMap(baseData({ routes, routeLayers: layerPayload(dashedOnly) }));
    expect(h.sourceData('rl-solid').features).toHaveLength(0);
    expect(h.sourceData('rl-dashed').features).toHaveLength(1);
  });

  it('draws nothing when there is no selected route, or its path is too short', () => {
    const h = loadNativeMap();
    h.updateMap(baseData({ routes: [routes[0]], routeLayers: layerPayload(emptySpec) }));
    expect(h.sourceData('rl-solid').features).toHaveLength(0);
    expect(h.sourceData('rl-casing').features).toHaveLength(0);

    h.updateMap(baseData({ routes: [{ id: 'b', selected: true, path: [path[0]] }], routeLayers: layerPayload(emptySpec) }));
    expect(h.sourceData('rl-solid').features).toHaveLength(0);
  });

  it('does not draw a fallback on the legacy path (routeLayers null)', () => {
    const h = loadNativeMap();
    h.updateMap(baseData({ routes, routeLayers: null }));
    expect(h.sourceData('rl-solid').features).toHaveLength(0);
    expect(h.sourceData('rl-casing').features).toHaveLength(0);
  });
});

describe('RouteMap.native street names on route lines', () => {
  it('draws the road name along the solid route lines, small and without a background box', () => {
    const html = buildMapHtml();
    const layer = html.match(/map\.addLayer\(\{ id:'rl-road-names'[\s\S]*?\}\);/)?.[0] ?? '';
    expect(layer).toContain("source:'rl-solid'");
    expect(layer).toContain("'symbol-placement':'line'");
    expect(layer).toContain("'text-field':['get','name']");
    expect(layer).toContain("'text-size':11");
    expect(layer).not.toMatch(/text-halo-width':[3-9]/);
    expect(layer).not.toMatch(/background/i);
  });
});

/**
 * safetyGraph model: the scoring pipeline.
 * Spec: docs/superpowers/specs/2026-10-19-safety-scoring-v2-design.md sections 10-11.
 *
 * Every network is a tiny synthetic OSM-like dataset, so results are deterministic and
 * no test touches the network or the real clock (London hour and `now` are passed in).
 */

const path = require('path');
const {
  buildGraph,
  findKSafestRoutes,
  routeSafetyBreakdown,
  isHazardEdge,
} = require(path.resolve(__dirname, '../../../../src/safety/services/safetyGraph'));
const { ACTIVITY_FLOOR } = require(path.resolve(__dirname, '../../../../src/safety/scoring/config'));

const LAT = 51.5;
const LNG = -0.1;
const DLNG = 0.0016; // ~111 m at this latitude
const LAMP_LAT_OFFSET = 0.00015; // ~17 m north of the street centre line

// Night and day instants on the same London calendar day (BST, UTC+1).
const NIGHT = { hour: 23, now: new Date('2026-10-19T22:30:00Z') }; // 23:30 London
const DAY = { hour: 12, now: new Date('2026-06-21T11:00:00Z') }; // 12:00 London

const LEGACY_EDGE_FIELDS = [
  'idx', 'from', 'to', 'distance', 'highway', 'safetyScore', 'roadScore', 'lightScore',
  'crimeScore', 'cctvScore', 'placeScore', 'trafficScore', 'penalty', 'hasSidewalk',
  'surfaceType', 'roadName', 'nearbyCctvCount', 'nearbyTransitCount', 'surfacePenalty',
  'maxspeed', 'isTunnel', 'isLit', 'litTag', 'isDeadEnd',
];
const MODEL_EDGE_FIELDS = ['risk', 'certainty', 'cause', 'litEstimate', 'pLit', 'lengthM'];
const LEGACY_BREAKDOWN_FIELDS = [
  'roadType', 'lighting', 'crime', 'cctv', 'openPlaces', 'traffic', 'overall', 'roadTypes',
  'mainRoadRatio', 'riskVector',
];
const MODEL_BREAKDOWN_FIELDS = ['routeRisk', 'mean', 'm3', 'certainty', 'worstStretch'];

/**
 * Three east-west streets about 330 m apart, four nodes each (three edges per street):
 *   street L: residential, 30 mph, lamps along it (lit by lamps)
 *   street U: residential, no speed or lighting tags (unmapped)
 *   street P: path tagged lit=no
 * Edge indices: L 0-2, U 3-5, P 6-8. Middle edges are 1, 4 and 7 (both ends have degree 2).
 */
function streetNetwork() {
  const elements = [];
  const streets = [
    { row: 0, firstId: 1, wayId: 101, tags: { highway: 'residential', maxspeed: '30 mph' }, lamps: true },
    { row: 3, firstId: 11, wayId: 102, tags: { highway: 'residential' }, lamps: false },
    { row: 6, firstId: 21, wayId: 103, tags: { highway: 'path', lit: 'no' }, lamps: false },
  ];
  const lamps = [];
  let lampId = 500;
  for (const street of streets) {
    const lat = LAT + street.row * 0.001;
    const nodeIds = [0, 1, 2, 3].map((k) => street.firstId + k);
    nodeIds.forEach((id, k) => elements.push({ type: 'node', id, lat, lon: LNG + k * DLNG }));
    elements.push({ type: 'way', id: street.wayId, nodes: nodeIds, tags: street.tags });
    if (street.lamps) {
      for (let k = 0; k <= 6; k++) {
        lamps.push({ type: 'node', id: lampId++, lat: lat + LAMP_LAT_OFFSET, lon: LNG + (k * 0.5) * DLNG, tags: { highway: 'street_lamp' } });
      }
    }
  }
  return {
    roadData: { elements },
    lightData: { elements: lamps },
    bbox: { south: LAT - 0.001, north: LAT + 0.008, west: LNG - 0.001, east: LNG + 0.005 },
  };
}

function buildStreets(options = {}) {
  const net = streetNetwork();
  return buildGraph(net.roadData, net.lightData, null, null, null, [], net.bbox, { level: 'extra', crimeStatus: 'ok', ...NIGHT, ...options });
}

describe('safetyGraph model', () => {
  describe('(a) lighting depends on darkness', () => {
    test('at night a lit residential street is safer than an unmapped one, which is safer than a lit=no path', async () => {
      const graph = await buildStreets({ ...NIGHT, crimeStatus: 'ok' });
      const lit = graph.edges[1].risk;
      const unmapped = graph.edges[4].risk;
      const litNoPath = graph.edges[7].risk;
      expect(lit).toBeLessThan(unmapped);
      expect(unmapped).toBeLessThan(litNoPath);
      expect(unmapped - lit).toBeGreaterThan(0.01);
    });

    test('in full daylight the lamps on the lit street make almost no difference', async () => {
      const graph = await buildStreets({ ...DAY });
      expect(graph.darkness).toBeCloseTo(0, 6);
      const lit = graph.edges[1].risk;
      const unmapped = graph.edges[4].risk;
      expect(Math.abs(lit - unmapped)).toBeLessThan(0.01);
    });

    test('a verified-unlit cache entry overrides the lamps on a lit street', async () => {
      const plain = await buildStreets({ ...NIGHT });
      const cached = await buildStreets({ ...NIGHT, lightsCacheByEdgeIdx: new Map([[1, { lit_status: 'unlit', confidence: 0.9 }]]) });
      expect(cached.edges[1].litEstimate).toBe('unlit');
      expect(cached.edges[1].pLit).toBeCloseTo(0.05, 6);
      expect(cached.edges[1].risk).toBeGreaterThan(plain.edges[1].risk);
    });
  });

  describe('(b) crime outage is never read as safe', () => {
    test('unavailable crime data gives higher risk than an empty ok dataset, and never a safe crime score', async () => {
      const ok = await buildStreets({ ...NIGHT, crimeStatus: 'ok' });
      const down = await buildStreets({ ...NIGHT, crimeStatus: 'unavailable' });
      expect(down.edges[4].risk).toBeGreaterThan(ok.edges[4].risk);
      expect(down.edges[4].crimeScore).toBeLessThanOrEqual(0.6);
      expect(down.edges[4].certainty).toBeLessThanOrEqual(ok.edges[4].certainty);
    });

    test('unavailable crime data is not lower risk than the area prior alone', async () => {
      const down = await buildStreets({ ...NIGHT, crimeStatus: 'unavailable' });
      const ok = await buildStreets({ ...NIGHT, crimeStatus: 'ok' });
      expect(down.edges[4].risk).toBeGreaterThanOrEqual(ok.edges[4].risk);
    });
  });

  describe('(c) dead-end detection uses all highway ways at a node', () => {
    // Footway P-Q meets a motorway at Q (motorway passes through Q), so Q is a junction.
    // Footway P-D ends at D, a true dead end. P also carries a residential street through it.
    function junctionNetwork() {
      const pos = (lat, lng) => ({ lat, lon: lng });
      const elements = [
        { type: 'node', id: 1, ...pos(LAT, LNG) },           // residential west of P
        { type: 'node', id: 2, ...pos(LAT, LNG + DLNG) },    // P
        { type: 'node', id: 3, ...pos(LAT, LNG + 2 * DLNG) }, // residential east of P
        { type: 'node', id: 4, ...pos(LAT + 0.001, LNG + DLNG) }, // Q, on the motorway
        { type: 'node', id: 5, ...pos(LAT + 0.002, LNG + DLNG) }, // motorway north of Q
        { type: 'node', id: 6, ...pos(LAT - 0.001, LNG + DLNG) }, // motorway south of Q
        { type: 'node', id: 7, ...pos(LAT - 0.001, LNG + 3 * DLNG) }, // D, dead-end footway tip
        { type: 'way', id: 10, nodes: [1, 2, 3], tags: { highway: 'residential' } },
        { type: 'way', id: 11, nodes: [2, 4], tags: { highway: 'footway' } },   // P-Q: meets motorway
        { type: 'way', id: 12, nodes: [6, 4, 5], tags: { highway: 'motorway' } },
        { type: 'way', id: 13, nodes: [2, 7], tags: { highway: 'footway' } },   // P-D: true dead end
      ];
      return {
        roadData: { elements },
        lightData: null,
        bbox: { south: LAT - 0.002, north: LAT + 0.003, west: LNG - 0.001, east: LNG + 0.004 },
      };
    }

    test('a footway that meets a motorway at a junction is not a dead end', async () => {
      const net = junctionNetwork();
      const graph = await buildGraph(net.roadData, net.lightData, null, null, null, [], net.bbox, { ...NIGHT, crimeStatus: 'ok' });
      const footwayToJunction = graph.edges.find((e) => e.highway === 'footway' && (e.from === 2 && e.to === 4 || e.from === 4 && e.to === 2));
      expect(footwayToJunction).toBeDefined();
      expect(footwayToJunction.isDeadEnd).toBe(false);
    });

    test('a footway that really ends is still a dead end', async () => {
      const net = junctionNetwork();
      const graph = await buildGraph(net.roadData, net.lightData, null, null, null, [], net.bbox, { ...NIGHT, crimeStatus: 'ok' });
      const footwayToTip = graph.edges.find((e) => e.highway === 'footway' && (e.from === 2 && e.to === 7 || e.from === 7 && e.to === 2));
      expect(footwayToTip).toBeDefined();
      expect(footwayToTip.isDeadEnd).toBe(true);
    });
  });

  describe('(d) candidate ranking by exposure', () => {
    const ORIGIN = { lat: LAT, lng: LNG };

    // Hand-built edges (routes compare by risk and length, not by geometry).
    function manualGraph(spec) {
      const osmNodes = new Map();
      const adjacency = new Map();
      const edges = [];
      const nodeIds = new Set(spec.flatMap(([from, to]) => [from, to]));
      for (const id of nodeIds) osmNodes.set(id, { id, lat: ORIGIN.lat, lng: ORIGIN.lng });
      spec.forEach(([from, to, distance, risk]) => {
        const idx = edges.length;
        edges.push({
          idx, from, to, distance, risk, safetyScore: 1 - risk, certainty: 0.8, cause: 'lighting',
          start: ORIGIN, end: ORIGIN, penalty: 0,
        });
        for (const [a, b] of [[from, to], [to, from]]) {
          if (!adjacency.has(a)) adjacency.set(a, []);
          adjacency.get(a).push({ edgeIdx: idx, neighborId: b });
        }
      });
      return { osmNodes, edges, adjacency };
    }

    // Exposure H = routeRisk * (lengthM / 1000)^0.5 (LENGTH_EXPOSURE_EXPONENT = 0.5); candidates longer than
    // 2.0x the shortest (MAX_LENGTH_RATIO) stay in the list, marked excluded, after every kept route.
    // Every edge of a route has the same risk, so routeRisk equals that risk (mean = M3).
    test('a 1.4x longer route that is only 10% less risky ranks below the shorter route, and a route over 2.0x the shortest is excluded last', () => {
      const { osmNodes, edges, adjacency } = manualGraph([
        ['S', 'A', 500, 0.5], ['A', 'E', 500, 0.5],                 // A: 1000 m at risk 0.50
        ['S', 'B1', 466.6667, 0.45], ['B1', 'B2', 466.6667, 0.45], ['B2', 'E', 466.6667, 0.45], // B: 1400.0001 m at 0.45
        ['S', 'E', 2100, 0.1],                                       // C: 2100 m at 0.10 (2.1x the shortest)
      ]);

      const routes = findKSafestRoutes(osmNodes, edges, adjacency, 'S', 'E', 2000, 5, {});

      expect(routes.map((r) => r.edges)).toEqual([[0, 1], [2, 3, 4], [5]]);
      expect(routes.map((r) => r.excluded)).toEqual([false, false, true]);
      // A: 0.50 * sqrt(1.0)    = 0.500000
      // B: 0.45 * sqrt(1.4)    = 0.45 * 1.183216 = 0.532447 (needs risk below 0.5 / 1.183216 = 0.4226 to beat A)
      // C: 0.10 * sqrt(2.1)    = 0.10 * 1.449138 = 0.144914 (lowest, but 2.1x > 2.0x, so excluded and last)
      expect(routes[0].exposure).toBeCloseTo(0.5, 6);
      expect(routes[1].exposure).toBeCloseTo(0.45 * Math.sqrt(1.4000001), 5);
      expect(routes[1].exposure).toBeCloseTo(0.532447, 5);
      expect(routes[2].exposure).toBeCloseTo(0.144914, 5);
      expect(routes[1].routeRisk).toBeLessThan(routes[0].routeRisk);
      expect(routes[1].exposure).toBeGreaterThan(routes[0].exposure);
      expect(routes[0].score).toBe(50);
    });

    test('a 1.4x longer route wins once its risk is more than 15.5% lower (0.40 against 0.50)', () => {
      const { osmNodes, edges, adjacency } = manualGraph([
        ['S', 'A', 500, 0.5], ['A', 'E', 500, 0.5],                 // A: 1000 m at 0.50, exposure 0.500000
        ['S', 'B1', 466.6667, 0.4], ['B1', 'B2', 466.6667, 0.4], ['B2', 'E', 466.6667, 0.4], // B: 1400 m at 0.40
      ]);

      const routes = findKSafestRoutes(osmNodes, edges, adjacency, 'S', 'E', 2000, 5, {});

      // B: 0.40 * sqrt(1.4) = 0.473286 < 0.5, so the longer route is recommended.
      expect(routes.map((r) => r.edges)).toEqual([[2, 3, 4], [0, 1]]);
      expect(routes[0].exposure).toBeCloseTo(0.473286, 5);
      expect(routes.map((r) => r.excluded)).toEqual([false, false]);
    });

    test('a route at exactly 2.0x the shortest is kept and, being far less risky, ranks first', () => {
      const { osmNodes, edges, adjacency } = manualGraph([
        ['S', 'A', 500, 0.5], ['A', 'E', 500, 0.5],                 // A: 1000 m at 0.50, exposure 0.500000
        ['S', 'E', 2000, 0.1],                                       // C: 2000 m at 0.10 = 2.0x, exposure 0.1 * sqrt(2) = 0.141421
      ]);

      const routes = findKSafestRoutes(osmNodes, edges, adjacency, 'S', 'E', 2000, 5, {});

      expect(routes.map((r) => r.edges)).toEqual([[2], [0, 1]]);
      expect(routes.map((r) => r.excluded)).toEqual([false, false]);
      expect(routes[0].exposure).toBeCloseTo(0.141421, 5);
    });
  });

  describe('(e) legacy and new fields', () => {
    test('every edge carries the legacy fields and the model fields', async () => {
      const graph = await buildStreets({ ...NIGHT });
      for (const edge of graph.edges) {
        for (const field of [...LEGACY_EDGE_FIELDS, ...MODEL_EDGE_FIELDS]) {
          expect(edge).toHaveProperty(field);
        }
        expect(edge.risk).toBeGreaterThanOrEqual(0);
        expect(edge.risk).toBeLessThanOrEqual(1);
        expect(edge.safetyScore).toBeCloseTo(1 - edge.risk, 12);
        expect(edge.certainty).toBeGreaterThanOrEqual(0);
        expect(edge.certainty).toBeLessThanOrEqual(1);
        expect(edge.lengthM).toBe(edge.distance);
        expect(['lit', 'unlit', 'estimated_lit', 'estimated_unlit']).toContain(edge.litEstimate);
        expect(edge.cause === null || ['lighting', 'crime', 'road', 'activity', 'isolation'].includes(edge.cause)).toBe(true);
      }
    });

    test('the lit street edge is classified lit and the lit=no path edge unlit', async () => {
      const graph = await buildStreets({ ...NIGHT });
      expect(graph.edges[1].litEstimate).toBe('lit');
      expect(graph.edges[7].litEstimate).toBe('unlit');
      expect(graph.edges[7].isLit).toBe(false);
    });

    test('routeSafetyBreakdown returns the legacy keys and the new route keys', async () => {
      const graph = await buildStreets({ ...NIGHT });
      const breakdown = routeSafetyBreakdown(graph.edges, [0, 1, 2]);
      for (const key of [...LEGACY_BREAKDOWN_FIELDS, ...MODEL_BREAKDOWN_FIELDS]) {
        expect(breakdown).toHaveProperty(key);
      }
      expect(breakdown.overall).toBeCloseTo(1 - breakdown.routeRisk, 12);
    });
  });

  describe('(h) activity uses the requested hour and data presence', () => {
    // A convenience shop 17 m off the centre of the unmapped street (edge 4).
    const shop = { type: 'node', id: 900, lat: LAT + 0.003 + 0.00005, lon: LNG + 1.5 * DLNG, tags: { shop: 'convenience' } };

    test('a convenience shop counts at 12:00 and not at 23:00 (it closes at 23:00), whatever the server clock says', async () => {
      const net = streetNetwork();
      const places = { elements: [shop] };
      const noon = await buildGraph(net.roadData, net.lightData, null, places, null, [], net.bbox, { level: 'extra', hour: 12, now: NIGHT.now, crimeStatus: 'ok' });
      const late = await buildGraph(net.roadData, net.lightData, null, places, null, [], net.bbox, { level: 'extra', hour: 23, now: NIGHT.now, crimeStatus: 'ok' });
      expect(noon.edges[4].placeScore).toBeCloseTo(0.15, 9);
      expect(late.edges[4].placeScore).toBe(0);
    });

    test('with no place, transit or CCTV data at all, activity is unknown and adds no certainty', async () => {
      const net = streetNetwork();
      const none = await buildStreets({ ...NIGHT });
      const withCctv = await buildGraph(net.roadData, net.lightData, { elements: [{ type: 'node', id: 901, lat: LAT + 0.002, lon: LNG + 0.001 }] }, null, null, [], net.bbox, { level: 'extra', ...NIGHT, crimeStatus: 'ok' });
      expect(withCctv.edges[4].certainty).toBeGreaterThan(none.edges[4].certainty);
    });

    test('the standard data level drops activity, so CCTV data does not change edge risk', async () => {
      const net = streetNetwork();
      const cctv = { elements: [{ type: 'node', id: 901, lat: LAT + 0.002, lon: LNG + 0.001 }] };
      const standardNone = await buildGraph(net.roadData, net.lightData, null, null, null, [], net.bbox, { level: 'standard', ...NIGHT, crimeStatus: 'ok' });
      const standardCctv = await buildGraph(net.roadData, net.lightData, cctv, null, null, [], net.bbox, { level: 'standard', ...NIGHT, crimeStatus: 'ok' });
      expect(standardCctv.edges[4].risk).toBeCloseTo(standardNone.edges[4].risk, 12);
      expect(standardCctv.weights.activity).toBe(0);
    });

    // A camera 444 m north of the unmapped street: inside the bbox, far outside the 80 m CCTV radius.
    const farCamera = { elements: [{ type: 'node', id: 902, lat: LAT + 0.007, lon: LNG + 0.004 }] };

    test('a single far-away camera gives activity the floor, not zero, so trafficScore is the road score blended with ACTIVITY_FLOOR', async () => {
      const net = streetNetwork();
      const far = await buildGraph(net.roadData, net.lightData, farCamera, null, null, [], net.bbox, { level: 'extra', ...NIGHT, crimeStatus: 'ok' });
      const edge = far.edges[4];
      expect(edge.trafficScore).toBeCloseTo((edge.roadScore + ACTIVITY_FLOOR) / 2, 9);
    });

    test('a single far-away camera does not make an edge riskier than the same street with no activity data at all', async () => {
      const net = streetNetwork();
      const none = await buildStreets({ ...NIGHT });
      const far = await buildGraph(net.roadData, net.lightData, farCamera, null, null, [], net.bbox, { level: 'extra', ...NIGHT, crimeStatus: 'ok' });
      expect(far.edges[4].risk).toBeLessThanOrEqual(none.edges[4].risk);
    });
  });

  describe('maxspeed hazards (threshold 80 km/h, 50 mph)', () => {
    const base = { hasSidewalk: false, isTunnel: false, isLit: false };

    test('40 mph (about 64 km/h) with no sidewalk is not a hazard', () => {
      expect(isHazardEdge({ ...base, maxspeed: '40 mph' })).toBe(false);
    });

    test('30 mph (about 48 km/h) is not a hazard, and neither is a bare 30 with no unit', () => {
      expect(isHazardEdge({ ...base, maxspeed: '30 mph' })).toBe(false);
      expect(isHazardEdge({ ...base, maxspeed: '30' })).toBe(false);
    });

    test('50 mph (about 80 km/h) with no sidewalk is a hazard, and 49 mph (about 79 km/h) is not', () => {
      expect(isHazardEdge({ ...base, maxspeed: '50 mph' })).toBe(true);
      expect(isHazardEdge({ ...base, maxspeed: '49 mph' })).toBe(false);
    });

    test('a bare 80 is read as km/h and is a hazard, a bare 79 is not, and km/h spellings count as km/h', () => {
      expect(isHazardEdge({ ...base, maxspeed: '80' })).toBe(true);
      expect(isHazardEdge({ ...base, maxspeed: '79' })).toBe(false);
      expect(isHazardEdge({ ...base, maxspeed: '80 km/h' })).toBe(true);
      expect(isHazardEdge({ ...base, maxspeed: '80kmh' })).toBe(true);
    });

    test('a sidewalk on a fast road means it is not a hazard', () => {
      expect(isHazardEdge({ ...base, hasSidewalk: true, maxspeed: '60 mph' })).toBe(false);
    });

    test('an unparseable maxspeed is not a hazard', () => {
      expect(isHazardEdge({ ...base, maxspeed: 'signals' })).toBe(false);
      expect(isHazardEdge({ ...base, maxspeed: '' })).toBe(false);
    });

    test('an unlit tunnel is still a hazard at any speed', () => {
      expect(isHazardEdge({ ...base, isTunnel: true, maxspeed: '30 mph' })).toBe(true);
    });
  });

  describe('(g) riskVector describes route risk', () => {
    const ORIGIN = { lat: LAT, lng: LNG };
    function syntheticEdges(rows) {
      return rows.map(([distance, risk, certainty], idx) => ({
        idx, distance, risk, certainty, safetyScore: 1 - risk, cause: 'road', highway: 'residential',
        roadScore: 0.5, lightScore: 0.5, crimeScore: 0.5, cctvScore: 0, placeScore: 0, trafficScore: 0.5,
        start: ORIGIN, end: ORIGIN,
      }));
    }

    test('mean, p95 and max are of risk, max is the worst edge and uncertainty is 1 minus certainty', () => {
      const edges = syntheticEdges([[100, 0.2, 0.5], [300, 0.8, 0.5], [100, 0.5, 0.5]]);
      const breakdown = routeSafetyBreakdown(edges, [0, 1, 2]);

      const mean = (100 * 0.2 + 300 * 0.8 + 100 * 0.5) / 500;
      const m3 = Math.cbrt((100 * 0.2 ** 3 + 300 * 0.8 ** 3 + 100 * 0.5 ** 3) / 500);
      expect(breakdown.riskVector.mean).toBeCloseTo(mean, 9);
      expect(breakdown.riskVector.max).toBeCloseTo(0.8, 12);
      expect(breakdown.riskVector.p95).toBeCloseTo(0.8, 12);
      expect(breakdown.riskVector.uncertainty).toBeCloseTo(0.5, 12);
      expect(breakdown.mean).toBeCloseTo(mean, 9);
      expect(breakdown.m3).toBeCloseTo(m3, 9);
      expect(breakdown.routeRisk).toBeCloseTo(0.6 * mean + 0.4 * m3, 9);
      expect(breakdown.overall).toBeCloseTo(1 - breakdown.routeRisk, 9);
    });

    test('max is never the best edge', () => {
      const edges = syntheticEdges([[50, 0.1, 0.9], [50, 0.7, 0.9]]);
      const breakdown = routeSafetyBreakdown(edges, [0, 1]);
      expect(breakdown.riskVector.max).toBeCloseTo(0.7, 12);
    });
  });
});

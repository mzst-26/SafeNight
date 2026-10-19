/**
 * Synthetic street scenes for the v2 calibration spec (calibration.test.js).
 *
 * Each scene is a small OSM-like dataset, built in metres east (e) and north (n) of a Plymouth
 * origin and fed through the REAL buildGraph. Every archetype is one ~150 m street (the
 * "target") with stubs continuing it at both ends, so it is not a dead end unless stated.
 *
 * Shared context, the same for every scene unless a scene says otherwise:
 *   - a background grid of quiet residential streets (20 rows, 100 m apart, about 20 km of road).
 *     It gives the area a realistic road length, so the crime prior is an area mean rather than
 *     a value inflated by the scene's own few ways. The grid has no crimes, lamps or places.
 *   - no lamps, places, CCTV, transit or crimes, unless the archetype adds them.
 *   - night is London 23:00 on an October date; day is London 12:00 in June.
 */

const ORIGIN = { lat: 50.3755, lng: -4.1427 }; // Plymouth
const METRES_PER_DEG_LAT = 111320;
const METRES_PER_DEG_LNG = 111320 * Math.cos((ORIGIN.lat * Math.PI) / 180);

const NIGHT = Object.freeze({ hour: 23, now: new Date('2026-10-19T22:30:00Z') });
const DAY = Object.freeze({ hour: 12, now: new Date('2026-06-21T11:00:00Z') });
const CRIME_MONTH = '2026-09';

const TARGET_LENGTH_M = 150;

/** [east, north] metres from the origin to a {lat, lon} point. */
function toLatLon([east, north]) {
  return {
    lat: ORIGIN.lat + north / METRES_PER_DEG_LAT,
    lon: ORIGIN.lng + east / METRES_PER_DEG_LNG,
  };
}

/**
 * Standard background grid: 20 east-west rows, 100 m apart, 50 m points, spanning east -500 to eastMax
 * (default 500, 1 km long). Route chains pass a larger eastMax so every route segment sits in a mapped area.
 */
function backgroundWays(eastMax = 500) {
  const ways = [];
  for (let row = 0; row < 20; row++) {
    const north = -950 + row * 100;
    const points = [];
    for (let east = -500; east <= eastMax; east += 50) points.push([east, north]);
    ways.push({ id: 1000 + row, tags: { highway: 'residential' }, points });
  }
  return ways;
}

/**
 * Builds the datasets buildGraph takes from a list of ways and point features.
 * Way points that coincide share one node, so a junction is a real junction.
 *
 * @param {object} spec
 * @param {Array<{id?: number, name?: string, tags: object, points: Array<[number, number]>}>} spec.ways
 * @param {Array<[number, number]>} [spec.lamps]
 * @param {Array<{at: [number, number], tags: object}>} [spec.places]
 * @param {Array<[number, number]>} [spec.cctv]
 * @param {Array<[number, number]>} [spec.transit]
 * @param {Array<{at: [number, number], category: string, month?: string}>} [spec.crimes]
 * @param {boolean} [spec.background=true] Include the standard background grid.
 * @param {number} [spec.backgroundEastMax=500] East end of the background grid, in metres.
 * @returns {{roadData, lightData, cctvData, placeData, transitData, crimes, bbox}}
 */
function buildScene({
  ways = [], lamps = [], places = [], cctv = [], transit = [], crimes = [], background = true,
  backgroundEastMax = 500,
}) {
  const allWays = background ? [...ways, ...backgroundWays(backgroundEastMax)] : ways;
  const nodes = new Map();
  let nextId = 1;
  const nodeIdOf = (point) => {
    const key = `${point[0]},${point[1]}`;
    if (!nodes.has(key)) nodes.set(key, { id: nextId++, point });
    return nodes.get(key).id;
  };

  const wayElements = allWays.map((way, i) => ({
    type: 'way',
    id: way.id ?? 100 + i,
    nodes: way.points.map(nodeIdOf),
    tags: way.name ? { ...way.tags, name: way.name } : way.tags,
  }));
  const nodeElements = [...nodes.values()].map(({ id, point }) => ({ type: 'node', id, ...toLatLon(point) }));

  // Bounding box of every node, with a 60 m margin.
  const points = [...nodes.values()].map((n) => n.point);
  const margin = 60; // metres
  const sw = toLatLon([Math.min(...points.map((p) => p[0])) - margin, Math.min(...points.map((p) => p[1])) - margin]);
  const ne = toLatLon([Math.max(...points.map((p) => p[0])) + margin, Math.max(...points.map((p) => p[1])) + margin]);

  return {
    roadData: { elements: [...nodeElements, ...wayElements] },
    lightData: {
      elements: lamps.map((p) => ({ type: 'node', ...toLatLon(p), tags: { highway: 'street_lamp' } })),
    },
    cctvData: { elements: cctv.map((p) => ({ type: 'node', ...toLatLon(p), tags: { man_made: 'surveillance' } })) },
    placeData: { elements: places.map((pl) => ({ type: 'node', ...toLatLon(pl.at), tags: pl.tags })) },
    transitData: { elements: transit.map((p) => ({ type: 'node', ...toLatLon(p), tags: { highway: 'bus_stop' } })) },
    crimes: crimes.map((c) => {
      const { lat, lon } = toLatLon(c.at);
      return { lat, lng: lon, category: c.category, month: c.month || CRIME_MONTH };
    }),
    bbox: { south: sw.lat, north: ne.lat, west: sw.lon, east: ne.lon },
  };
}

/** A straight way along north = 0 from east 0 to east TARGET_LENGTH_M, with the given name. */
function targetWay(tags, name = 'target', from = [0, 0], to = [TARGET_LENGTH_M, 0]) {
  return { name, tags, points: [from, to] };
}

/** Stubs continuing the target at both ends, same tags, so the target is not a dead end. */
function continuedStreet(tags, { westStub = true, eastStub = true } = {}) {
  const ways = [targetWay(tags)];
  if (westStub) ways.push({ name: 'stubW', tags, points: [[-120, 0], [0, 0]] });
  if (eastStub) ways.push({ name: 'stubE', tags, points: [[TARGET_LENGTH_M, 0], [TARGET_LENGTH_M + 120, 0]] });
  return ways;
}

const MIDPOINT = [TARGET_LENGTH_M / 2, 0];

// Archetype tags. Each is the same for the target and its stubs.
const TAGS = {
  // A: lit residential, 30 mph, sidewalk.
  litResidential: { highway: 'residential', maxspeed: '30 mph', lit: 'yes', sidewalk: 'both' },
  // B: lit secondary high street.
  litSecondary: { highway: 'secondary', maxspeed: '30 mph', lit: 'yes', sidewalk: 'both' },
  // C: unmapped residential, 30 mph, no lit tag.
  unmappedResidential: { highway: 'residential', maxspeed: '30 mph' },
  // D: lit footway between houses.
  litFootway: { highway: 'footway', lit: 'yes' },
  // E: unlit footway through a park.
  parkPath: { highway: 'footway' },
  // F: residential, lit=no.
  unlitResidential: { highway: 'residential', lit: 'no' },
  // H1: service lane, lighting unknown. H2: the same lane tagged lit=no.
  serviceLane: { highway: 'service' },
  unlitServiceLane: { highway: 'service', lit: 'no' },
  // K: lit tertiary with sidewalk.
  litTertiary: { highway: 'tertiary', lit: 'yes', sidewalk: 'both' },
};

/** Two open pubs (open at 23:00 and at 12:00) within 80 m of the target midpoint. */
const TWO_PUBS = [
  { at: [MIDPOINT[0] - 15, 15], tags: { amenity: 'pub' } },
  { at: [MIDPOINT[0] + 15, -15], tags: { amenity: 'pub' } },
];

/** Archetype scenes, keyed by the spec letter. */
const ARCHETYPES = {
  A: () => buildScene({ ways: continuedStreet(TAGS.litResidential), places: TWO_PUBS }),

  B: () => buildScene({
    ways: continuedStreet(TAGS.litSecondary),
    places: [
      { at: [MIDPOINT[0] - 20, 10], tags: { amenity: 'pub' } },
      { at: [MIDPOINT[0] + 10, -10], tags: { amenity: 'restaurant' } },
      { at: [MIDPOINT[0] + 25, 20], tags: { amenity: 'pub' } },
    ],
    cctv: [[MIDPOINT[0] + 5, 6]],
    transit: [[MIDPOINT[0] - 10, 8]],
    crimes: [{ at: [MIDPOINT[0] + 30, 10], category: 'other-theft' }],
  }),

  C: () => buildScene({ ways: continuedStreet(TAGS.unmappedResidential) }),

  D: () => buildScene({
    ways: continuedStreet(TAGS.litFootway),
    lamps: [[20, 12], [75, 12], [130, 12]],
  }),

  E: () => buildScene({
    ways: [
      ...continuedStreet(TAGS.parkPath),
      // A lit road 75 m south: lamps are mapped in the area but not beside the path.
      { name: 'lampRoad', tags: { highway: 'residential', lit: 'yes' }, points: [[-60, -75], [210, -75]] },
    ],
    lamps: [-25, 0, 25, 50, 75, 100, 125, 150, 175, 200].map((e) => [e, -70]),
  }),

  F: () => buildScene({ ways: continuedStreet(TAGS.unlitResidential) }),

  // G is A in a crime hotspot: twenty violent crimes in the target's 500 m cell.
  G: () => buildScene({
    ways: continuedStreet(TAGS.litResidential),
    places: TWO_PUBS,
    crimes: Array.from({ length: 20 }, () => ({ at: MIDPOINT, category: 'violent-crime' })),
  }),

  // H1: a dead-end service lane (no east stub), lighting unknown, no lamps, no places.
  H1: () => buildScene({ ways: continuedStreet(TAGS.serviceLane, { eastStub: false }) }),

  // H2: the same dead-end service lane, tagged lit=no.
  H2: () => buildScene({ ways: continuedStreet(TAGS.unlitServiceLane, { eastStub: false }) }),

  K: () => buildScene({ ways: continuedStreet(TAGS.litTertiary) }),
};

/**
 * Target score ranges (inclusive), keyed by archetype letter. These are product targets: a failing
 * range means the model's calibration is off, not that the range should move. Shared by the
 * calibration test and scripts/eval/calibration-table.js.
 */
const RANGES = {
  A: [68, 85],
  B: [75, 92],
  C: [55, 72],
  D: [55, 75],
  E: [12, 35],
  F: [22, 42],
  G: [38, 58],
  H1: [38, 58],
  H2: [15, 35],
  K: [65, 85],
};

/**
 * Route chain: seven 150 m segments end to end. The route is the middle five, so no route
 * edge is a chain end. segmentTags(i) gives the tags and places for segment i.
 */
function chainScene(segmentFor, { lamps = [] } = {}) {
  const ways = [];
  const places = [];
  for (let i = 0; i < 7; i++) {
    const { tags, places: segPlaces = [] } = segmentFor(i);
    const from = [i * TARGET_LENGTH_M, 0];
    const to = [(i + 1) * TARGET_LENGTH_M, 0];
    ways.push({ name: `seg${i}`, tags, points: [from, to] });
    for (const pl of segPlaces) {
      places.push({ at: [pl.at[0] + i * TARGET_LENGTH_M, pl.at[1]], tags: pl.tags });
    }
  }
  // The chain is 1.05 km long, so the background grid is extended to cover it.
  return buildScene({ ways, places, lamps, backgroundEastMax: 1700 });
}

const ROUTE_SEGMENTS = [1, 2, 3, 4, 5];

/** Pubs for one A-type segment, placed relative to its own midpoint (chainScene shifts by segment). */
const SEGMENT_PUBS = [
  { at: [MIDPOINT[0] - 15, 15], tags: { amenity: 'pub' } },
  { at: [MIDPOINT[0] + 15, -15], tags: { amenity: 'pub' } },
];

const ROUTES = {
  allA: () => chainScene(() => ({ tags: TAGS.litResidential, places: SEGMENT_PUBS })),
  allC: () => chainScene(() => ({ tags: TAGS.unmappedResidential })),
  allE: () => chainScene(() => ({ tags: TAGS.parkPath }), {
    lamps: Array.from({ length: 50 }, (_, k) => [-25 + k * 25, -70]),
  }),
  // Four A segments and one E segment in the route: E is 20% of the route length.
  mixedAE: () => chainScene((i) => (i === 3
    ? { tags: TAGS.parkPath }
    : { tags: TAGS.litResidential, places: SEGMENT_PUBS }), {
    lamps: Array.from({ length: 50 }, (_, k) => [-25 + k * 25, -70]),
  }),
};

/** Edges of a route-chain graph for the route segments, in route order. */
function routeEdgeIdxs(graph) {
  return ROUTE_SEGMENTS.map((i) => graph.edges.findIndex((e) => e.roadName === `seg${i}`));
}

module.exports = {
  ORIGIN,
  NIGHT,
  DAY,
  TARGET_LENGTH_M,
  ARCHETYPES,
  RANGES,
  ROUTES,
  ROUTE_SEGMENTS,
  routeEdgeIdxs,
  buildScene,
  toLatLon,
};

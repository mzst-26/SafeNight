/**
 * safetyGraph.js — Optimised safety-first walking graph + pathfinding.
 *
 * MODEL: v2 (default) scores each edge from five factors (lighting, crime, road,
 * activity, isolation) and ranks routes by exposure; see backend/src/safety/scoring/.
 * SAFETY_MODEL=v1 selects the legacy weighted-sum path for A/B until final cleanup.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * SPEED OPTIMISATIONS (vs v1):
 *   1. A* with haversine heuristic — 3–10× faster than plain Dijkstra
 *      by focusing the search toward the destination
 *   2. Spatial-grid findNearestNode — O(1) instead of O(n) brute force
 *   3. Pre-computed coverage maps — lighting/crime/place density is
 *      computed once across a grid, then sampled per-edge, eliminating
 *      thousands of individual findNearby calls
 *   4. fastDistance() for proximity checks — 5× faster than haversine
 *   5. Numeric spatial-grid keys — faster hash than string keys
 *
 * ACCURACY IMPROVEMENTS (vs v1):
 *   1. Crime severity weighting — violent crimes penalised 3× more
 *      than shoplifting (robbery=1.0, shoplifting=0.2)
 *   2. Inverse-distance lighting — lamp 5m away = much brighter than
 *      one 45m away (uses 1/d² falloff)
 *   3. CCTV cameras — new safety factor from OSM surveillance data
 *   4. Time-of-day awareness — crime weight increases after midnight,
 *      open-place weight adjusts for likelihood of being open
 *   5. Surface quality — unpaved paths penalised (scarier at night)
 *   6. Dead-end detection — segments leading to dead-ends penalised
 *      (harder to escape dangerous situation)
 * ═══════════════════════════════════════════════════════════════════════
 */

const { haversine, fastDistance, buildSpatialGrid, findNearby, countNearby } = require('./geo');
const { scoreFromCache } = require('./lightsCacheClient');
const { SAFETY_LEVEL_STANDARD, SAFETY_LEVEL_EXTRA } = require('./safetyLevels');
const opening_hours_lib = require('opening_hours');
const {
  inferLighting, effectiveLit, parseMaxspeedKmh, SIDEWALK_LIKE_HIGHWAYS,
} = require('../scoring/lightingInference');
const { buildRoadProximityIndex, isNearRoad, ROAD_HIGHWAYS } = require('../scoring/roadProximity');
const { darknessForHour } = require('../scoring/darkness');
const { getWeights: getFactorWeights } = require('../scoring/weights');
const { edgeRisk } = require('../scoring/edgeRisk');
const { crimeRisk, weightedCrimeCount } = require('../scoring/crimeRisk');
const { aggregateRoute, rankRoutes } = require('../scoring/routeAggregate');
const { PRIOR_SAFETY, ACTIVITY_FLOOR, HAZARD_SPEED_KMH, LAMP_RADIUS_M } = require('../scoring/config');
const { severityOf } = require('./crimeSeverity');

const ENABLE_PLACE_OPENING_HOURS_PARSE = process.env.SAFE_ROUTES_PARSE_PLACE_OPENING_HOURS === '1';
const DEBUG_SAFE_ROUTES = process.env.SAFE_ROUTES_DEBUG === '1';
const debugLog = DEBUG_SAFE_ROUTES ? (...args) => console.log(...args) : () => {};

// ── Model selection (A/B) ───────────────────────────────────────────────────
// v2 is the default. SAFETY_MODEL=v1 keeps the legacy scoring path until the final cleanup.
// Read on every call so tests can toggle it.
function currentModel() {
  return process.env.SAFETY_MODEL === 'v1' ? 'v1' : 'v2';
}

function useV2() {
  return currentModel() === 'v2';
}

function createSearchCancelledError(message = 'Route search cancelled.') {
  const err = new Error(message);
  err.code = 'SEARCH_CANCELLED';
  err.statusCode = 409;
  return err;
}

function throwIfCancelled(shouldCancel) {
  if (typeof shouldCancel === 'function' && shouldCancel()) {
    throw createSearchCancelledError('Route search cancelled during graph computation.');
  }
}

// ── Road hierarchy scoring ──────────────────────────────────────────────────
const ROAD_TYPE_SCORES = {
  trunk: 0.90,
  primary: 0.95,
  secondary: 0.85,
  tertiary: 0.75,
  unclassified: 0.55,
  residential: 0.50,
  living_street: 0.55,
  service: 0.40,
  pedestrian: 0.60,
  cycleway: 0.35,
  footway: 0.25,
  path: 0.15,
  steps: 0.10,
  track: 0.10,
};

const WALKABLE_HIGHWAYS = new Set(Object.keys(ROAD_TYPE_SCORES));

// Surface penalty for unpaved surfaces (unpaved is scarier at night). Shared by v1 and v2.
const SURFACE_PENALTIES = {
  gravel: 0.04,
  dirt: 0.06,
  grass: 0.04,
  mud: 0.12,
  sand: 0.08,
  earth: 0.06,
};

// ── v2 constants (spec section 11) ──────────────────────────────────────────
// Tunables shared by the scoring modules live in scoring/config.js. These are the
// graph-level ones: evidence strength per factor, grids and the isolation penalties.
const V2 = Object.freeze({
  // Evidence strength (n) for the factors that are not produced by inferLighting or crimeRisk.
  ROAD_N: 10,        // road class is an OSM tag, so the class itself is well evidenced
  ACTIVITY_N: 8,     // counts of places, CCTV and transit within fixed radii
  ISOLATION_N: 6,    // dead ends come from topology; footpath lamp checks are local
  CACHE_LIGHT_N: 6,  // a non-verified lights-cache record (status lit, limited or unlit)
  // Isolation penalties (safety units). A dead end halves safety (was 0.3) and an isolated path with no mapped
  // lamp within LAMP_NEAR_PATH_M leaves almost none (was 0.25): nobody passes by and nothing is lit. Sidewalks
  // (footway-like ways within reach of a road) never take the path penalty. Tuned jointly with BASE_WEIGHTS
  // against the calibration archetypes: a pedestrian alone on a dark path at 23:00 must read Use Caution.
  DEAD_END_PENALTY: 0.5,
  UNLIT_PATH_PENALTY: 0.95,
  // Cells for area stats and crime aggregation.
  AREA_CELL_DEG: 0.003,   // ~300 m, the area in which lamp density is judged
  CRIME_CELL_M: 500,      // crime aggregation cell
  CRIME_PRIOR_FLOOR: 0.1, // weighted crimes per km, lowest allowed area prior
  // Activity radii (m).
  CCTV_RADIUS_M: 80,
  PLACE_RADIUS_M: 80,
  TRANSIT_RADIUS_M: 150,
  LAMP_NEAR_PATH_M: 60,
});

// Path classes for the unlit-path isolation penalty.
const PATH_CLASS_HIGHWAYS = new Set(['path', 'track', 'bridleway', 'footway', 'steps', 'cycleway']);

// ── Time-adaptive weights ───────────────────────────────────────────────────
// Weights shift based on time of day (late night = crime matters more)
// Standard level has no CCTV or place data, so those weights are dropped and the
// remaining weights are rescaled to sum to 1 (keeps scores on the same scale).
function getV1Weights(hour, level = SAFETY_LEVEL_EXTRA) {
  const base = getBaseWeights(hour);
  if (level !== SAFETY_LEVEL_STANDARD) return base;

  const { cctv, openPlaces, ...rest } = base;
  const total = Object.values(rest).reduce((sum, w) => sum + w, 0);
  const scaled = Object.fromEntries(
    Object.entries(rest).map(([k, w]) => [k, w / total]),
  );
  return { ...scaled, cctv: 0, openPlaces: 0 };
}

function getBaseWeights(hour) {
  // hour = 0–23
  const h = typeof hour === 'number' && hour >= 0 && hour <= 23 ? hour : new Date().getHours();
  const isLateNight = h >= 0 && h < 5;   // midnight–5am
  const isEvening = h >= 18 || h < 0;     // 6pm–midnight

  if (isLateNight) {
    return {
      roadType: 0.22,
      lighting: 0.28,     // lighting matters most late night
      crimeRate: 0.25,    // crime matters more
      cctv: 0.08,         // CCTV is a reassurance factor
      openPlaces: 0.07,   // fewer places open, less weight
      gpsTraffic: 0.10,
    };
  }
  if (isEvening) {
    return {
      roadType: 0.23,
      lighting: 0.25,
      crimeRate: 0.22,
      cctv: 0.07,
      openPlaces: 0.12,
      gpsTraffic: 0.11,
    };
  }
  // Daytime fallback (shouldn't normally be used — app is for night)
  return {
    roadType: 0.25,
    lighting: 0.15,
    crimeRate: 0.20,
    cctv: 0.05,
    openPlaces: 0.15,
    gpsTraffic: 0.20,
  };
}

// ── Coverage maps ───────────────────────────────────────────────────────────
// Pre-compute density grids so edge scoring is O(1) per edge.
// Cell size ~25m for fine granularity.
const COVERAGE_CELL_DEG = 0.0005; // ~56m – halved resolution to save memory/CPU

/**
 * Build a lighting coverage map using inverse-distance-squared weighting.
 * Each cell gets a "brightness" value 0–1 based on nearby lamps.
 */
function buildLightingCoverage(lightNodes, litWayNodePositions, bbox, shouldCancel) {
  const rows = Math.ceil((bbox.north - bbox.south) / COVERAGE_CELL_DEG);
  const cols = Math.ceil((bbox.east - bbox.west) / COVERAGE_CELL_DEG);
  const grid = new Float32Array(rows * cols); // flat 2D array

  const LAMP_RADIUS = 60; // metres — effective illumination range
  const LAMP_RADIUS_DEG = LAMP_RADIUS / 111320;
  let iterations = 0;

  // Stamp each lamp's influence into the grid
  for (const lamp of lightNodes) {
    if ((iterations & 1023) === 0) throwIfCancelled(shouldCancel);
    const rMin = Math.max(0, Math.floor((lamp.lat - LAMP_RADIUS_DEG - bbox.south) / COVERAGE_CELL_DEG));
    const rMax = Math.min(rows - 1, Math.ceil((lamp.lat + LAMP_RADIUS_DEG - bbox.south) / COVERAGE_CELL_DEG));
    const cMin = Math.max(0, Math.floor((lamp.lng - LAMP_RADIUS_DEG - bbox.west) / COVERAGE_CELL_DEG));
    const cMax = Math.min(cols - 1, Math.ceil((lamp.lng + LAMP_RADIUS_DEG - bbox.west) / COVERAGE_CELL_DEG));

    for (let r = rMin; r <= rMax; r++) {
      for (let c = cMin; c <= cMax; c++) {
        const cellLat = bbox.south + (r + 0.5) * COVERAGE_CELL_DEG;
        const cellLng = bbox.west + (c + 0.5) * COVERAGE_CELL_DEG;
        if (
          Math.abs(cellLat - lamp.lat) > LAMP_RADIUS_DEG ||
          Math.abs(cellLng - lamp.lng) > LAMP_RADIUS_DEG
        ) {
          iterations += 1;
          continue;
        }
        const d = fastDistance(lamp.lat, lamp.lng, cellLat, cellLng);
        if (d < LAMP_RADIUS) {
          // Inverse-distance-squared falloff: light at 5m >> light at 50m
          const intensity = Math.min(1.0, 1.0 / (1 + (d / 12) ** 2));
          const idx = r * cols + c;
          grid[idx] = Math.min(1.0, grid[idx] + intensity);
        }
        iterations += 1;
      }
    }
  }

  // Mark lit-way positions
  for (const pos of litWayNodePositions) {
    if ((iterations & 1023) === 0) throwIfCancelled(shouldCancel);
    const r = Math.floor((pos.lat - bbox.south) / COVERAGE_CELL_DEG);
    const c = Math.floor((pos.lng - bbox.west) / COVERAGE_CELL_DEG);
    if (r >= 0 && r < rows && c >= 0 && c < cols) {
      grid[r * cols + c] = Math.min(1.0, grid[r * cols + c] + 0.7);
    }
    iterations += 1;
  }

  return { grid, rows, cols, bbox };
}

/**
 * Build a crime severity density map.
 * Each cell accumulates severity-weighted crime density.
 */
function buildCrimeCoverage(crimes, bbox, shouldCancel) {
  const rows = Math.ceil((bbox.north - bbox.south) / COVERAGE_CELL_DEG);
  const cols = Math.ceil((bbox.east - bbox.west) / COVERAGE_CELL_DEG);
  const grid = new Float32Array(rows * cols);

  const CRIME_RADIUS = 120; // metres — crime influence radius
  const CRIME_RADIUS_DEG = CRIME_RADIUS / 111320;
  let iterations = 0;

  for (const crime of crimes) {
    if ((iterations & 1023) === 0) throwIfCancelled(shouldCancel);
    const rMin = Math.max(0, Math.floor((crime.lat - CRIME_RADIUS_DEG - bbox.south) / COVERAGE_CELL_DEG));
    const rMax = Math.min(rows - 1, Math.ceil((crime.lat + CRIME_RADIUS_DEG - bbox.south) / COVERAGE_CELL_DEG));
    const cMin = Math.max(0, Math.floor((crime.lng - CRIME_RADIUS_DEG - bbox.west) / COVERAGE_CELL_DEG));
    const cMax = Math.min(cols - 1, Math.ceil((crime.lng + CRIME_RADIUS_DEG - bbox.west) / COVERAGE_CELL_DEG));

    const severity = Number.isFinite(crime.severity) ? crime.severity : severityOf(crime.category);

    for (let r = rMin; r <= rMax; r++) {
      for (let c = cMin; c <= cMax; c++) {
        const cellLat = bbox.south + (r + 0.5) * COVERAGE_CELL_DEG;
        const cellLng = bbox.west + (c + 0.5) * COVERAGE_CELL_DEG;
        if (
          Math.abs(cellLat - crime.lat) > CRIME_RADIUS_DEG ||
          Math.abs(cellLng - crime.lng) > CRIME_RADIUS_DEG
        ) {
          iterations += 1;
          continue;
        }
        const d = fastDistance(crime.lat, crime.lng, cellLat, cellLng);
        if (d < CRIME_RADIUS) {
          // Distance-weighted severity: closer crime = more impact
          const impact = severity / (1 + (d / 30) ** 1.5);
          grid[r * cols + c] += impact;
        }
        iterations += 1;
      }
    }
  }

  return { grid, rows, cols, bbox };
}

/**
 * Sample a coverage grid at a lat/lng position. Returns 0–1 (clamped).
 */
function sampleCoverage(coverage, lat, lng) {
  const r = Math.floor((lat - coverage.bbox.south) / COVERAGE_CELL_DEG);
  const c = Math.floor((lng - coverage.bbox.west) / COVERAGE_CELL_DEG);
  if (r < 0 || r >= coverage.rows || c < 0 || c >= coverage.cols) return 0;
  return coverage.grid[r * coverage.cols + c];
}

// ═══════════════════════════════════════════════════════════════════════════════
// GRAPH BUILDING
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Build a walking graph from raw OSM data with pre-computed coverage maps.
 *
 * Uses coverage maps for lighting and crime (O(1) per edge) instead of
 * per-edge findNearby calls (which were thousands of spatial lookups).
 */
async function buildGraphV1(roadData, lightData, cctvData, placeData, transitData, crimes, bbox, options = {}) {
  const shouldCancel = options && typeof options.shouldCancel === 'function'
    ? options.shouldCancel
    : null;
  const hour = options.hour != null ? options.hour : new Date().getHours();
  const weights = getV1Weights(hour, options?.level);

  // 1. Index all OSM nodes by ID
  const osmNodes = new Map();
  let workCounter = 0;
  for (const el of roadData.elements) {
    if ((workCounter & 2047) === 0) throwIfCancelled(shouldCancel);
    if (el.type === 'node') {
      osmNodes.set(el.id, { lat: el.lat, lng: el.lon, id: el.id });
    }
    workCounter += 1;
  }

  // 2. Build coverage maps (batch pre-computation)
  const lightNodes = [];
  const litWayNodePositions = [];
  const litWayNodeIds = new Set();
  if (lightData) {
    for (const el of lightData.elements) {
      if ((workCounter & 2047) === 0) throwIfCancelled(shouldCancel);
      if (el.type === 'node' && el.tags?.highway === 'street_lamp') {
        lightNodes.push({ lat: el.lat, lng: el.lon });
      }
      if (el.type === 'way' && el.tags?.lit === 'yes' && el.nodes) {
        for (const nid of el.nodes) {
          litWayNodeIds.add(nid);
          const n = osmNodes.get(nid);
          if (n) litWayNodePositions.push({ lat: n.lat, lng: n.lng });
        }
      }
      workCounter += 1;
    }
  }

  debugLog(`[graph] Building lighting coverage map (${lightNodes.length} lamps)...`);
  const lightCoverage = buildLightingCoverage(lightNodes, litWayNodePositions, bbox, shouldCancel);

  debugLog(`[graph] Building crime coverage map (${crimes.length} crimes)...`);
  const crimeCoverage = buildCrimeCoverage(crimes, bbox, shouldCancel);

  // 3. Build spatial grids for CCTV, places, transit (still need proximity)
  const cctvNodes = [];
  if (cctvData) {
    for (const el of cctvData.elements) {
      if ((workCounter & 2047) === 0) throwIfCancelled(shouldCancel);
      if (el.type === 'node' && el.lat && el.lon) {
        cctvNodes.push({ lat: el.lat, lng: el.lon });
      }
      workCounter += 1;
    }
  }
  const cctvGrid = buildSpatialGrid(cctvNodes);

  const placeNodes = [];
  if (placeData) {
    const hour = new Date().getHours();
    for (const el of placeData.elements) {
      if ((workCounter & 2047) === 0) throwIfCancelled(shouldCancel);
      const lat = el.lat || el.center?.lat;
      const lng = el.lon || el.center?.lon;
      if (lat && lng) {
        const hoursRaw = el.tags?.opening_hours || '';
        let isOpen = null;
        // 1) Optional: parse OSM opening_hours when explicitly enabled.
        if (ENABLE_PLACE_OPENING_HOURS_PARSE && hoursRaw) {
          try {
            const cleaned = hoursRaw
              .split(';').map(s => s.trim())
              .filter(s => !/^\s*PH\b/.test(s))
              .map(s => s.replace(/,\s*PH\b/g, ''))
              .filter(Boolean).join('; ');
            if (cleaned) {
              const oh = new opening_hours_lib(cleaned, { address: { country_code: 'gb' } });
              isOpen = oh.getState(new Date());
            }
          } catch { isOpen = null; }
        }
        // 2) Fall back to time-of-day heuristic
        if (isOpen === null) {
          const type = (el.tags?.amenity || el.tags?.shop || '').toLowerCase();
          const always = ['hospital','clinic','pharmacy','fuel','atm','police','fire_station','hotel','hostel','parking','toilets'];
          const evening = ['pub','bar','nightclub','biergarten','casino','restaurant','fast_food','food_court','ice_cream','cafe'];
          const extendedShops = ['convenience','supermarket','kiosk','mall'];
          if (always.includes(type)) isOpen = true;
          else if (evening.includes(type)) isOpen = hour >= 10 && hour < 24;
          else if (extendedShops.includes(type)) isOpen = hour >= 6 && hour < 23;
          else isOpen = hour >= 7 && hour < 20;
        }
        if (!isOpen) continue;
        placeNodes.push({
          lat, lng,
          amenity: el.tags?.amenity,
          opening_hours: hoursRaw,
        });
      }
      workCounter += 1;
    }
  }
  const placeGrid = buildSpatialGrid(placeNodes);

  const transitNodes = [];
  if (transitData) {
    for (const el of transitData.elements) {
      if (el.type === 'node' && el.lat && el.lon) {
        transitNodes.push({ lat: el.lat, lng: el.lon });
      }
    }
  }
  const transitGrid = buildSpatialGrid(transitNodes);

  // 4. Build node spatial grid for O(1) nearest-node lookup
  const nodeArray = [];
  for (const [id, node] of osmNodes) {
    if ((workCounter & 4095) === 0) throwIfCancelled(shouldCancel);
    nodeArray.push({ lat: node.lat, lng: node.lng, id });
    workCounter += 1;
  }
  const nodeGrid = buildSpatialGrid(nodeArray, 'lat', 'lng', 0.001); // ~110m cells

  // 5. Detect dead-end nodes (degree = 1)
  const nodeDegree = new Map();

  // 6. Build edges from ways
  const edges = [];
  const adjacency = new Map();

  for (const el of roadData.elements) {
    if ((workCounter & 1023) === 0) throwIfCancelled(shouldCancel);
    if (el.type !== 'way' || !el.nodes || !el.tags?.highway) continue;
    const highway = el.tags.highway;
    if (!WALKABLE_HIGHWAYS.has(highway)) continue;

    const wayTags = el.tags;
    const nodeIds = el.nodes;

    for (let i = 0; i < nodeIds.length - 1; i++) {
      if ((workCounter & 1023) === 0) throwIfCancelled(shouldCancel);
      const nA = osmNodes.get(nodeIds[i]);
      const nB = osmNodes.get(nodeIds[i + 1]);
      if (!nA || !nB) continue;
      const edgeIdx = edges.length;

      const dist = fastDistance(nA.lat, nA.lng, nB.lat, nB.lng);
      if (dist < 0.5) continue;

      const midLat = (nA.lat + nB.lat) / 2;
      const midLng = (nA.lng + nB.lng) / 2;

      // ── Score each factor ──

      // Road type
      const roadScore = ROAD_TYPE_SCORES[highway] || 0.3;

      // Lighting — cache-first, then coverage map
      let lightScore = sampleCoverage(lightCoverage, midLat, midLng);
      const edgeLightCache = options.lightsCacheByEdgeIdx?.get(edgeIdx) || null;

      // Check cache for this segment (best effort, non-blocking)
      if (edgeLightCache) {
        const cached = scoreFromCache(edgeLightCache);
        if (cached) {
          lightScore = cached.score;
        }
      }

      // Override with explicit way tags (tags are ground truth)
      if (wayTags.lit === 'yes') lightScore = Math.max(lightScore, 0.90);
      if (wayTags.lit === 'no') lightScore = Math.min(lightScore, 0.10);
      if (wayTags.lit === 'limited') lightScore = Math.max(lightScore, 0.40);

      // Hard cap for verified-unlit segments
      const isVerifiedUnlit = edgeLightCache?.lit_status === 'unlit' && (edgeLightCache.confidence || 0) >= 0.8;
      if (isVerifiedUnlit) {
        lightScore = Math.min(lightScore, 0.05);
      }

      lightScore = Math.max(0.0, Math.min(1.0, lightScore));

      // Crime — sample from severity-weighted coverage map
      const crimeDensity = sampleCoverage(crimeCoverage, midLat, midLng);
      const crimeScore = Math.max(0, 1.0 - Math.min(1.0, crimeDensity * 0.5));

      // CCTV — nearby surveillance cameras
      const nearbyCctv = countNearby(cctvGrid, midLat, midLng, 80);
      const cctvScore = Math.min(1.0, nearbyCctv * 0.4);

      // Open places — activity within 80m
      const nearbyPlaces = countNearby(placeGrid, midLat, midLng, 80);
      // At night, apply a discount — many places will be closed
      const nightDiscount = (hour >= 22 || hour < 6) ? 0.4 : (hour >= 18 ? 0.7 : 1.0);
      const placeScore = Math.min(1.0, nearbyPlaces * 0.15 * nightDiscount);

      // Foot traffic proxy
      const nearbyTransit = countNearby(transitGrid, midLat, midLng, 150);
      let trafficScore = (ROAD_TYPE_SCORES[highway] || 0.3) * 0.7 +
        Math.min(0.3, nearbyTransit * 0.1) + 0.1;
      if (wayTags.sidewalk && wayTags.sidewalk !== 'no') {
        trafficScore = Math.min(1.0, trafficScore + 0.15);
      }
      trafficScore = Math.min(1.0, trafficScore);

      // Surface penalty — unpaved is scarier at night (graded)
      const surface = wayTags.surface;
      const surfacePenalty = SURFACE_PENALTIES[surface] || 0;
      const verifiedUnlitPenalty = isVerifiedUnlit
        ? Math.min(0.18, 0.08 + ((edgeLightCache.confidence || 0) * 0.12))
        : 0;

      // ── Combine into single safety score ──
      const safetyScore = Math.max(0.01,
        weights.roadType * roadScore +
        weights.lighting * lightScore +
        weights.crimeRate * crimeScore +
        weights.cctv * cctvScore +
        weights.openPlaces * placeScore +
        weights.gpsTraffic * trafficScore -
        surfacePenalty -
        verifiedUnlitPenalty
      );

      // Extra metadata for frontend
      const hasSidewalk = !!(wayTags.sidewalk && wayTags.sidewalk !== 'no');
      const surfaceType = surface || 'paved';
      const roadName = wayTags.name || '';
      const maxspeed = wayTags.maxspeed || '';
      const isTunnel = wayTags.tunnel === 'yes';
      const litTag = wayTags.lit || null;
      const isLit = litTag === 'yes';
      edges.push({
        idx: edgeIdx,
        from: nodeIds[i],
        to: nodeIds[i + 1],
        distance: dist,
        highway,
        safetyScore,
        roadScore,
        lightScore,
        crimeScore,
        cctvScore,
        placeScore,
        trafficScore,
        penalty: 0,
        hasSidewalk,
        surfaceType,
        roadName,
        nearbyCctvCount: nearbyCctv,
        nearbyTransitCount: nearbyTransit,
        surfacePenalty,
        maxspeed,
        isTunnel,
        isLit,
        litTag,
      });

      // Bidirectional adjacency
      if (!adjacency.has(nodeIds[i])) adjacency.set(nodeIds[i], []);
      if (!adjacency.has(nodeIds[i + 1])) adjacency.set(nodeIds[i + 1], []);
      adjacency.get(nodeIds[i]).push({ edgeIdx, neighborId: nodeIds[i + 1] });
      adjacency.get(nodeIds[i + 1]).push({ edgeIdx, neighborId: nodeIds[i] });

      // Track node degree for dead-end detection
      nodeDegree.set(nodeIds[i], (nodeDegree.get(nodeIds[i]) || 0) + 1);
      nodeDegree.set(nodeIds[i + 1], (nodeDegree.get(nodeIds[i + 1]) || 0) + 1);
      workCounter += 1;
    }
    workCounter += 1;
  }

  // 7. Apply dead-end penalty — edges leading to degree-1 nodes are less safe
  // Context-aware: darker dead-ends penalised more than well-lit ones
  for (const edge of edges) {
    if ((workCounter & 2047) === 0) throwIfCancelled(shouldCancel);
    const fromDeg = nodeDegree.get(edge.from) || 0;
    const toDeg = nodeDegree.get(edge.to) || 0;
    const isDeadEnd = fromDeg <= 1 || toDeg <= 1;
    if (isDeadEnd) {
      const lightFactor = 1 - (edge.lightScore || 0);
      const deadEndPenalty = 0.02 + (0.08 * lightFactor);
      edge.safetyScore = Math.max(0.01, edge.safetyScore - deadEndPenalty);
    }
    edge.isDeadEnd = isDeadEnd;
    workCounter += 1;
  }

  return { osmNodes, edges, adjacency, nodeGrid, weights, cctvNodes, transitNodes, nodeDegree, edgeConfidences: [] };
}

// ═══════════════════════════════════════════════════════════════════════════════
// V2 GRAPH BUILD (spec section 11): five factors combined into one edge risk
// ═══════════════════════════════════════════════════════════════════════════════

/** Dispatches on the SAFETY_MODEL flag. v1 stays available for A/B until cleanup. */
async function buildGraph(roadData, lightData, cctvData, placeData, transitData, crimes, bbox, options = {}) {
  if (!useV2()) return buildGraphV1(roadData, lightData, cctvData, placeData, transitData, crimes, bbox, options);
  return buildGraphV2(roadData, lightData, cctvData, placeData, transitData, crimes, bbox, options);
}

const LONDON_HOUR_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  hour: 'numeric',
  hourCycle: 'h23',
});

/** London wall-clock hour (0-23) of an instant. */
function londonHourOf(date) {
  const part = LONDON_HOUR_FORMAT.formatToParts(date).find((p) => p.type === 'hour');
  return Number(part.value) % 24;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function hasOwnKey(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

/** Calendar month index (year * 12 + zero-based month) of a 'YYYY-MM' string, or null if malformed. */
function monthIndexOf(month) {
  const match = typeof month === 'string' ? /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month) : null;
  return match ? Number(match[1]) * 12 + (Number(match[2]) - 1) : null;
}

/**
 * Adapter from crimeClient rows ({category, month: 'YYYY-MM'}) to the {category, monthsAgo}
 * input of weightedCrimeCount. Recency is measured back from the NEWEST month present in the
 * rows, not from today: the Police API publishes a couple of months late, so anchoring on the
 * clock would discount every crime in the latest release. A missing or malformed month counts
 * as the newest month (full weight), so bad rows never read as zero harm.
 * @param {Array<{category: string, month?: string}>} crimes
 * @returns {Array<{category: string, monthsAgo: number}>}
 */
function crimesToWeightedCounts(crimes) {
  const indexes = crimes.map((crime) => monthIndexOf(crime.month));
  const newest = Math.max(...indexes.filter((i) => i !== null), -Infinity);
  return crimes.map((crime, i) => ({
    category: crime.category,
    monthsAgo: indexes[i] === null ? 0 : newest - indexes[i],
  }));
}

/** Area cell (about 300 m) used for lamp density and road length. */
function areaCellKey(lat, lng) {
  return `${Math.floor(lat / V2.AREA_CELL_DEG)},${Math.floor(lng / V2.AREA_CELL_DEG)}`;
}

/** Returns a function mapping (lat, lng) to a ~500 m crime cell key, anchored at the bbox. */
function crimeCellKeyFn(bbox) {
  const midLatRad = ((bbox.north + bbox.south) / 2) * (Math.PI / 180);
  const latDeg = V2.CRIME_CELL_M / 111320;
  const lngDeg = V2.CRIME_CELL_M / (111320 * Math.cos(midLatRad));
  return (lat, lng) => `${Math.floor((lat - bbox.south) / latDeg)},${Math.floor((lng - bbox.west) / lngDeg)}`;
}

/** Edge lit estimate label. Only tags and lamps count as 'lit', only tags and cache as 'unlit'. */
function litEstimateOf(source, effective) {
  if ((source === 'tag' || source === 'lamp') && effective >= 0.7) return 'lit';
  if ((source === 'tag' || source === 'cache') && effective <= 0.2) return 'unlit';
  return effective >= 0.5 ? 'estimated_lit' : 'estimated_unlit';
}

/**
 * Open or closed at a London hour. Mirrors the v1 heuristic, but takes the hour and
 * instant from the caller, so the result never depends on the server clock.
 */
function isPlaceOpenV2(tags, hour, now) {
  const hoursRaw = tags?.opening_hours || '';
  let isOpen = null;
  if (ENABLE_PLACE_OPENING_HOURS_PARSE && hoursRaw) {
    try {
      const cleaned = hoursRaw
        .split(';').map((s) => s.trim())
        .filter((s) => !/^\s*PH\b/.test(s))
        .map((s) => s.replace(/,\s*PH\b[^;]*/g, ''))
        .filter(Boolean).join('; ');
      if (cleaned) {
        const oh = new opening_hours_lib(cleaned, { address: { country_code: 'gb' } });
        isOpen = oh.getState(now);
      }
    } catch { isOpen = null; }
  }
  if (isOpen === null) {
    const type = (tags?.amenity || tags?.shop || '').toLowerCase();
    const always = ['hospital', 'clinic', 'pharmacy', 'fuel', 'atm', 'police', 'fire_station', 'hotel', 'hostel', 'parking', 'toilets'];
    const evening = ['pub', 'bar', 'nightclub', 'biergarten', 'casino', 'restaurant', 'fast_food', 'food_court', 'ice_cream', 'cafe'];
    const extendedShops = ['convenience', 'supermarket', 'kiosk', 'mall'];
    if (always.includes(type)) isOpen = true;
    else if (evening.includes(type)) isOpen = hour >= 10 && hour < 24;
    else if (extendedShops.includes(type)) isOpen = hour >= 6 && hour < 23;
    else isOpen = hour >= 7 && hour < 20;
  }
  return Boolean(isOpen);
}

/**
 * Build the walking graph with v2 edge risk.
 *
 * Phase 1 collects geometry for every walkable segment and accumulates per-area lamp
 * counts and road length, and per-crime-cell exposure. Phase 2 scores each edge from
 * the five factors (lighting, crime, road, activity, isolation) and combines them with
 * edgeRisk. Crime outage (crimeStatus 'unavailable') leaves the crime factor unknown.
 *
 * @param {object} options
 * @param {number} [options.hour] London local hour 0-24; defaults to the London hour of options.now.
 * @param {Date} [options.now] Instant used for darkness and opening hours; defaults to the current time.
 * @param {string} [options.level] Data level; 'standard' drops the activity factor.
 * @param {'ok'|'unavailable'} [options.crimeStatus='ok'] Any value other than 'ok' is treated as unavailable.
 */
async function buildGraphV2(roadData, lightData, cctvData, placeData, transitData, crimes, bbox, options = {}) {
  const shouldCancel = options && typeof options.shouldCancel === 'function' ? options.shouldCancel : null;
  const now = options.now instanceof Date ? options.now : new Date();
  const hour = options.hour != null ? options.hour : londonHourOf(now);
  const darkness = darknessForHour({
    lat: (bbox.north + bbox.south) / 2,
    lng: (bbox.east + bbox.west) / 2,
    hour,
    now,
  });
  const weights = getFactorWeights({ darkness, safetyLevel: options.level });
  // Anything other than 'ok' is treated as an outage, so missing crime data never reads as safe.
  const crimeStatus = options.crimeStatus === undefined || options.crimeStatus === 'ok' ? 'ok' : 'unavailable';

  let steps = 0;
  const tick = () => {
    steps += 1;
    if ((steps & 2047) === 0) throwIfCancelled(shouldCancel);
  };

  // 1. Nodes
  const osmNodes = new Map();
  for (const el of roadData.elements) {
    tick();
    if (el.type === 'node') osmNodes.set(el.id, { lat: el.lat, lng: el.lon, id: el.id });
  }

  // 2. Lamps, lit-way nodes, CCTV, places, transit
  const lightNodes = [];
  const litWayNodePositions = [];
  for (const el of lightData?.elements || []) {
    tick();
    if (el.type === 'node' && el.tags?.highway === 'street_lamp') lightNodes.push({ lat: el.lat, lng: el.lon });
    if (el.type === 'way' && el.tags?.lit === 'yes' && el.nodes) {
      for (const nid of el.nodes) {
        const n = osmNodes.get(nid);
        if (n) litWayNodePositions.push({ lat: n.lat, lng: n.lng });
      }
    }
  }

  const cctvNodes = [];
  for (const el of cctvData?.elements || []) {
    tick();
    if (el.type === 'node' && el.lat && el.lon) cctvNodes.push({ lat: el.lat, lng: el.lon });
  }

  const placeElements = placeData?.elements || [];
  const placeNodes = [];
  for (const el of placeElements) {
    tick();
    const lat = el.lat || el.center?.lat;
    const lng = el.lon || el.center?.lon;
    if (lat && lng && isPlaceOpenV2(el.tags, hour, now)) placeNodes.push({ lat, lng });
  }

  const transitNodes = [];
  for (const el of transitData?.elements || []) {
    tick();
    if (el.type === 'node' && el.lat && el.lon) transitNodes.push({ lat: el.lat, lng: el.lon });
  }

  // Activity is unknown only when the area has no place, transit or CCTV data at all.
  const rawActivityCount = placeElements.length
    + (transitData?.elements?.length || 0)
    + (cctvData?.elements?.length || 0);
  const activityAvailable = rawActivityCount > 0;

  const lampGrid = buildSpatialGrid(lightNodes);
  const litGrid = buildSpatialGrid(litWayNodePositions);
  const cctvGrid = buildSpatialGrid(cctvNodes);
  const placeGrid = buildSpatialGrid(placeNodes);
  const transitGrid = buildSpatialGrid(transitNodes);

  const nodeArray = [];
  for (const [id, node] of osmNodes) {
    tick();
    nodeArray.push({ lat: node.lat, lng: node.lng, id });
  }
  const nodeGrid = buildSpatialGrid(nodeArray, 'lat', 'lng', 0.001); // ~110m cells

  // 3. Degree over ALL highway ways, so a footway meeting a motorway is not a dead end.
  const nodeDegree = new Map();
  for (const el of roadData.elements) {
    tick();
    if (el.type !== 'way' || !el.nodes || !el.tags?.highway) continue;
    for (let i = 0; i < el.nodes.length - 1; i++) {
      const a = el.nodes[i];
      const b = el.nodes[i + 1];
      if (!osmNodes.has(a) || !osmNodes.has(b)) continue;
      nodeDegree.set(a, (nodeDegree.get(a) || 0) + 1);
      nodeDegree.set(b, (nodeDegree.get(b) || 0) + 1);
    }
  }

  // 4. Phase 1: walkable segments, geometry only, with area and crime-cell aggregates.
  const pending = [];
  for (const el of roadData.elements) {
    tick();
    if (el.type !== 'way' || !el.nodes || !el.tags?.highway) continue;
    const highway = el.tags.highway;
    if (!WALKABLE_HIGHWAYS.has(highway)) continue;
    for (let i = 0; i < el.nodes.length - 1; i++) {
      const nA = osmNodes.get(el.nodes[i]);
      const nB = osmNodes.get(el.nodes[i + 1]);
      if (!nA || !nB) continue;
      const dist = fastDistance(nA.lat, nA.lng, nB.lat, nB.lng);
      if (dist < 0.5) continue;
      pending.push({
        idx: pending.length,
        from: el.nodes[i],
        to: el.nodes[i + 1],
        nA,
        nB,
        dist,
        highway,
        tags: el.tags,
        midLat: (nA.lat + nB.lat) / 2,
        midLng: (nA.lng + nB.lng) / 2,
      });
    }
  }

  const areaStats = new Map();
  const areaAt = (key) => {
    let stats = areaStats.get(key);
    if (!stats) {
      stats = { lamps: 0, wayKm: 0 };
      areaStats.set(key, stats);
    }
    return stats;
  };
  for (const lamp of lightNodes) areaAt(areaCellKey(lamp.lat, lamp.lng)).lamps += 1;
  let totalWayKm = 0;
  for (const p of pending) {
    const km = p.dist / 1000;
    totalWayKm += km;
    areaAt(areaCellKey(p.midLat, p.midLng)).wayKm += km;
  }

  const cellKeyOf = crimeCellKeyFn(bbox);
  const crimeCells = new Map();
  const crimeCellAt = (key) => {
    let cell = crimeCells.get(key);
    if (!cell) {
      cell = { crimes: [], weightedCount: 0, exposureKm: 0 };
      crimeCells.set(key, cell);
    }
    return cell;
  };
  const inBbox = [];
  for (const crime of crimes || []) {
    tick();
    if (!crime || !Number.isFinite(crime.lat) || !Number.isFinite(crime.lng)) continue;
    if (crime.lat < bbox.south || crime.lat > bbox.north || crime.lng < bbox.west || crime.lng > bbox.east) continue;
    inBbox.push(crime);
  }
  const weightedRows = crimesToWeightedCounts(inBbox);
  inBbox.forEach((crime, i) => crimeCellAt(cellKeyOf(crime.lat, crime.lng)).crimes.push(weightedRows[i]));
  let totalWeighted = 0;
  for (const cell of crimeCells.values()) {
    cell.weightedCount = weightedCrimeCount(cell.crimes);
    totalWeighted += cell.weightedCount;
  }
  for (const p of pending) crimeCellAt(cellKeyOf(p.midLat, p.midLng)).exposureKm += p.dist / 1000;
  const priorRate = Math.max(
    V2.CRIME_PRIOR_FLOOR,
    totalWayKm > 0 ? totalWeighted / totalWayKm : 0,
  );

  // Road proximity for footway-like ways, built on first use: segments of trunk..service roads,
  // sampled into a grid, so each lookup is a few cells (no scan of every road per footway).
  let roadProximity = null;
  const roadIndex = () => {
    if (!roadProximity) {
      roadProximity = buildRoadProximityIndex(
        pending.filter((p) => ROAD_HIGHWAYS.has(p.highway))
          .map((p) => ({ aLat: p.nA.lat, aLng: p.nA.lng, bLat: p.nB.lat, bLng: p.nB.lng })),
      );
    }
    return roadProximity;
  };

  // 5. Phase 2: score every edge from the five factors.
  const edges = [];
  const adjacency = new Map();
  for (const p of pending) {
    tick();
    const { idx: edgeIdx, from, to, nA, nB, dist, highway, tags, midLat, midLng } = p;

    // Lighting: lamps within 30 m, a lit=yes way vertex within 30 m (a tag, not a lamp: weaker evidence),
    // and for footway-like ways whether a road is within reach (sidewalk or isolated), then the estimate.
    const litNeighbour = countNearby(litGrid, midLat, midLng, LAMP_RADIUS_M) > 0;
    const lampCount30m = countNearby(lampGrid, midLat, midLng, LAMP_RADIUS_M);
    const sidewalkLike = SIDEWALK_LIKE_HIGHWAYS.has(highway);
    const nearRoad = sidewalkLike ? isNearRoad(roadIndex(), midLat, midLng) : undefined;
    const lampCount60m = countNearby(lampGrid, midLat, midLng, V2.LAMP_NEAR_PATH_M);
    const area = areaStats.get(areaCellKey(midLat, midLng));
    const areaWayKm = area.wayKm;
    const areaLampDensityPerKm = areaWayKm > 0 ? area.lamps / areaWayKm : 0;

    const cache = options.lightsCacheByEdgeIdx?.get(edgeIdx) || null;
    const cacheConfidence = cache?.confidence || 0;
    const cacheVerified = (status) => cache?.lit_status === status && cacheConfidence >= 0.8;
    const inferred = inferLighting({
      tags, lampCount30m, areaLampDensityPerKm, areaWayKm, nearRoad, litNeighbour,
    });
    let lighting;
    if (cacheVerified('unlit')) {
      lighting = { pLit: 0.05, n: 20, source: 'cache' };
    } else if (inferred.source === 'tag') {
      lighting = inferred; // explicit lit tag is ground truth
    } else if (cacheVerified('lit')) {
      lighting = { pLit: 0.95, n: 20, source: 'cache' };
    } else {
      const cached = cache ? scoreFromCache(cache) : null;
      lighting = cached ? { pLit: cached.score, n: V2.CACHE_LIGHT_N, source: 'cache' } : inferred;
    }
    const lightingSafety = effectiveLit(lighting);
    const litEstimate = litEstimateOf(lighting.source, lightingSafety);

    // Road class only, minus the surface penalty.
    const surface = tags.surface;
    const surfacePenalty = hasOwnKey(SURFACE_PENALTIES, surface) ? SURFACE_PENALTIES[surface] : 0;
    const roadSafety = clamp01((ROAD_TYPE_SCORES[highway] || 0.3) - surfacePenalty);

    // Activity: open places (night-discounted), CCTV within 80 m, transit within 150 m.
    const cctvCount = countNearby(cctvGrid, midLat, midLng, V2.CCTV_RADIUS_M);
    const transitCount = countNearby(transitGrid, midLat, midLng, V2.TRANSIT_RADIUS_M);
    const placesOpen = countNearby(placeGrid, midLat, midLng, V2.PLACE_RADIUS_M);
    const nightDiscount = (hour >= 22 || hour < 6) ? 0.4 : (hour >= 18 ? 0.7 : 1.0);
    const cctvScore = Math.min(1.0, cctvCount * 0.4);
    const placeScore = Math.min(1.0, placesOpen * 0.15 * nightDiscount);
    let activity = { safety: null, n: 0 };
    let activitySafety = null;
    if (activityAvailable) {
      const activityLoad = 0.15 * placesOpen * nightDiscount + 0.4 * cctvCount + 0.1 * transitCount;
      // Floor: data exists but nothing is nearby is a quiet street, never a hostile one (safety 0).
      activitySafety = ACTIVITY_FLOOR + (1 - ACTIVITY_FLOOR) * (1 - Math.exp(-activityLoad));
      activity = { safety: activitySafety, n: V2.ACTIVITY_N };
    }

    // Isolation: dead end at true degree, or a footpath with no lamp within 60 m. A sidewalk (footway-like
    // way beside a road) is not isolated: it is lit with, and walked beside, the road.
    const deadEnd = (nodeDegree.get(from) || 0) <= 1 || (nodeDegree.get(to) || 0) <= 1;
    const unlitPath = PATH_CLASS_HIGHWAYS.has(highway) && lampCount60m === 0 && tags.lit !== 'yes'
      && nearRoad !== true;
    const isolationSafety = clamp01(
      1 - (deadEnd ? V2.DEAD_END_PENALTY : 0) - (unlitPath ? V2.UNLIT_PATH_PENALTY : 0),
    );

    // Crime: empirical-Bayes cell risk. An outage leaves the factor unknown, never safe.
    let crimeFactor = { safety: null, n: 0 };
    if (crimeStatus === 'ok') {
      const cell = crimeCells.get(cellKeyOf(midLat, midLng));
      const crime = crimeRisk({
        weightedCount: cell.weightedCount,
        exposureKm: cell.exposureKm,
        priorRate,
        status: 'ok',
      });
      crimeFactor = { safety: 1 - crime.risk, n: crime.n };
    }

    const { risk, certainty, dominantCause } = edgeRisk({
      factors: {
        lighting: { safety: lightingSafety, n: lighting.n },
        crime: crimeFactor,
        road: { safety: roadSafety, n: V2.ROAD_N },
        activity,
        isolation: { safety: isolationSafety, n: V2.ISOLATION_N },
      },
      weights,
    });

    const hasSidewalk = !!(tags.sidewalk && tags.sidewalk !== 'no');
    const litTag = tags.lit || null;
    edges.push({
      idx: edgeIdx,
      from,
      to,
      distance: dist,
      highway,
      safetyScore: 1 - risk,
      roadScore: roadSafety,
      lightScore: lightingSafety,
      crimeScore: crimeFactor.safety ?? PRIOR_SAFETY.crime,
      cctvScore,
      placeScore,
      trafficScore: activitySafety === null ? roadSafety : (roadSafety + activitySafety) / 2,
      penalty: 0,
      hasSidewalk,
      surfaceType: surface || 'paved',
      roadName: tags.name || '',
      nearbyCctvCount: cctvCount,
      nearbyTransitCount: transitCount,
      surfacePenalty,
      maxspeed: tags.maxspeed || '',
      isTunnel: tags.tunnel === 'yes',
      isLit: litTag === 'yes',
      litTag,
      isDeadEnd: deadEnd,
      risk,
      certainty,
      cause: dominantCause,
      litEstimate,
      pLit: lighting.pLit,
      lengthM: dist,
      start: { lat: nA.lat, lng: nA.lng },
      end: { lat: nB.lat, lng: nB.lng },
    });

    if (!adjacency.has(from)) adjacency.set(from, []);
    if (!adjacency.has(to)) adjacency.set(to, []);
    adjacency.get(from).push({ edgeIdx, neighborId: to });
    adjacency.get(to).push({ edgeIdx, neighborId: from });
  }

  return {
    osmNodes,
    edges,
    adjacency,
    nodeGrid,
    weights,
    cctvNodes,
    transitNodes,
    nodeDegree,
    edgeConfidences: [],
    darkness,
    model: 'v2',
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// NEAREST NODE (spatial grid — O(1) instead of O(n))
// ═══════════════════════════════════════════════════════════════════════════════

function findNearestNode(nodeGrid, adjacency, lat, lng, maxDist = 500) {
  const nearby = findNearby(nodeGrid, lat, lng, maxDist);
  // Return the nearest node that is actually in the graph (has adjacency)
  for (const item of nearby) {
    if (adjacency.has(item.id)) return item.id;
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// A* PATHFINDING (replaces plain Dijkstra — 3-10× faster)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * A* search that minimises cost = distance / safetyMultiplier.
 *
 * Uses haversine-to-destination as admissible heuristic, which focuses
 * the search toward the goal instead of expanding in all directions.
 * For safety routing, we divide the heuristic by max possible safety (1.0)
 * to keep it admissible (never overestimates).
 */
function isHazardEdge(edge, allowHazards = false) {
  if (allowHazards) return false;
  // Hard constraints: obvious hazards we should avoid by default
  let isHighSpeedNoSidewalk;
  if (useV2()) {
    // v2 parses the unit: '40 mph' is about 64 km/h, not 40.
    const raw = typeof edge.maxspeed === 'string' ? edge.maxspeed.trim().toLowerCase() : undefined;
    const speedKmh = parseMaxspeedKmh(raw);
    isHighSpeedNoSidewalk = speedKmh !== null && speedKmh >= HAZARD_SPEED_KMH && !edge.hasSidewalk;
  } else {
    // v1 (kept for A/B): parseInt ignores units, so '40 mph' reads as 40.
    const speed = parseInt(edge.maxspeed, 10);
    isHighSpeedNoSidewalk = Number.isFinite(speed) && speed >= 50 && !edge.hasSidewalk;
  }
  const isUnlitTunnel = edge.isTunnel && !edge.isLit;
  return isHighSpeedNoSidewalk || isUnlitTunnel;
}

function aStarSafety(osmNodes, edges, adjacency, startId, endId, maxDistM, options = {}) {
  if (!adjacency.has(startId) || !adjacency.has(endId)) {
    debugLog(`[A*] ❌ Start or end not in adjacency: start=${adjacency.has(startId)}, end=${adjacency.has(endId)}`);
    return null;
  }

  const endNode = osmNodes.get(endId);
  if (!endNode) {
    debugLog(`[A*] ❌ End node not in osmNodes`);
    return null;
  }

  const sNode = osmNodes.get(startId);
  if (!sNode) {
    debugLog(`[A*] ❌ Start node not in osmNodes`);
    return null;
  }

  debugLog(`[A*] Start neighbors: ${adjacency.get(startId)?.length}, End neighbors: ${adjacency.get(endId)?.length}, maxDist: ${maxDistM}m`);

  const gScore = new Map();
  const fScore = new Map();
  const realDist = new Map();
  const prev = new Map();
  const closed = new Set();
  const v2 = useV2();

  gScore.set(startId, 0);
  realDist.set(startId, 0);

  const h0 = sNode ? fastDistance(sNode.lat, sNode.lng, endNode.lat, endNode.lng) : 0;
  fScore.set(startId, h0);

  const heap = new MinHeap();
  heap.push(startId, h0);

  while (heap.size > 0) {
    const { id: current } = heap.pop();

    if (closed.has(current)) continue;
    closed.add(current);

    if (current === endId) break;

    const currentG = gScore.get(current) ?? Infinity;
    const neighbors = adjacency.get(current);
    if (!neighbors) continue;

    for (const { edgeIdx, neighborId } of neighbors) {
      if (closed.has(neighborId)) continue;

      const edge = edges[edgeIdx];
      if (isHazardEdge(edge, options.allowHazards)) continue;

      // v2: uncertainty is already inside edge risk (through the priors), so no confidence penalty.
      const confidencePenalty = v2 || !(options.edgeConfidences && options.edgeConfidences[edgeIdx])
        ? 0
        : Math.min(0.1, (1 - options.edgeConfidences[edgeIdx].score) * 0.1);
      const effectiveSafety = Math.max(0.05, edge.safetyScore - edge.penalty - confidencePenalty);
      const edgeCost = edge.distance / effectiveSafety;
      const tentativeG = currentG + edgeCost;
      const newRealDist = (realDist.get(current) || 0) + edge.distance;

      if (newRealDist > maxDistM * 1.5) continue;

      if (tentativeG < (gScore.get(neighborId) ?? Infinity)) {
        gScore.set(neighborId, tentativeG);
        realDist.set(neighborId, newRealDist);
        prev.set(neighborId, { prevNode: current, edgeIdx });

        // Heuristic: remaining distance / max possible safety (1.0)
        const nNode = osmNodes.get(neighborId);
        const h = nNode ? fastDistance(nNode.lat, nNode.lng, endNode.lat, endNode.lng) : 0;
        const f = tentativeG + h;
        fScore.set(neighborId, f);
        heap.push(neighborId, f);
      }
    }
  }

  if (!prev.has(endId) && startId !== endId) {
    debugLog(`[A*] ❌ No path found. Visited ${closed.size} nodes, heap size at end: ${heap.size}`);
    return null;
  }

  // Reconstruct path
  const path = [];
  const usedEdges = [];
  let node = endId;
  while (node !== startId) {
    path.push(node);
    const p = prev.get(node);
    if (!p) return null;
    usedEdges.push(p.edgeIdx);
    node = p.prevNode;
  }
  path.push(startId);
  path.reverse();
  usedEdges.reverse();

  let totalDist = 0;
  let totalWeightedSafety = 0;
  for (const eIdx of usedEdges) {
    const e = edges[eIdx];
    totalDist += e.distance;
    totalWeightedSafety += e.safetyScore * e.distance;
  }

  return {
    path,
    edges: usedEdges,
    totalDist,
    avgSafety: totalDist > 0 ? totalWeightedSafety / totalDist : 0,
  };
}

/**
 * Generate K diverse routes using iterative penalty + A*.
 */
function findKSafestRoutes(osmNodes, edges, adjacency, startId, endId, maxDistM, k = 5, options = {}) {
  const routes = [];
  const penaltyIncrement = 0.15;

  for (const e of edges) e.penalty = 0;

  for (let i = 0; i < k + 3; i++) {
    const route = aStarSafety(osmNodes, edges, adjacency, startId, endId, maxDistM, options);
    if (!route) break;

    const isDuplicate = routes.some((existing) => {
      const overlap = countEdgeOverlap(existing.edges, route.edges);
      return overlap > 0.85;
    });

    if (!isDuplicate) {
      routes.push(route);
      if (routes.length >= k) break;
    }

    for (const eIdx of route.edges) {
      edges[eIdx].penalty += penaltyIncrement;
    }
  }

  for (const e of edges) e.penalty = 0;
  if (useV2()) return rankRoutesByExposure(routes, edges);
  routes.sort((a, b) => b.avgSafety - a.avgSafety);
  return routes;
}

/** Converts an edge to the shape routeAggregate expects. */
function toAggregateEdge(edge) {
  return {
    lengthM: edge.distance,
    risk: edge.risk,
    certainty: edge.certainty,
    cause: edge.cause,
    start: edge.start,
    end: edge.end,
  };
}

/**
 * v2 ranking: every candidate gets its route risk from aggregateRoute, then routes are
 * ordered by exposure with rankRoutes. The displayed score and the order come from this
 * one function. Routes over 1.5x the shortest stay in the list, marked excluded, at the end.
 * A route with no edges (start equals end) has no risk and goes first.
 */
function rankRoutesByExposure(routes, edges) {
  const measured = [];
  const degenerate = [];

  routes.forEach((route, id) => {
    if (route.edges.length === 0) {
      Object.assign(route, {
        routeRisk: 0, mean: 0, m3: 0, score: 100, certainty: 0, worstStretch: null,
        avgSafety: 1, lengthM: 0, exposure: 0, excluded: false,
      });
      degenerate.push(route);
      return;
    }
    const agg = aggregateRoute(route.edges.map((eIdx) => toAggregateEdge(edges[eIdx])));
    const lengthM = route.totalDist;
    Object.assign(route, {
      routeRisk: agg.routeRisk,
      mean: agg.mean,
      m3: agg.m3,
      score: agg.score,
      certainty: agg.certainty,
      worstStretch: agg.worstStretch,
      avgSafety: 1 - agg.routeRisk,
      lengthM,
    });
    measured.push({ id, lengthM, routeRisk: agg.routeRisk });
  });

  const ordered = rankRoutes(measured).map((entry) => {
    const route = routes[entry.id];
    route.exposure = entry.exposure;
    route.excluded = entry.excluded;
    return route;
  });
  return [...degenerate, ...ordered];
}

function countEdgeOverlap(edgesA, edgesB) {
  const setA = new Set(edgesA);
  let overlap = 0;
  for (const e of edgesB) if (setA.has(e)) overlap++;
  return edgesB.length > 0 ? overlap / edgesB.length : 0;
}

/**
 * Convert a route (list of node IDs) to a polyline [{lat, lng}, ...].
 */
function routeToPolyline(osmNodes, path) {
  const points = [];
  for (const nid of path) {
    const node = osmNodes.get(nid);
    if (node) points.push({ lat: node.lat, lng: node.lng });
  }
  return points;
}

/**
 * v2 breakdown. The score is 1 - routeRisk (aggregateRoute), the same value the ranking uses.
 * Per-factor values are length-weighted from the edge fields; riskVector describes risk
 * (mean, p95 and max edge risk), and its uncertainty is 1 - certainty.
 * An empty route (no distance) returns zeros.
 */
function routeSafetyBreakdownV2(edges, usedEdgeIdxs) {
  const segments = usedEdgeIdxs.map((eIdx) => edges[eIdx]);
  const totalDist = segments.reduce((sum, e) => sum + e.distance, 0);
  if (totalDist === 0) {
    return {
      roadType: 0, lighting: 0, crime: 0, cctv: 0, openPlaces: 0,
      traffic: 0, overall: 0, roadTypes: {}, mainRoadRatio: 0,
      riskVector: { mean: 0, p95: 0, max: 0, uncertainty: 0 },
      routeRisk: 0, mean: 0, m3: 0, certainty: 0, worstStretch: null,
    };
  }

  const agg = aggregateRoute(segments.map(toAggregateEdge));
  const weightedMean = (field) => segments.reduce((sum, e) => sum + (e[field] || 0) * e.distance, 0) / totalDist;

  const roadTypes = {};
  for (const e of segments) roadTypes[e.highway] = (roadTypes[e.highway] || 0) + e.distance;
  const roadTypePct = {};
  for (const [type, dist] of Object.entries(roadTypes)) {
    roadTypePct[type] = Math.round((dist / totalDist) * 100);
  }
  const mainRoadDist = (roadTypes.primary || 0) + (roadTypes.secondary || 0)
    + (roadTypes.tertiary || 0) + (roadTypes.trunk || 0);

  // Nearest-rank p95 over edge risks (unweighted, as before).
  const risks = segments.filter((e) => e.distance > 0).map((e) => e.risk).sort((a, b) => a - b);
  const p95 = risks[Math.ceil(0.95 * risks.length) - 1];
  const max = risks[risks.length - 1];

  return {
    roadType: weightedMean('roadScore'),
    lighting: weightedMean('lightScore'),
    crime: weightedMean('crimeScore'),
    cctv: weightedMean('cctvScore'),
    openPlaces: weightedMean('placeScore'),
    traffic: weightedMean('trafficScore'),
    overall: 1 - agg.routeRisk,
    roadTypes: roadTypePct,
    mainRoadRatio: mainRoadDist / totalDist,
    riskVector: { mean: agg.mean, p95, max, uncertainty: 1 - agg.certainty },
    routeRisk: agg.routeRisk,
    mean: agg.mean,
    m3: agg.m3,
    certainty: agg.certainty,
    worstStretch: agg.worstStretch,
  };
}

/**
 * Compute detailed per-segment safety breakdown for a route.
 */
function routeSafetyBreakdown(edges, usedEdgeIdxs, weights, edgeConfidences = null) {
  if (useV2()) return routeSafetyBreakdownV2(edges, usedEdgeIdxs);
  let totalDist = 0;
  let weightedRoad = 0, weightedLight = 0, weightedCrime = 0;
  let weightedCctv = 0, weightedPlace = 0, weightedTraffic = 0;
  const roadTypes = {};
  const edgeRisks = [];
  let uncertainLength = 0;

  for (const eIdx of usedEdgeIdxs) {
    const e = edges[eIdx];
    const d = e.distance;
    totalDist += d;
    weightedRoad += e.roadScore * d;
    weightedLight += e.lightScore * d;
    weightedCrime += e.crimeScore * d;
    weightedCctv += (e.cctvScore || 0) * d;
    weightedPlace += e.placeScore * d;
    weightedTraffic += e.trafficScore * d;
    roadTypes[e.highway] = (roadTypes[e.highway] || 0) + d;
    edgeRisks.push(e.safetyScore);
    if (edgeConfidences && edgeConfidences[eIdx]?.needsVerification) {
      uncertainLength += d;
    }
  }

  if (totalDist === 0) {
    return {
      roadType: 0, lighting: 0, crime: 0, cctv: 0, openPlaces: 0,
      traffic: 0, overall: 0, roadTypes: {}, mainRoadRatio: 0,
      riskVector: { mean: 0, p95: 0, max: 0, uncertainty: 0 },
    };
  }

  const mainRoadDist =
    (roadTypes.primary || 0) + (roadTypes.secondary || 0) +
    (roadTypes.tertiary || 0) + (roadTypes.trunk || 0);

  const roadTypePct = {};
  for (const [type, dist] of Object.entries(roadTypes)) {
    roadTypePct[type] = Math.round((dist / totalDist) * 100);
  }

  const w = weights || getV1Weights(new Date().getHours());

  const meanSafety = totalDist > 0
    ? (weightedRoad + weightedLight + weightedCrime + weightedCctv + weightedPlace + weightedTraffic) / totalDist
    : 0;
  const sortedRisks = [...edgeRisks].sort((a, b) => a - b);
  const p95Index = Math.floor(sortedRisks.length * 0.95);
  const p95 = sortedRisks.length > 0 ? sortedRisks[Math.min(p95Index, sortedRisks.length - 1)] : 0;
  const maxRisk = sortedRisks.length > 0 ? sortedRisks[sortedRisks.length - 1] : 0;
  const uncertainRatio = totalDist > 0 ? uncertainLength / totalDist : 0;

  // Uncertainty penalty: small deduction for unverified segments (capped at 0.1)
  const UNCERTAINTY_LAMBDA = 0.1;
  const uncertaintyPenalty = Math.min(0.1, UNCERTAINTY_LAMBDA * uncertainRatio);

  const overall = Math.max(0,
    w.roadType * (weightedRoad / totalDist) +
    w.lighting * (weightedLight / totalDist) +
    w.crimeRate * (weightedCrime / totalDist) +
    w.cctv * (weightedCctv / totalDist) +
    w.openPlaces * (weightedPlace / totalDist) +
    w.gpsTraffic * (weightedTraffic / totalDist) -
    uncertaintyPenalty
  );

  return {
    roadType: weightedRoad / totalDist,
    lighting: weightedLight / totalDist,
    crime: weightedCrime / totalDist,
    cctv: weightedCctv / totalDist,
    openPlaces: weightedPlace / totalDist,
    traffic: weightedTraffic / totalDist,
    overall,
    roadTypes: roadTypePct,
    mainRoadRatio: mainRoadDist / totalDist,
    riskVector: {
      mean: meanSafety,
      p95,
      max: maxRisk,
      uncertainty: uncertainRatio,
    },
  };
}

// ── Min-Heap ────────────────────────────────────────────────────────────────
class MinHeap {
  constructor() {
    this.data = [];
    this.size = 0;
  }

  push(id, priority) {
    this.data[this.size] = { id, priority };
    this.size++;
    this._bubbleUp(this.size - 1);
  }

  pop() {
    if (this.size === 0) return null;
    const min = this.data[0];
    this.size--;
    if (this.size > 0) {
      this.data[0] = this.data[this.size];
      this._sinkDown(0);
    }
    return min;
  }

  _bubbleUp(i) {
    const data = this.data;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (data[i].priority >= data[parent].priority) break;
      const tmp = data[i]; data[i] = data[parent]; data[parent] = tmp;
      i = parent;
    }
  }

  _sinkDown(i) {
    const data = this.data;
    const n = this.size;
    while (true) {
      let smallest = i;
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      if (left < n && data[left].priority < data[smallest].priority) smallest = left;
      if (right < n && data[right].priority < data[smallest].priority) smallest = right;
      if (smallest === i) break;
      const tmp = data[i]; data[i] = data[smallest]; data[smallest] = tmp;
      i = smallest;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// DISTANCE-ONLY GRAPH & A* (Phase 1 corridor discovery)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Build a lightweight distance-only graph from road data.
 * No coverage maps, no safety scoring — just the walking network topology.
 * Used in Phase 1 to discover the shortest walking corridor quickly.
 */
function buildDistanceOnlyGraph(roadData) {
  const osmNodes = new Map();
  for (const el of roadData.elements) {
    if (el.type === 'node') {
      osmNodes.set(el.id, { lat: el.lat, lng: el.lon, id: el.id });
    }
  }

  const nodeArray = [];
  for (const [id, node] of osmNodes) {
    nodeArray.push({ lat: node.lat, lng: node.lng, id });
  }
  const nodeGrid = buildSpatialGrid(nodeArray, 'lat', 'lng', 0.001);

  const edges = [];
  const adjacency = new Map();

  for (const el of roadData.elements) {
    if (el.type !== 'way' || !el.nodes || !el.tags?.highway) continue;
    if (!WALKABLE_HIGHWAYS.has(el.tags.highway)) continue;

    const nodeIds = el.nodes;
    for (let i = 0; i < nodeIds.length - 1; i++) {
      const nA = osmNodes.get(nodeIds[i]);
      const nB = osmNodes.get(nodeIds[i + 1]);
      if (!nA || !nB) continue;
      const dist = fastDistance(nA.lat, nA.lng, nB.lat, nB.lng);
      if (dist < 0.5) continue;

      const edgeIdx = edges.length;
      edges.push({ from: nodeIds[i], to: nodeIds[i + 1], distance: dist });

      if (!adjacency.has(nodeIds[i])) adjacency.set(nodeIds[i], []);
      if (!adjacency.has(nodeIds[i + 1])) adjacency.set(nodeIds[i + 1], []);
      adjacency.get(nodeIds[i]).push({ edgeIdx, neighborId: nodeIds[i + 1] });
      adjacency.get(nodeIds[i + 1]).push({ edgeIdx, neighborId: nodeIds[i] });
    }
  }

  return { osmNodes, edges, adjacency, nodeGrid };
}

/**
 * Distance-only A* — finds the shortest walking path by distance.
 * No safety scoring — purely minimises total metres walked.
 * Used in Phase 1 to trace the walking corridor shape.
 */
function aStarDistance(osmNodes, edges, adjacency, startId, endId, maxDistM) {
  if (!adjacency.has(startId) || !adjacency.has(endId)) return null;

  const endNode = osmNodes.get(endId);
  const sNode = osmNodes.get(startId);
  if (!endNode || !sNode) return null;

  const gScore = new Map();
  const prev = new Map();
  const closed = new Set();

  gScore.set(startId, 0);
  const h0 = fastDistance(sNode.lat, sNode.lng, endNode.lat, endNode.lng);
  const heap = new MinHeap();
  heap.push(startId, h0);

  while (heap.size > 0) {
    const { id: current } = heap.pop();
    if (closed.has(current)) continue;
    closed.add(current);
    if (current === endId) break;

    const currentG = gScore.get(current) ?? Infinity;
    const neighbors = adjacency.get(current);
    if (!neighbors) continue;

    for (const { edgeIdx, neighborId } of neighbors) {
      if (closed.has(neighborId)) continue;

      const edge = edges[edgeIdx];
      const tentativeG = currentG + edge.distance;
      if (tentativeG > maxDistM) continue;

      if (tentativeG < (gScore.get(neighborId) ?? Infinity)) {
        gScore.set(neighborId, tentativeG);
        prev.set(neighborId, { prevNode: current });
        const nNode = osmNodes.get(neighborId);
        const h = nNode ? fastDistance(nNode.lat, nNode.lng, endNode.lat, endNode.lng) : 0;
        heap.push(neighborId, tentativeG + h);
      }
    }
  }

  if (!prev.has(endId) && startId !== endId) return null;

  // Reconstruct path
  const path = [];
  let node = endId;
  while (node !== startId) {
    path.push(node);
    const p = prev.get(node);
    if (!p) return null;
    node = p.prevNode;
  }
  path.push(startId);
  path.reverse();

  let totalDist = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const a = osmNodes.get(path[i]);
    const b = osmNodes.get(path[i + 1]);
    if (a && b) totalDist += fastDistance(a.lat, a.lng, b.lat, b.lng);
  }

  return { path, totalDist };
}

module.exports = {
  buildGraph,
  buildDistanceOnlyGraph,
  aStarDistance,
  findNearestNode,
  aStarSafety,
  findKSafestRoutes,
  routeToPolyline,
  routeSafetyBreakdown,
  getV1Weights,
  crimesToWeightedCounts,
  ROAD_TYPE_SCORES,
  WALKABLE_HIGHWAYS,
  isHazardEdge,
  useV2,
  currentModel,
};

/**
 * Response policy and the per-category cap on route POIs. When a category has more points than its cap, the
 * kept points are spread along the route (round-robin over route segments, nearest to the route first), or
 * taken nearest to the origin when the route has no geometry.
 */

const DEFAULT_RESPONSE_POLICY = {
  verbosity: "full",
  poiCaps: {
    cctv: 500,
    transit: 500,
    deadEnds: 500,
    lights: 500,
    places: 500,
    crimes: 500,
  },
};

/**
 * Normalises a caller's response policy: verbosity (full or compact), openPlacesOnly (default true) and per
 * category POI caps (a positive finite integer, Infinity for no cap, else the default).
 * @param {object} [responsePolicy]
 * @returns {{verbosity: string, openPlacesOnly: boolean, poiCaps: Object<string, number>}}
 */
function normalizeResponsePolicy(responsePolicy) {
  const verbosity = responsePolicy?.verbosity === "compact" ? "compact" : "full";
  const openPlacesOnly = responsePolicy?.openPlacesOnly !== false;
  const mergedPoiCaps = {
    ...DEFAULT_RESPONSE_POLICY.poiCaps,
    ...(responsePolicy?.poiCaps || {}),
  };

  const poiCaps = {};
  for (const [category, value] of Object.entries(mergedPoiCaps)) {
    if (value === Infinity) {
      poiCaps[category] = Infinity;
      continue;
    }

    poiCaps[category] = Number.isFinite(value) && value > 0
      ? Math.floor(value)
      : DEFAULT_RESPONSE_POLICY.poiCaps[category];
  }

  return {
    verbosity,
    openPlacesOnly,
    poiCaps,
  };
}

function distanceSqFromOrigin(point, oLat, oLng) {
  const dLat = point.lat - oLat;
  const dLng = point.lng - oLng;
  return dLat * dLat + dLng * dLng;
}

/** Route polyline vertices {lat, lng} for a node path, skipping unknown or non-finite nodes. */
function buildRouteVertices(routePath, osmNodes) {
  const vertices = [];
  for (const nodeId of routePath || []) {
    const node = osmNodes.get(nodeId);
    if (!node) continue;
    if (!Number.isFinite(node.lat) || !Number.isFinite(node.lng)) continue;
    vertices.push({ lat: node.lat, lng: node.lng });
  }
  return vertices;
}

function distanceSqToSegment(point, from, to) {
  const segLat = to.lat - from.lat;
  const segLng = to.lng - from.lng;
  const segLenSq = segLat * segLat + segLng * segLng;
  if (segLenSq <= 0) {
    return distanceSqFromOrigin(point, from.lat, from.lng);
  }

  const relLat = point.lat - from.lat;
  const relLng = point.lng - from.lng;
  const projection = (relLat * segLat + relLng * segLng) / segLenSq;
  const clamped = Math.max(0, Math.min(1, projection));
  const nearestLat = from.lat + segLat * clamped;
  const nearestLng = from.lng + segLng * clamped;
  return distanceSqFromOrigin(point, nearestLat, nearestLng);
}

function nearestRouteSegment(point, routeVertices) {
  if (!Array.isArray(routeVertices) || routeVertices.length < 2) {
    return null;
  }

  let segmentIndex = 0;
  let distanceSq = Infinity;

  for (let i = 0; i < routeVertices.length - 1; i++) {
    const from = routeVertices[i];
    const to = routeVertices[i + 1];
    const candidateDistanceSq = distanceSqToSegment(point, from, to);
    if (candidateDistanceSq < distanceSq) {
      distanceSq = candidateDistanceSq;
      segmentIndex = i;
    }
  }

  return { segmentIndex, distanceSq };
}

function limitCategoryPoisByOrigin(points, cap, oLat, oLng) {
  if (!Array.isArray(points)) return [];
  if (cap === Infinity) return points;
  if (!Number.isFinite(cap) || cap < 1) return [];
  if (points.length <= cap) return points;

  return points
    .map((point, index) => ({
      point,
      index,
      distanceSq: distanceSqFromOrigin(point, oLat, oLng),
    }))
    .sort((a, b) => a.distanceSq - b.distanceSq || a.index - b.index)
    .slice(0, cap)
    .map((entry) => entry.point);
}

/** Groups points by their nearest route segment, each bucket sorted nearest-to-route first. */
function bucketBySegment(points, routeVertices, oLat, oLng) {
  const segmentBuckets = new Map();
  for (let index = 0; index < points.length; index++) {
    const point = points[index];
    const nearest = nearestRouteSegment(point, routeVertices);
    const segmentIndex = nearest?.segmentIndex ?? 0;
    if (!segmentBuckets.has(segmentIndex)) {
      segmentBuckets.set(segmentIndex, []);
    }

    segmentBuckets.get(segmentIndex).push({
      point,
      index,
      distanceSq: nearest?.distanceSq ?? Infinity,
      fallbackDistanceSq: distanceSqFromOrigin(point, oLat, oLng),
    });
  }

  for (const bucket of segmentBuckets.values()) {
    bucket.sort(
      (a, b) => (
        a.distanceSq - b.distanceSq ||
        a.fallbackDistanceSq - b.fallbackDistanceSq ||
        a.index - b.index
      ),
    );
  }
  return segmentBuckets;
}

function limitCategoryPois(points, cap, routeVertices, oLat, oLng) {
  if (!Array.isArray(routeVertices) || routeVertices.length < 2) {
    return limitCategoryPoisByOrigin(points, cap, oLat, oLng);
  }
  if (!Array.isArray(points)) return [];
  if (cap === Infinity) return points;
  if (!Number.isFinite(cap) || cap < 1) return [];
  if (points.length <= cap) return points;

  const segmentBuckets = bucketBySegment(points, routeVertices, oLat, oLng);
  const segmentOrder = Array.from(segmentBuckets.keys()).sort((a, b) => a - b);

  const selected = [];
  let madeProgress = true;

  while (selected.length < cap && madeProgress) {
    madeProgress = false;
    for (const segmentIndex of segmentOrder) {
      const bucket = segmentBuckets.get(segmentIndex);
      if (!bucket?.length) continue;
      selected.push(bucket.shift().point);
      madeProgress = true;
      if (selected.length >= cap) break;
    }
  }

  return selected;
}

const POI_CATEGORIES = ["cctv", "transit", "deadEnds", "lights", "places", "crimes"];

/** Applies the per-category caps to a route's POIs. */
function limitRoutePois(routePOIs, poiCaps, routeVertices, oLat, oLng) {
  const limited = {};
  for (const category of POI_CATEGORIES) {
    limited[category] = limitCategoryPois(routePOIs?.[category], poiCaps[category], routeVertices, oLat, oLng);
  }
  return limited;
}

module.exports = {
  DEFAULT_RESPONSE_POLICY,
  normalizeResponsePolicy,
  buildRouteVertices,
  limitRoutePois,
};

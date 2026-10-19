const {
  validateLatitude,
  validateLongitude,
} = require('../../shared/validation/validate');

const RESPONSE_VERBOSITY_FULL = 'full';
const RESPONSE_VERBOSITY_COMPACT = 'compact';
const POI_CAP_MAX = Math.max(
  1,
  Number(process.env.SAFE_ROUTES_POI_CAP_MAX || 5000),
);
const INVALID_MAX_DISTANCE = 'INVALID_MAX_DISTANCE';

/** A query value that is present but carries nothing usable: "", "   " or a repeated key (array). */
function isBlankOrRepeated(raw) {
  return Array.isArray(raw) || (typeof raw === 'string' && raw.trim() === '');
}

/**
 * Validates one coordinate query value. The shared validators coerce with Number(), which turns
 * "" into 0 and would silently place a point on the equator; blank and repeated values are rejected first.
 */
function checkCoordinate(raw, validator, label) {
  if (isBlankOrRepeated(raw)) {
    return { valid: false, error: `Invalid ${label}: ${Array.isArray(raw) ? 'repeated' : 'empty'} value` };
  }
  return validator(raw);
}

const FULL_MODE_POI_CAPS = {
  cctv: 200,
  transit: 200,
  deadEnds: 200,
  lights: 200,
  places: 200,
  crimes: 200,
};

const COMPACT_MODE_POI_CAPS = {
  cctv: 12,
  transit: 12,
  deadEnds: 8,
  lights: 12,
  places: 12,
  crimes: 12,
};

function parseVerbosity(rawVerbosity) {
  if (typeof rawVerbosity !== 'string') {
    return RESPONSE_VERBOSITY_FULL;
  }

  const normalized = rawVerbosity.trim().toLowerCase();
  if (normalized === RESPONSE_VERBOSITY_COMPACT) {
    return RESPONSE_VERBOSITY_COMPACT;
  }

  return RESPONSE_VERBOSITY_FULL;
}

function parsePoiCap(rawValue, fallback) {
  if (rawValue == null || rawValue === '') {
    return fallback;
  }

  // "all" / "uncapped" and Infinity mean "as many as the server allows", never an unbounded list.
  if (typeof rawValue === 'string') {
    const normalized = rawValue.trim().toLowerCase();
    if (normalized === 'all' || normalized === 'max' || normalized === 'uncapped') {
      return POI_CAP_MAX;
    }
  }

  const numeric = Number(rawValue);
  if (numeric === Infinity) {
    return POI_CAP_MAX;
  }
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  const rounded = Math.floor(numeric);
  if (rounded < 1) {
    return fallback;
  }

  return Math.min(rounded, POI_CAP_MAX);
}

function parseBoolean(rawValue, fallback = false) {
  if (rawValue == null || rawValue === '') return fallback;
  if (typeof rawValue === 'boolean') return rawValue;
  if (typeof rawValue === 'number') return rawValue === 1;
  if (typeof rawValue !== 'string') return fallback;

  const normalized = rawValue.trim().toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'yes') return true;
  if (normalized === '0' || normalized === 'false' || normalized === 'no') return false;
  return fallback;
}

function parseResponsePolicy(query = {}) {
  const verbosity = parseVerbosity(query.verbosity);
  const baseCaps =
    verbosity === RESPONSE_VERBOSITY_COMPACT
      ? COMPACT_MODE_POI_CAPS
      : FULL_MODE_POI_CAPS;

  const globalCap = parsePoiCap(query.poi_cap, null);
  const fallbackCap = (category) =>
    globalCap != null ? globalCap : baseCaps[category];

  return {
    verbosity,
    openPlacesOnly: parseBoolean(query.open_places_only, true),
    poiCaps: {
      cctv: parsePoiCap(query.poi_cap_cctv, fallbackCap('cctv')),
      transit: parsePoiCap(query.poi_cap_transit, fallbackCap('transit')),
      deadEnds: parsePoiCap(
        query.poi_cap_dead_ends ?? query.poi_cap_deadEnds,
        fallbackCap('deadEnds'),
      ),
      lights: parsePoiCap(query.poi_cap_lights, fallbackCap('lights')),
      places: parsePoiCap(query.poi_cap_places, fallbackCap('places')),
      crimes: parsePoiCap(query.poi_cap_crimes, fallbackCap('crimes')),
    },
  };
}

function parseRouteRequest(req, defaultMaxDistanceKm, haversine) {
  const oLat = checkCoordinate(req.query.origin_lat, validateLatitude, 'latitude');
  const oLng = checkCoordinate(req.query.origin_lng, validateLongitude, 'longitude');
  if (!oLat.valid) return { ok: false, error: oLat.error };
  if (!oLng.valid) return { ok: false, error: oLng.error };

  const dLat = checkCoordinate(req.query.dest_lat, validateLatitude, 'latitude');
  const dLng = checkCoordinate(req.query.dest_lng, validateLongitude, 'longitude');
  if (!dLat.valid) return { ok: false, error: dLat.error };
  if (!dLng.valid) return { ok: false, error: dLng.error };

  // A waypoint is optional: an unusable one is ignored, as before, but an empty one must not become 0,0.
  let wpLat = null;
  let wpLng = null;
  if (req.query.waypoint_lat != null && req.query.waypoint_lng != null) {
    const wpLatV = checkCoordinate(req.query.waypoint_lat, validateLatitude, 'latitude');
    const wpLngV = checkCoordinate(req.query.waypoint_lng, validateLongitude, 'longitude');
    if (wpLatV.valid && wpLngV.valid) {
      wpLat = wpLatV.value;
      wpLng = wpLngV.value;
    }
  }

  const straightLineDist = haversine(
    oLat.value,
    oLng.value,
    dLat.value,
    dLng.value,
  );
  const straightLineKm = straightLineDist / 1000;

  // Absent (or empty) uses the default. A supplied value must be a finite positive number of km.
  let maxDistanceKm = defaultMaxDistanceKm;
  const rawMaxDistance = req.query.max_distance;
  if (rawMaxDistance != null && rawMaxDistance !== '') {
    const requestedKm = isBlankOrRepeated(rawMaxDistance) ? NaN : Number(rawMaxDistance);
    if (!Number.isFinite(requestedKm) || requestedKm <= 0) {
      return {
        ok: false,
        error: INVALID_MAX_DISTANCE,
        message: 'max_distance must be a positive number of kilometres.',
      };
    }
    maxDistanceKm = Math.min(requestedKm, defaultMaxDistanceKm);
  }

  let departureHour = null;
  if (req.query.departure_hour != null && !isBlankOrRepeated(req.query.departure_hour)) {
    const dh = Number(req.query.departure_hour);
    if (Number.isFinite(dh) && dh >= 0 && dh <= 23) {
      departureHour = Math.floor(dh);
    }
  }

  const allowHazards = req.query.allow_hazards === 'true' || req.query.allow_hazards === '1';

  return {
    ok: true,
    value: {
      oLat: oLat.value,
      oLng: oLng.value,
      dLat: dLat.value,
      dLng: dLng.value,
      wpLat,
      wpLng,
      straightLineDist,
      straightLineKm,
      maxDistanceKm,
      departureHour,
      allowHazards,
      responsePolicy: parseResponsePolicy(req.query),
    },
  };
}

function buildOutOfRangeMessage(straightLineKm, maxDistanceKm) {
  const maxDistanceMi = maxDistanceKm * 0.621371;
  const straightLineMi = straightLineKm * 0.621371;
  return `That destination is ${straightLineMi.toFixed(1)} mi away — your limit is ${maxDistanceMi.toFixed(1)} mi.`;
}

function buildOutOfRangePayload({
  oLat,
  oLng,
  dLat,
  dLng,
  straightLineKm,
  maxDistanceKm,
}) {
  const latDiff = Math.abs(dLat - oLat);
  const lngDiff = Math.abs(dLng - oLng);
  const bufferDeg = 0.003;
  const heightKm = (latDiff + 2 * bufferDeg) * 111.32;
  const midLatRad = (((oLat + dLat) / 2) * Math.PI) / 180;
  const widthKm = (lngDiff + 2 * bufferDeg) * 111.32 * Math.cos(midLatRad);
  const areaKm2 = heightKm * widthKm;
  const estimatedDataPoints = Math.round(areaKm2 * 4000);

  return {
    error: 'DESTINATION_OUT_OF_RANGE',
    message: buildOutOfRangeMessage(straightLineKm, maxDistanceKm),
    maxDistanceKm,
    actualDistanceKm: Math.round(straightLineKm * 10) / 10,
    estimatedDataPoints,
    areaKm2: Math.round(areaKm2 * 10) / 10,
    detail: `To score this route for safety, we'd need to analyse roughly ${estimatedDataPoints.toLocaleString()} data points — every street, street light, CCTV camera, bus stop, open venue, and police-reported crime in a ${areaKm2.toFixed(1)} km² area. To keep SafeNight fast, we cap routes at ${(maxDistanceKm * 0.621371).toFixed(1)} mi for your plan.`,
  };
}

module.exports = {
  parseRouteRequest,
  buildOutOfRangeMessage,
  buildOutOfRangePayload,
  RESPONSE_VERBOSITY_FULL,
  RESPONSE_VERBOSITY_COMPACT,
  FULL_MODE_POI_CAPS,
  COMPACT_MODE_POI_CAPS,
};

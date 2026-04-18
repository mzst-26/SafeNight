const {
  validateLatitude,
  validateLongitude,
} = require('../../shared/validation/validate');

function parseRouteRequest(req, defaultMaxDistanceKm, haversine) {
  const oLat = validateLatitude(req.query.origin_lat);
  const oLng = validateLongitude(req.query.origin_lng);
  if (!oLat.valid) return { ok: false, error: oLat.error };
  if (!oLng.valid) return { ok: false, error: oLng.error };

  const dLat = validateLatitude(req.query.dest_lat);
  const dLng = validateLongitude(req.query.dest_lng);
  if (!dLat.valid) return { ok: false, error: dLat.error };
  if (!dLng.valid) return { ok: false, error: dLng.error };

  let wpLat = null;
  let wpLng = null;
  if (req.query.waypoint_lat != null && req.query.waypoint_lng != null) {
    const wpLatV = validateLatitude(req.query.waypoint_lat);
    const wpLngV = validateLongitude(req.query.waypoint_lng);
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

  const maxDistanceKm = req.query.max_distance
    ? Math.min(Number(req.query.max_distance), defaultMaxDistanceKm)
    : defaultMaxDistanceKm;

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
};

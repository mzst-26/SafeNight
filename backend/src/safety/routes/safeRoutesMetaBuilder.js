const { normalizeCrimeStatus } = require('../services/graph/clock');

function buildSafeRoutesMeta({
  straightLineKm,
  maxDistanceKm,
  responseRoutes,
  roadCount,
  crimes,
  allData,
  elapsed,
  phase1Time,
  dataTime,
  graphTime,
  pathfindTime,
  recorrectionMs,
  dataSources,
  lightVerificationStatus,
  verifiedLightsCount,
  crimeStatus,
}) {
  const meta = {
    straightLineDistanceKm: Math.round(straightLineKm * 10) / 10,
    maxDistanceKm,
    routeCount: responseRoutes.length,
    dataQuality: {
      roads: roadCount,
      crimes: crimes.length,
      lightElements: allData.lights.elements.length,
      cctvCameras: allData.cctv.elements.length,
      places: allData.places.elements.length,
      transitStops: allData.transit.elements.length,
    },
    timing: {
      totalMs: elapsed,
      corridorDiscoveryMs: phase1Time,
      safetyDataFetchMs: dataTime,
      graphBuildMs: graphTime,
      pathfindMs: pathfindTime,
      recorrectionMs,
    },
    computeTimeMs: elapsed,
  };

  if (dataSources && (dataSources.overpass || dataSources.crime || dataSources.os)) {
    meta.dataSources = {
      overpass: dataSources.overpass || null,
      crime: dataSources.crime || null,
      os: dataSources.os || null,
    };
  }

  if (allData && allData._sourceMeta) {
    meta.sourceProvenance = allData._sourceMeta;
  }

  // C4 — Data provenance and freshness
  const osmLightCount = allData.lights.elements.filter((e) => e.type === 'node' && e.tags?.highway === 'street_lamp').length;
  const osGapFillCount = verifiedLightsCount || 0;
  const coverageRatio = osmLightCount + osGapFillCount > 0
    ? osmLightCount / (osmLightCount + osGapFillCount)
    : 1;
  // The local OSM path records no source metadata; only the Overpass fallback does
  const lightsProvenance = allData._sourceMeta?.lights?.source || 'local_osm';
  meta.dataQuality.freshness = {
    crimeLastUpdated: crimes.length > 0 && crimes[0]?.month ? crimes[0].month : null,
    lightsSource: osGapFillCount > 0 ? `${lightsProvenance}+os_ngd_gapfill` : lightsProvenance,
    coverageRatio: Math.round(coverageRatio * 100) / 100,
    lightVerificationStatus: lightVerificationStatus || 'not_needed',
  };

  // The crime outage state (anything but 'ok' is unavailable) and the lighting quality of the recommended
  // route, so the client can show a data-confidence chip.
  meta.dataQuality.crime = normalizeCrimeStatus(crimeStatus);
  const lighting = responseRoutes[0]?.safety?.dataQuality?.lighting;
  if (lighting) meta.dataQuality.lighting = lighting;

  return meta;
}

module.exports = {
  buildSafeRoutesMeta,
};

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

  if (dataSources && (dataSources.overpass || dataSources.crime)) {
    meta.dataSources = {
      overpass: dataSources.overpass || null,
      crime: dataSources.crime || null,
    };
  }

  return meta;
}

module.exports = {
  buildSafeRoutesMeta,
};

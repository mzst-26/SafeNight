const {
  checkOpenNow,
  heuristicOpen,
  safetyLabel,
  segmentColor,
} = require("./safeRoutesUtils");
const { collectRoutePOIs } = require("./safeRoutesPoiCollector");
const { encodePolyline } = require("../services/geo");
const {
  routeToPolyline,
  routeSafetyBreakdown,
} = require("../services/safetyGraph");

const WALKING_SPEED_MPS = 1.35;

function collectLightNodes(lightElements) {
  const lightNodes = [];
  for (const el of lightElements || []) {
    if (
      el.type === "node" &&
      el.tags?.highway === "street_lamp" &&
      el.lat &&
      el.lon
    ) {
      lightNodes.push({ lat: el.lat, lng: el.lon });
    }
  }
  return lightNodes;
}

function collectOpenPlaceNodes(placeElements, enableOpeningHoursParse) {
  const placeNodes = [];
  for (const el of placeElements || []) {
    const lat = el.lat || el.center?.lat;
    const lng = el.lon || el.center?.lon;
    if (!lat || !lng) continue;

    const name =
      el.tags?.name ||
      el.tags?.["name:en"] ||
      el.tags?.brand ||
      el.tags?.operator ||
      "";
    const amenity =
      el.tags?.amenity ||
      el.tags?.shop ||
      el.tags?.leisure ||
      el.tags?.tourism ||
      "";
    const hoursRaw = el.tags?.opening_hours || "";

    let open = null;
    let nextChange = null;

    if (enableOpeningHoursParse && hoursRaw) {
      const parsed = checkOpenNow(hoursRaw);
      open = parsed.open;
      nextChange = parsed.nextChange;
    }

    if (open === null) {
      const heuristic = heuristicOpen(amenity);
      open = heuristic.open;
      nextChange = heuristic.nextChange;
    }

    if (open !== true) continue;

    placeNodes.push({
      lat,
      lng,
      name,
      amenity,
      open,
      nextChange,
      opening_hours: hoursRaw,
    });
  }

  return placeNodes;
}

function buildRouteResponses({
  rawRoutes,
  osmNodes,
  edges,
  weights,
  cctvNodes,
  transitNodes,
  nodeDegree,
  crimes,
  allData,
  oLat,
  oLng,
  dLat,
  dLng,
  enableOpeningHoursParse,
}) {
  const lightNodes = collectLightNodes(allData?.lights?.elements);
  const placeNodes = collectOpenPlaceNodes(
    allData?.places?.elements,
    enableOpeningHoursParse,
  );

  const routes = rawRoutes.map((route, idx) => {
    const polyline = routeToPolyline(osmNodes, route.path);
    const breakdown = routeSafetyBreakdown(edges, route.edges, weights);
    const score100 = Math.round(breakdown.overall * 100);
    const { label, color } = safetyLabel(score100);
    const durationSec = Math.round(route.totalDist / WALKING_SPEED_MPS);

    const segments = [];
    let deadEndCount = 0;
    let sidewalkDist = 0;
    let unpavedDist = 0;
    let transitStopCount = 0;
    let cctvNearCount = 0;
    const roadNameChanges = [];
    let lastRoadName = "";
    let cumulativeDist = 0;

    for (let i = 0; i < route.edges.length; i++) {
      const edge = edges[route.edges[i]];
      const nodeA = osmNodes.get(route.path[i]);
      const nodeB = osmNodes.get(route.path[i + 1]);
      if (!nodeA || !nodeB) continue;

      if (edge.isDeadEnd) deadEndCount++;
      if (edge.hasSidewalk) sidewalkDist += edge.distance;
      if (edge.surfacePenalty > 0) unpavedDist += edge.distance;
      transitStopCount += edge.nearbyTransitCount;
      cctvNearCount += edge.nearbyCctvCount;

      const roadName = edge.roadName || "";
      if (roadName && roadName !== lastRoadName) {
        roadNameChanges.push({
          segmentIndex: i,
          name: roadName,
          distance: Math.round(cumulativeDist),
        });
        lastRoadName = roadName;
      }
      cumulativeDist += edge.distance;

      segments.push({
        start: { lat: nodeA.lat, lng: nodeA.lng },
        end: { lat: nodeB.lat, lng: nodeB.lng },
        safetyScore: edge.safetyScore,
        color: segmentColor(edge.safetyScore),
        highway: edge.highway,
        roadName: edge.roadName,
        isDeadEnd: edge.isDeadEnd,
        hasSidewalk: edge.hasSidewalk,
        surfaceType: edge.surfaceType,
        lightScore: edge.lightScore,
        crimeScore: edge.crimeScore,
        cctvScore: edge.cctvScore,
        placeScore: edge.placeScore,
        trafficScore: edge.trafficScore,
        distance: Math.round(edge.distance),
      });
    }

    const routePOIs = collectRoutePOIs(
      route.path,
      osmNodes,
      cctvNodes,
      transitNodes,
      nodeDegree,
      lightNodes,
      placeNodes,
      crimes,
    );

    const routeStats = {
      deadEnds: deadEndCount,
      sidewalkPct:
        route.totalDist > 0
          ? Math.round((sidewalkDist / route.totalDist) * 100)
          : 0,
      unpavedPct:
        route.totalDist > 0
          ? Math.round((unpavedDist / route.totalDist) * 100)
          : 0,
      transitStopsNearby: Math.min(transitStopCount, 50),
      cctvCamerasNearby: Math.min(cctvNearCount, 50),
      roadNameChanges,
    };

    return {
      routeIndex: idx,
      isSafest: idx === 0,
      overview_polyline: { points: encodePolyline(polyline) },
      legs: [
        {
          distance: {
            text:
              route.totalDist >= 1000
                ? `${(route.totalDist / 1000).toFixed(1)} km`
                : `${Math.round(route.totalDist)} m`,
            value: Math.round(route.totalDist),
          },
          duration: {
            text:
              durationSec >= 3600
                ? `${Math.floor(durationSec / 3600)} hr ${Math.round((durationSec % 3600) / 60)} mins`
                : `${Math.round(durationSec / 60)} mins`,
            value: durationSec,
          },
          start_location: { lat: oLat, lng: oLng },
          end_location: { lat: dLat, lng: dLng },
          steps: [],
        },
      ],
      summary: idx === 0 ? "Safest Route" : `Route ${idx + 1}`,
      safety: {
        score: score100,
        label,
        color,
        breakdown: {
          roadType: Math.round(breakdown.roadType * 100),
          lighting: Math.round(breakdown.lighting * 100),
          crime: Math.round(breakdown.crime * 100),
          cctv: Math.round(breakdown.cctv * 100),
          openPlaces: Math.round(breakdown.openPlaces * 100),
          traffic: Math.round(breakdown.traffic * 100),
        },
        roadTypes: breakdown.roadTypes,
        mainRoadRatio: Math.round(breakdown.mainRoadRatio * 100),
      },
      segments,
      routeStats,
      routePOIs,
    };
  });

  const minRoutes = Math.min(3, rawRoutes.length);
  return routes.slice(0, Math.max(minRoutes, routes.length));
}

module.exports = {
  collectLightNodes,
  collectOpenPlaceNodes,
  buildRouteResponses,
};

/**
 * routes/safeRoutes.js — Safety-first pathfinding endpoint (v2).
 *
 * GET /api/safe-routes?origin_lat=...&origin_lng=...&dest_lat=...&dest_lng=...
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * SPEED IMPROVEMENTS (vs v1):
 *   1. Single Overpass query instead of 4 parallel ones (~70% less latency)
 *   2. 30-min data cache (OSM) + 24h crime cache (vs 5-min route cache)
 *   3. A* pathfinding with heuristic (3–10× faster per route)
 *   4. Pre-computed coverage maps (lighting, crime) — O(1) per edge
 *   5. Spatial-grid nearest-node lookup — O(1) vs O(n)
 *   6. Request coalescing — concurrent identical requests share one computation
 *
 * ACCURACY IMPROVEMENTS:
 *   1. Crime severity weighting (violent > property > nuisance)
 *   2. Inverse-distance lighting model (closer lamp = much brighter)
 *   3. CCTV cameras as new safety signal
 *   4. Time-of-day adaptive weights
 *   5. Surface quality penalty (gravel/dirt paths)
 *   6. Dead-end detection and penalty
 * ═══════════════════════════════════════════════════════════════════════════
 */

const express = require("express");
const {
  haversine,
  bboxFromPoints,
} = require("../services/geo");
const {
  fetchAllSafetyData,
  fetchRoadNetworkOnly,
} = require("../services/overpassClient");
const { fetchCrimesInBbox } = require("../services/crimeClient");
const {
  createCancellationToken,
  logSearchCancellation,
  registerActiveSearch,
  estimateRequestLoadUnits,
  enqueueComputeJob,
  waitWithCancellation,
  formatWaitMmSs,
} = require("./safeRoutesRuntime");
const {
  createSafeRoutesOrchestrator,
} = require("./safeRoutesOrchestrator");
const {
  parseRouteRequest,
  buildOutOfRangeMessage,
  buildOutOfRangePayload,
} = require("./safeRoutesRequestPolicy");
const { buildRouteResponses } = require("./safeRoutesResponseFormatter");
const {
  buildGraph,
  buildDistanceOnlyGraph,
  aStarDistance,
  findNearestNode,
  findKSafestRoutes,
} = require("../services/safetyGraph");

const router = express.Router();

// Default fallback — can be overridden per request via ?max_distance query param
// (the gateway / user-service resolves the caller's tier → distance limit)
const DEFAULT_MAX_DISTANCE_KM = 20;
const ENABLE_RESPONSE_OPENING_HOURS_PARSE =
  process.env.SAFE_ROUTES_PARSE_RESPONSE_OPENING_HOURS === "1";

const CACHE_TTL_MS = 5 * 60 * 1000;
const { resolveSafeRoutesRequest, hasInflightRequest } = createSafeRoutesOrchestrator({
  computeSafeRoutes,
  estimateRequestLoadUnits,
  enqueueComputeJob,
  waitWithCancellation,
  formatWaitMmSs,
  cacheTtlMs: CACHE_TTL_MS,
});

// ── GET /api/safe-routes ────────────────────────────────────────────────────
router.get("/", async (req, res) => {
  const cancelToken = createCancellationToken();
  const activeSearch = registerActiveSearch(req, cancelToken);
  if (activeSearch.stale) {
    logSearchCancellation("http_stale_response", {
      userKey: activeSearch.userKey,
      searchId: activeSearch.searchId,
      searchSeq: activeSearch.searchSeq,
    });
    return res.status(409).json({
      error: "SEARCH_CANCELLED",
      message:
        "This route search is older than another active search on your account.",
    });
  }
  req.on("close", () => {
    logSearchCancellation("http_client_disconnected", {
      userKey: activeSearch.userKey,
      searchId: activeSearch.searchId,
      searchSeq: activeSearch.searchSeq,
    });
    cancelToken.cancel(
      "Route search was cancelled because the client disconnected.",
    );
  });

  try {
    const parsedRequest = parseRouteRequest(
      req,
      DEFAULT_MAX_DISTANCE_KM,
      haversine,
    );
    if (!parsedRequest.ok) {
      return res.status(400).json({ error: parsedRequest.error });
    }

    const {
      oLat,
      oLng,
      dLat,
      dLng,
      wpLat,
      wpLng,
      straightLineDist,
      straightLineKm,
      maxDistanceKm,
    } = parsedRequest.value;

    if (straightLineKm > maxDistanceKm) {
      return res.status(400).json(
        buildOutOfRangePayload({
          oLat,
          oLng,
          dLat,
          dLng,
          straightLineKm,
          maxDistanceKm,
        }),
      );
    }

    const { result } = await resolveSafeRoutesRequest({
      oLat,
      oLng,
      dLat,
      dLng,
      straightLineDist,
      straightLineKm,
      maxDistanceKm,
      wpLat,
      wpLng,
      cancelToken,
    });

    res.json(result);
  } catch (err) {
    if (err?.code === "SEARCH_CANCELLED") {
      logSearchCancellation("http_cancelled_response", {
        userKey: activeSearch.userKey,
        searchId: activeSearch.searchId,
        searchSeq: activeSearch.searchSeq,
        reason: err.message,
      });
      if (!res.headersSent) {
        return res.status(409).json({
          error: "SEARCH_CANCELLED",
          message: err.message,
        });
      }
      return;
    }
    console.error(`[safe-routes] ❌ Error:`, err);
    if (!res.headersSent) {
      res.status(500).json({
        error: "INTERNAL_ERROR",
        message: "Something went wrong on our end while computing your route.",
        detail:
          "This is usually a temporary issue with one of our data sources (OpenStreetMap or the Police crime API). Please wait a moment and try again.",
      });
    }
  } finally {
    activeSearch.release();
  }
});

// ── GET /api/safe-routes/stream (SSE progress, low-overhead) ──────────────
router.get("/stream", async (req, res) => {
  let closed = false;
  let keepAliveTimer = null;
  const cancelToken = createCancellationToken();
  const activeSearch = registerActiveSearch(req, cancelToken);

  if (activeSearch.stale) {
    logSearchCancellation("sse_stale_response", {
      userKey: activeSearch.userKey,
      searchId: activeSearch.searchId,
      searchSeq: activeSearch.searchSeq,
    });
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    if (typeof res.flushHeaders === "function") res.flushHeaders();
    res.write("event: error\n");
    res.write(
      `data: ${JSON.stringify({ code: "SEARCH_CANCELLED", message: "This route search is older than another active search on your account.", pct: 0 })}\n\n`,
    );
    return res.end();
  }

  const cleanup = () => {
    if (keepAliveTimer) {
      clearInterval(keepAliveTimer);
      keepAliveTimer = null;
    }
  };

  req.on("close", () => {
    closed = true;
    logSearchCancellation("sse_client_disconnected", {
      userKey: activeSearch.userKey,
      searchId: activeSearch.searchId,
      searchSeq: activeSearch.searchSeq,
    });
    cancelToken.cancel(
      "Route search was cancelled because the client disconnected.",
    );
    activeSearch.release();
    cleanup();
  });

  cancelToken.onCancel((reason) => {
    if (closed) return;
    logSearchCancellation("sse_cancel_signal", {
      userKey: activeSearch.userKey,
      searchId: activeSearch.searchId,
      searchSeq: activeSearch.searchSeq,
      reason,
    });
    send("error", { code: "SEARCH_CANCELLED", message: reason, pct: 0 });
    closed = true;
    cleanup();
    try {
      res.end();
    } catch {
      // ignore
    }
    activeSearch.release();
  });

  const send = (event, data) => {
    if (closed) return;
    try {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch {
      // Client disconnected
    }
  };

  try {
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    if (typeof res.flushHeaders === "function") res.flushHeaders();

    keepAliveTimer = setInterval(() => {
      if (closed) return;
      try {
        res.write(": keepalive\n\n");
      } catch {
        // ignore write failures
      }
    }, 15000);

    send("phase", {
      phase: "init",
      message: "Starting route analysis…",
      pct: 20,
    });

    const parsedRequest = parseRouteRequest(
      req,
      DEFAULT_MAX_DISTANCE_KM,
      haversine,
    );
    if (!parsedRequest.ok) {
      send("error", { message: parsedRequest.error, pct: 0 });
      return res.end();
    }

    const {
      oLat,
      oLng,
      dLat,
      dLng,
      wpLat,
      wpLng,
      straightLineDist,
      straightLineKm,
      maxDistanceKm,
    } = parsedRequest.value;

    if (straightLineKm > maxDistanceKm) {
      send("error", {
        message: buildOutOfRangeMessage(straightLineKm, maxDistanceKm),
        pct: 0,
      });
      return res.end();
    }

    if (hasInflightRequest({ oLat, oLng, dLat, dLng, wpLat, wpLng })) {
      send("phase", {
        phase: "coalesced",
        message: "Joining active route computation…",
        pct: 20,
      });
    }

    const onProgress = (phase, message, pct) => {
      send("phase", { phase, message, pct });
    };

    const { source } = await resolveSafeRoutesRequest({
      oLat,
      oLng,
      dLat,
      dLng,
      straightLineDist,
      straightLineKm,
      maxDistanceKm,
      wpLat,
      wpLng,
      onProgress,
      cancelToken,
    });

    if (source === "cache") {
      send("phase", {
        phase: "cache_hit",
        message: "Using cached route analysis…",
        pct: 96,
      });
    }

    send("done", { pct: 100, message: "Routes ready!" });
    cleanup();
    activeSearch.release();
    res.end();
  } catch (err) {
    if (err?.code === "SEARCH_CANCELLED") {
      logSearchCancellation("sse_cancelled_response", {
        userKey: activeSearch.userKey,
        searchId: activeSearch.searchId,
        searchSeq: activeSearch.searchSeq,
        reason: err.message,
      });
      send("error", { code: "SEARCH_CANCELLED", message: err.message, pct: 0 });
      cleanup();
      activeSearch.release();
      return res.end();
    }
    send("error", {
      message:
        err?.message || "Something went wrong while streaming route progress.",
      pct: 0,
    });
    cleanup();
    activeSearch.release();
    res.end();
  }
});

/**
 * Core computation — separated for request coalescing.
 */
async function computeSafeRoutes(
  oLatV,
  oLngV,
  dLatV,
  dLngV,
  straightLineDist,
  straightLineKm,
  startTime,
  maxDistanceKm = DEFAULT_MAX_DISTANCE_KM,
  wpLat = null,
  wpLng = null,
  cancelToken = null,
  onProgress = null,
) {
  cancelToken?.throwIfCancelled?.();
  const upstreamAbortController = new AbortController();
  const cancelUnsub = cancelToken?.onCancel?.(() => {
    try {
      upstreamAbortController.abort();
    } catch {
      // ignore abort errors
    }
  });

  const progress = (phase, message, pct) => {
    if (typeof onProgress !== "function") return;
    if (cancelToken?.isCancelled?.()) return;
    try {
      onProgress(phase, message, pct);
    } catch {
      // no-op: progress is best-effort
    }
  };

  progress("start", "Preparing route analysis…", 20);
  console.log(
    `[safe-routes] 🔍 Computing: ${oLatV},${oLngV} → ${dLatV},${dLngV} (${straightLineKm.toFixed(1)} km)`,
  );

  try {
    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 1 — Corridor discovery (skip for short distances to save time)
    // For routes < 1.5 km, a straight-line corridor works fine.
    // For longer routes, discover the actual walking corridor shape.
    // ═══════════════════════════════════════════════════════════════════════
    let shortestPath = null;
    let distGraph = null;
    let phase1Time = 0;

    const SKIP_PHASE1_DIST = 1500; // skip road-only fetch for < 1.5 km

    if (straightLineDist >= SKIP_PHASE1_DIST) {
      cancelToken?.throwIfCancelled?.();
      progress("phase1", "Discovering walking corridor…", 28);
      console.log(`[safe-routes] 🛤️  Phase 1: Discovering walking corridor...`);
      const t0p1 = Date.now();
      const initialBufferM = Math.max(
        400,
        Math.min(800, straightLineDist * 0.25),
      );
      const initialBboxPoints = [
        { lat: oLatV, lng: oLngV },
        { lat: dLatV, lng: dLngV },
      ];
      if (wpLat != null) initialBboxPoints.push({ lat: wpLat, lng: wpLng });
      const initialBbox = bboxFromPoints(initialBboxPoints, initialBufferM);

      const roadData = await fetchRoadNetworkOnly(initialBbox, {
        signal: upstreamAbortController.signal,
      });
      distGraph = buildDistanceOnlyGraph(roadData);

      const distStart = findNearestNode(
        distGraph.nodeGrid,
        distGraph.adjacency,
        oLatV,
        oLngV,
      );
      const distEnd = findNearestNode(
        distGraph.nodeGrid,
        distGraph.adjacency,
        dLatV,
        dLngV,
      );

      if (distStart && distEnd) {
        shortestPath = aStarDistance(
          distGraph.osmNodes,
          distGraph.edges,
          distGraph.adjacency,
          distStart,
          distEnd,
          straightLineDist * 3,
        );
      }
      phase1Time = Date.now() - t0p1;
      cancelToken?.throwIfCancelled?.();
      progress("phase1_done", "Walking corridor discovered.", 38);
      console.log(
        `[safe-routes] ✅ Phase 1: ${phase1Time}ms — ${
          shortestPath
            ? shortestPath.path.length +
              " nodes, " +
              Math.round(shortestPath.totalDist) +
              "m"
            : "fallback to straight-line corridor"
        }`,
      );
    } else {
      progress(
        "phase1_skipped",
        "Skipping corridor discovery for short route.",
        34,
      );
      console.log(
        `[safe-routes] ⏩ Phase 1: skipped (${Math.round(straightLineDist)}m < ${SKIP_PHASE1_DIST}m)`,
      );
    }

    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 2 — Build corridor bbox + fetch safety data
    // Smaller buffers to reduce data volume and processing time.
    // ═══════════════════════════════════════════════════════════════════════
    const corridorBufferM = Math.max(
      700,
      Math.min(1000, straightLineDist * 0.3),
    );

    let corridorPoints;
    if (shortestPath && distGraph) {
      corridorPoints = [];
      for (const nodeId of shortestPath.path) {
        const n = distGraph.osmNodes.get(nodeId);
        if (n) corridorPoints.push({ lat: n.lat, lng: n.lng });
      }
    } else {
      const numSamples = Math.max(8, Math.ceil(straightLineKm * 4));
      corridorPoints = [];
      for (let i = 0; i <= numSamples; i++) {
        const t = i / numSamples;
        corridorPoints.push({
          lat: oLatV + (dLatV - oLatV) * t,
          lng: oLngV + (dLngV - oLngV) * t,
        });
      }
    }
    corridorPoints.unshift({ lat: oLatV, lng: oLngV });
    corridorPoints.push({ lat: dLatV, lng: dLngV });
    // Ensure waypoint is also inside the bbox corridor
    if (wpLat != null) corridorPoints.push({ lat: wpLat, lng: wpLng });

    const bbox = bboxFromPoints(corridorPoints, corridorBufferM);
    cancelToken?.throwIfCancelled?.();
    progress("phase2", "Fetching safety data in route corridor…", 50);
    console.log(
      `[safe-routes] 📐 Phase 2: Corridor from ${corridorPoints.length} waypoints + ${corridorBufferM}m buffer`,
    );

    // ── Fetch ALL safety data within the corridor ───────────────────────
    console.log(
      `[safe-routes] 📡 Fetching safety data in corridor (Overpass + Crime)...`,
    );
    const t0 = Date.now();

    let [allData, crimes] = await Promise.all([
      fetchAllSafetyData(bbox, { signal: upstreamAbortController.signal }),
      fetchCrimesInBbox(bbox, { signal: upstreamAbortController.signal }),
    ]);

    let dataTime = Date.now() - t0;
    cancelToken?.throwIfCancelled?.();
    progress("phase2_done", "Safety data loaded.", 66);
    console.log(`[safe-routes] 📡 Corridor data fetched in ${dataTime}ms`);

    let roadCount = allData.roads.elements.filter(
      (e) => e.type === "way",
    ).length;
    let nodeCount = allData.roads.elements.filter(
      (e) => e.type === "node",
    ).length;
    console.log(
      `[safe-routes] 📊 Data: ${roadCount} roads, ${nodeCount} nodes, ${crimes.length} crimes, ${allData.lights.elements.length} lights, ${allData.cctv.elements.length} CCTV`,
    );

    // ── 6b. Extract light & place node positions for POI markers ────────
    // ── 7. Build safety-weighted graph (with coverage maps) ─────────────
    console.log(`[safe-routes] 🏗️  Building graph + coverage maps...`);
    cancelToken?.throwIfCancelled?.();
    progress("graph_build", "Building safety graph…", 74);
    const t1 = Date.now();
    let {
      osmNodes,
      edges,
      adjacency,
      nodeGrid,
      weights,
      cctvNodes,
      transitNodes,
      nodeDegree,
    } = buildGraph(
      allData.roads,
      allData.lights,
      allData.cctv,
      allData.places,
      allData.transit,
      crimes,
      bbox,
      { shouldCancel: () => cancelToken?.isCancelled?.() === true },
    );
    let graphTime = Date.now() - t1;
    cancelToken?.throwIfCancelled?.();
    progress("graph_ready", "Running safest path search…", 82);
    console.log(
      `[safe-routes] 📊 Graph: ${osmNodes.size} nodes, ${edges.length} edges (built in ${graphTime}ms)`,
    );

    if (edges.length === 0) {
      throw Object.assign(
        new Error(
          "We found roads in this area but none of them are walkable (they may all be motorways or private roads). Try a destination in a more pedestrian-friendly area.",
        ),
        { statusCode: 404, code: "NO_WALKING_NETWORK", roadCount },
      );
    }

    // ── 8. Find nearest graph nodes (O(1) via spatial grid) ─────────────
    let startNode = findNearestNode(nodeGrid, adjacency, oLatV, oLngV);
    let endNode = findNearestNode(nodeGrid, adjacency, dLatV, dLngV);

    if (!startNode || !endNode) {
      const which = !startNode ? "origin" : "destination";
      throw Object.assign(
        new Error(
          `We couldn't find a walkable road within 200 m of your ${which}. ` +
            `This can happen if the point is in the middle of a park, body of water, or private land. ` +
            `Try tapping a spot closer to a street or footpath.`,
        ),
        { statusCode: 404, code: "NO_NEARBY_ROAD", which },
      );
    }

    // ── 9. Find 3–5 safest routes (A* — much faster than Dijkstra) ─────
    console.log(
      `[safe-routes] 🔎 A* pathfinding (start=${startNode}, end=${endNode})...`,
    );
    cancelToken?.throwIfCancelled?.();
    progress("pathfind", "Computing route candidates…", 86);
    const t2 = Date.now();
    const maxRouteDist = straightLineDist * 2.5;
    let rawRoutes;

    if (wpLat != null) {
      // ── Two-leg via-waypoint pathfinding ──────────────────────────────
      const waypointNode = findNearestNode(nodeGrid, adjacency, wpLat, wpLng);
      if (
        waypointNode &&
        waypointNode !== startNode &&
        waypointNode !== endNode
      ) {
        const leg1Routes = findKSafestRoutes(
          osmNodes,
          edges,
          adjacency,
          startNode,
          waypointNode,
          maxRouteDist * 0.7,
          1,
        );
        const leg2Routes = findKSafestRoutes(
          osmNodes,
          edges,
          adjacency,
          waypointNode,
          endNode,
          maxRouteDist * 0.7,
          3,
        );
        if (leg1Routes.length > 0 && leg2Routes.length > 0) {
          const leg1 = leg1Routes[0];
          rawRoutes = leg2Routes.map((leg2) => ({
            path: [...leg1.path, ...leg2.path.slice(1)],
            edges: [...leg1.edges, ...leg2.edges],
            totalDist: leg1.totalDist + leg2.totalDist,
          }));
          console.log(
            `[safe-routes] 📍 Via waypoint node ${waypointNode}: ${leg1.path.length}+${leg2Routes[0].path.length} nodes, ${rawRoutes.length} combined routes`,
          );
        } else {
          console.log(
            `[safe-routes] ⚠️  Via routing failed (leg1=${leg1Routes.length}, leg2=${leg2Routes.length}), falling back to direct`,
          );
          rawRoutes = findKSafestRoutes(
            osmNodes,
            edges,
            adjacency,
            startNode,
            endNode,
            maxRouteDist,
            3,
          );
        }
      } else {
        console.log(
          `[safe-routes] ⚠️  Waypoint node not found in graph, falling back to direct`,
        );
        rawRoutes = findKSafestRoutes(
          osmNodes,
          edges,
          adjacency,
          startNode,
          endNode,
          maxRouteDist,
          3,
        );
      }
    } else {
      rawRoutes = findKSafestRoutes(
        osmNodes,
        edges,
        adjacency,
        startNode,
        endNode,
        maxRouteDist,
        3,
      );
    }

    let pathfindTime = Date.now() - t2;
    cancelToken?.throwIfCancelled?.();
    progress("pathfind_done", "Scoring and formatting route options…", 89);
    console.log(
      `[safe-routes] 🔎 A* found ${rawRoutes.length} routes in ${pathfindTime}ms`,
    );

    if (rawRoutes.length === 0) {
      throw Object.assign(
        new Error(
          `We analysed ${osmNodes.size.toLocaleString()} intersections and ${edges.length.toLocaleString()} road segments ` +
            `but couldn't connect your origin to the destination. ` +
            `They're likely separated by a barrier with no pedestrian crossing — a motorway, river, railway, or restricted area.`,
        ),
        {
          statusCode: 404,
          code: "NO_ROUTE_FOUND",
          graphNodes: osmNodes.size,
          graphEdges: edges.length,
        },
      );
    }

    // Recorrection removed — too expensive for 512MB/0.1CPU.
    const recorrectionMs = 0;

    const responseRoutes = buildRouteResponses({
      rawRoutes,
      osmNodes,
      edges,
      weights,
      cctvNodes,
      transitNodes,
      nodeDegree,
      crimes,
      allData,
      oLat: oLatV,
      oLng: oLngV,
      dLat: dLatV,
      dLng: dLngV,
      enableOpeningHoursParse: ENABLE_RESPONSE_OPENING_HOURS_PARSE,
    });

    const elapsed = Date.now() - startTime;
    cancelToken?.throwIfCancelled?.();
    progress("finalize", "Finalizing route output…", 90);
    console.log(
      `[safe-routes] 🏁 Done in ${elapsed}ms (corridor:${phase1Time}ms, data:${dataTime}ms, graph:${graphTime}ms, A*:${pathfindTime}ms, recorrection:${recorrectionMs}ms) — ${responseRoutes.length} routes, safest: ${responseRoutes[0]?.safety?.score}`,
    );

    return {
      status: "OK",
      routes: responseRoutes,
      meta: {
        straightLineDistanceKm: Math.round(straightLineKm * 10) / 10,
        maxDistanceKm: maxDistanceKm,
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
      },
    };
  } finally {
    if (typeof cancelUnsub === "function") cancelUnsub();
  }
}

module.exports = router;

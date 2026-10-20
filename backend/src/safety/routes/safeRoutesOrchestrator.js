// Total size of cached route responses (estimated as their JSON length). Oldest entries go first.
const MAX_ROUTE_CACHE_BYTES = 64 * 1024 * 1024;

function estimateJsonBytes(data) {
  try {
    return JSON.stringify(data).length;
  } catch {
    return 0;
  }
}

function createSafeRoutesOrchestrator({
  computeSafeRoutes,
  estimateRequestLoadUnits,
  enqueueComputeJob,
  waitWithCancellation,
  formatWaitMmSs,
  cacheTtlMs = 5 * 60 * 1000,
  maxCacheEntries = 100,
  maxCacheBytes = MAX_ROUTE_CACHE_BYTES,
}) {
  const routeCache = new Map();
  let routeCacheBytes = 0;
  const inflight = new Map();

  function cacheDelete(key) {
    const entry = routeCache.get(key);
    if (!entry) return;
    routeCacheBytes -= entry.bytes;
    routeCache.delete(key);
  }

  // Map iterates in insertion order, so the first keys are the oldest. The entry just stored is never evicted.
  function cacheSet(key, data) {
    cacheDelete(key);
    const bytes = estimateJsonBytes(data);
    routeCache.set(key, { data, timestamp: Date.now(), bytes });
    routeCacheBytes += bytes;
    for (const oldestKey of routeCache.keys()) {
      if (routeCacheBytes <= maxCacheBytes || oldestKey === key) break;
      cacheDelete(oldestKey);
    }
  }

  function getResponsePolicyKey(responsePolicy) {
    const verbosity = responsePolicy?.verbosity === "compact" ? "compact" : "full";
    const poiCaps = responsePolicy?.poiCaps || {};
    const categories = ["cctv", "transit", "deadEnds", "lights", "places", "crimes"];
    const capsPart = categories
      .map((category) => {
        const capValue = poiCaps[category];
        if (capValue === Infinity) return `${category}:all`;
        return Number.isFinite(capValue) ? `${category}:${capValue}` : `${category}:default`;
      })
      .join("|");
    const openPart = responsePolicy?.openPlacesOnly === false ? "all-places" : "open-only";

    return `${verbosity}|${openPart}|${capsPart}`;
  }

  // Standard and extra results differ, so the safety level is part of the key.
  // The response echoes maxDistanceKm in its meta, so it is part of the key too.
  function getCacheKey(oLat, oLng, dLat, dLng, wpLat, wpLng, responsePolicy, departureHour, allowHazards, safetyLevel = "extra", maxDistanceKm = null) {
    const r = (v) => Math.round(v * 1000) / 1000;
    const base = `${r(oLat)},${r(oLng)}->${r(dLat)},${r(dLng)}`;
    const routeKey = wpLat != null && wpLng != null
      ? `${base}@${r(wpLat)},${r(wpLng)}`
      : base;
    const dhPart = departureHour != null ? `h${departureHour}` : '';
    const hazardPart = allowHazards ? 'H' : '';
    const maxPart = maxDistanceKm != null ? `m${maxDistanceKm}` : '';

    return `${routeKey}${dhPart}${hazardPart}${maxPart}|${safetyLevel}#${getResponsePolicyKey(responsePolicy)}`;
  }

  function emitInflightProgress(entry, phase, message, pct) {
    const payload = { phase, message, pct };
    entry.lastProgress = payload;
    entry.progressListeners.forEach((listener) => {
      try {
        listener(phase, message, pct);
      } catch {
        // best-effort listener fanout
      }
    });
  }

  function pruneRouteCache() {
    if (routeCache.size <= maxCacheEntries) return;
    const now = Date.now();
    for (const [key, val] of routeCache) {
      if (now - val.timestamp > cacheTtlMs) cacheDelete(key);
    }
  }

  async function resolveSafeRoutesRequest({
    oLat,
    oLng,
    dLat,
    dLng,
    straightLineDist,
    straightLineKm,
    maxDistanceKm,
    wpLat,
    wpLng,
    departureHour = null,
    allowHazards = false,
    responsePolicy,
    onProgress,
    cancelToken = null,
    safetyLevel = "extra",
  }) {
    cancelToken?.throwIfCancelled?.();
    const cacheKey = getCacheKey(
      oLat,
      oLng,
      dLat,
      dLng,
      wpLat,
      wpLng,
      responsePolicy,
      departureHour,
      allowHazards,
      safetyLevel,
      maxDistanceKm,
    );
    const cached = routeCache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < cacheTtlMs) {
      console.log(`[safe-routes] 📋 Route cache hit for ${cacheKey}`);
      return { result: cached.data, source: "cache" };
    }

    if (inflight.has(cacheKey)) {
      console.log(
        `[safe-routes] ⏳ Coalescing with in-flight request for ${cacheKey}`,
      );
      const entry = inflight.get(cacheKey);
      let subscribed = false;

      if (entry && typeof onProgress === "function") {
        entry.progressListeners.add(onProgress);
        subscribed = true;
        if (entry.lastProgress) {
          onProgress(
            entry.lastProgress.phase,
            entry.lastProgress.message,
            entry.lastProgress.pct,
          );
        }
      }

      let result;
      try {
        result = await waitWithCancellation(entry.promise, cancelToken);
      } finally {
        if (subscribed) entry.progressListeners.delete(onProgress);
      }

      cancelToken?.throwIfCancelled?.();
      if (!result) {
        throw Object.assign(new Error("Computation failed."), {
          statusCode: 500,
          code: "INTERNAL_ERROR",
        });
      }

      return { result, source: "inflight" };
    }

    const inflightEntry = {
      promise: null,
      progressListeners: new Set(),
      lastProgress: null,
    };

    if (typeof onProgress === "function") {
      inflightEntry.progressListeners.add(onProgress);
    }

    inflight.set(cacheKey, inflightEntry);

    const requestLoadUnits = estimateRequestLoadUnits({
      straightLineKm,
      maxDistanceKm,
      hasWaypoint: Number.isFinite(wpLat) && Number.isFinite(wpLng),
    });

    try {
      inflightEntry.promise = enqueueComputeJob({
        run: () =>
          computeSafeRoutes(
            oLat,
            oLng,
            dLat,
            dLng,
            straightLineDist,
            straightLineKm,
            Date.now(),
            maxDistanceKm,
            wpLat,
            wpLng,
            departureHour,
            allowHazards,
            cancelToken,
            (phase, message, pct) =>
              emitInflightProgress(inflightEntry, phase, message, pct),
            responsePolicy,
            safetyLevel,
          ),
        onQueueUpdate: ({
          queuePosition,
          waitLabel,
          activeCount,
          activeLoadUnits,
          queuedCount,
          maxServerLoadUnits,
          requestLoadUnits: queuedLoadUnits,
        }) => {
          const ahead = queuePosition + 1;
          emitInflightProgress(
            inflightEntry,
            "queued",
            `Server busy — queued (${ahead} ahead, ${activeCount} active, load ${activeLoadUnits}/${maxServerLoadUnits}). Est. ${waitLabel}`,
            20,
          );

          if (queuedCount > 0) {
            emitInflightProgress(
              inflightEntry,
              "queue_stats",
              `Queue size: ${queuedCount} requests • this route load ${queuedLoadUnits}/${maxServerLoadUnits}`,
              20,
            );
          }
        },
        onStart: ({
          activeCount,
          activeLoadUnits,
          queuedCount,
          maxServerLoadUnits,
          expectedMs,
          requestLoadUnits: startedLoadUnits,
        }) => {
          const expectedLabel = formatWaitMmSs(expectedMs);
          emitInflightProgress(
            inflightEntry,
            "queue_start",
            `Starting safety analysis (${activeCount} active, ${queuedCount} queued, load ${activeLoadUnits}/${maxServerLoadUnits}, route load ${startedLoadUnits}). Est. ${expectedLabel}`,
            22,
          );
        },
        requestLoadUnits,
        cancelToken,
      });

      const result = await waitWithCancellation(
        inflightEntry.promise,
        cancelToken,
      );

      if (!result) {
        throw Object.assign(new Error("Computation failed."), {
          statusCode: 500,
          code: "INTERNAL_ERROR",
        });
      }

      cacheSet(cacheKey, result);
      return { result, source: "computed" };
    } finally {
      inflight.delete(cacheKey);
      pruneRouteCache();
    }
  }

  function hasInflightRequest({
    oLat,
    oLng,
    dLat,
    dLng,
    wpLat,
    wpLng,
    responsePolicy,
    departureHour,
    allowHazards,
    safetyLevel = "extra",
    maxDistanceKm = null,
  }) {
    const key = getCacheKey(oLat, oLng, dLat, dLng, wpLat, wpLng, responsePolicy, departureHour, allowHazards, safetyLevel, maxDistanceKm);
    return inflight.has(key);
  }

  return {
    resolveSafeRoutesRequest,
    hasInflightRequest,
  };
}

module.exports = {
  createSafeRoutesOrchestrator,
  MAX_ROUTE_CACHE_BYTES,
};

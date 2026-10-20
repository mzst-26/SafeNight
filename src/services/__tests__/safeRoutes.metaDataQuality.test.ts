import type { SafeRoutesResponse } from "../safeRoutes";

describe("SafeRoutesResponse meta.dataQuality", () => {
  it("types the crime outage state and the lighting quality the backend sends", () => {
    const meta: SafeRoutesResponse["meta"] = {
      straightLineDistanceKm: 1.2,
      maxDistanceKm: 20,
      routeCount: 1,
      dataQuality: {
        roads: 10,
        crimes: 0,
        lightElements: 4,
        cctvCameras: 0,
        places: 0,
        transitStops: 0,
        crime: "unavailable",
        lighting: "verified",
      },
      timing: { totalMs: 1, dataFetchMs: 0, graphBuildMs: 0, pathfindMs: 0 },
      computeTimeMs: 1,
    };

    expect(meta.dataQuality.crime).toBe("unavailable");
    expect(meta.dataQuality.lighting).toBe("verified");
  });

  it("keeps both fields optional for older backends", () => {
    const dataQuality: SafeRoutesResponse["meta"]["dataQuality"] = {
      roads: 0, crimes: 0, lightElements: 0, cctvCameras: 0, places: 0, transitStops: 0,
    };

    expect(dataQuality.crime).toBeUndefined();
  });
});

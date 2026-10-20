/** Hand-built graphs shared by the routing, candidates, ranking and breakdown tests. */
const ORIGIN = { lat: 51.5, lng: -0.1 };

/**
 * Edges as [from, to, distance, risk]. Every edge sits at ORIGIN (routes compare by risk and length, not
 * by geometry), is bidirectional, has no sidewalk problem and carries the fields the aggregation reads.
 */
function manualGraph(spec, extra = {}) {
  const osmNodes = new Map();
  const adjacency = new Map();
  const edges = [];
  for (const [from, to] of spec) {
    for (const id of [from, to]) if (!osmNodes.has(id)) osmNodes.set(id, { id, lat: ORIGIN.lat, lng: ORIGIN.lng });
  }
  spec.forEach(([from, to, distance, risk]) => {
    const idx = edges.length;
    edges.push({
      idx, from, to, distance, risk, safetyScore: 1 - risk, certainty: 0.8, cause: 'lighting',
      start: ORIGIN, end: ORIGIN, penalty: 0, highway: 'residential',
      roadScore: 0.5, lightScore: 0.5, crimeScore: 0.5, cctvScore: 0, placeScore: 0, trafficScore: 0.5,
      hasSidewalk: true, isTunnel: false, isLit: true, maxspeed: '',
      ...extra,
    });
    for (const [a, b] of [[from, to], [to, from]]) {
      if (!adjacency.has(a)) adjacency.set(a, []);
      adjacency.get(a).push({ edgeIdx: idx, neighborId: b });
    }
  });
  return { osmNodes, edges, adjacency };
}

module.exports = { ORIGIN, manualGraph };

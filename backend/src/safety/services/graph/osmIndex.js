/**
 * OSM road data indexing: nodes, the nearest-node grid, node degree and the walkable segments.
 * These are the stages that need no lighting, crime or activity data, so the distance-only graph shares them.
 */
const { fastDistance, buildSpatialGrid } = require('../geo');
const { ROAD_TYPE_SCORES, GRAPH } = require('../../scoring/config');
const { BARRIER_HIGHWAYS } = require('../../scoring/roadProximity');

/** Highway classes the router walks: exactly the classes that have a road score. */
const WALKABLE_HIGHWAYS = new Set(Object.keys(ROAD_TYPE_SCORES));

/**
 * Indexes the node elements of an Overpass-style response by id.
 * @param {{elements: Array<object>}} roadData
 * @param {() => void} [tick] Called once per element, for cancellation checks.
 * @returns {Map<number, {lat: number, lng: number, id: number}>}
 */
function indexNodes(roadData, tick = () => {}) {
  const osmNodes = new Map();
  for (const el of roadData.elements) {
    tick();
    if (el.type === 'node') osmNodes.set(el.id, { lat: el.lat, lng: el.lon, id: el.id });
  }
  return osmNodes;
}

/**
 * Spatial grid of every node (about 110 m cells) for the nearest-node lookup.
 * @param {Map<number, {lat: number, lng: number}>} osmNodes
 * @param {() => void} [tick]
 */
function buildNodeGrid(osmNodes, tick = () => {}) {
  const nodeArray = [];
  for (const [id, node] of osmNodes) {
    tick();
    nodeArray.push({ lat: node.lat, lng: node.lng, id });
  }
  return buildSpatialGrid(nodeArray, 'lat', 'lng', GRAPH.NODE_GRID_CELL_DEG);
}

/** True for a way element that carries a highway tag and a node list. */
function isHighwayWay(el) {
  return el.type === 'way' && Boolean(el.nodes) && Boolean(el.tags?.highway);
}

/**
 * Number of highway-way segments meeting at each node, over ALL highway ways (walkable or not), so a
 * footway meeting a motorway is not a dead end.
 * @param {{elements: Array<object>}} roadData
 * @param {Map<number, object>} osmNodes
 * @param {() => void} [tick]
 * @returns {Map<number, number>}
 */
function computeNodeDegree(roadData, osmNodes, tick = () => {}) {
  const nodeDegree = new Map();
  for (const el of roadData.elements) {
    tick();
    if (!isHighwayWay(el)) continue;
    for (let i = 0; i < el.nodes.length - 1; i++) {
      const a = el.nodes[i];
      const b = el.nodes[i + 1];
      if (!osmNodes.has(a) || !osmNodes.has(b)) continue;
      nodeDegree.set(a, (nodeDegree.get(a) || 0) + 1);
      nodeDegree.set(b, (nodeDegree.get(b) || 0) + 1);
    }
  }
  return nodeDegree;
}

/**
 * Length of a segment in metres, never below MIN_EDGE_LENGTH_M: nodes at identical coordinates stay joined by
 * a 0.5 m edge instead of being dropped, which would disconnect the network.
 */
function segmentLengthM(nA, nB) {
  return Math.max(fastDistance(nA.lat, nA.lng, nB.lat, nB.lng), GRAPH.MIN_EDGE_LENGTH_M);
}

/**
 * Calls visit(way, i, nA, nB, dist) for every consecutive node pair of every walkable way whose two nodes are
 * both known. Order follows the data.
 * @param {{elements: Array<object>}} roadData
 * @param {Map<number, object>} osmNodes
 * @param {(el: object, i: number, nA: object, nB: object, dist: number) => void} visit
 * @param {() => void} [tick] Called once per element.
 */
function forEachWalkableSegment(roadData, osmNodes, visit, tick = () => {}) {
  for (const el of roadData.elements) {
    tick();
    if (!isHighwayWay(el) || !WALKABLE_HIGHWAYS.has(el.tags.highway)) continue;
    for (let i = 0; i < el.nodes.length - 1; i++) {
      const nA = osmNodes.get(el.nodes[i]);
      const nB = osmNodes.get(el.nodes[i + 1]);
      if (!nA || !nB) continue;
      visit(el, i, nA, nB, segmentLengthM(nA, nB));
    }
  }
}

/**
 * Walkable segments with their geometry, scored later. idx is the future edge index.
 * @returns {Array<{idx: number, from: number, to: number, nA: object, nB: object, dist: number,
 *   highway: string, tags: object, midLat: number, midLng: number}>}
 */
function collectWalkableSegments(roadData, osmNodes, tick = () => {}) {
  const segments = [];
  forEachWalkableSegment(roadData, osmNodes, (el, i, nA, nB, dist) => {
    segments.push({
      idx: segments.length,
      wayId: el.id,
      from: el.nodes[i],
      to: el.nodes[i + 1],
      nA,
      nB,
      dist,
      highway: el.tags.highway,
      tags: el.tags,
      midLat: (nA.lat + nB.lat) / 2,
      midLng: (nA.lng + nB.lng) / 2,
    });
  }, tick);
  return segments;
}

/**
 * Segments of motorway and trunk ways (and their links), whether or not the router walks them: the barriers a
 * footbridge or underpass may cross. Not edges; geometry only.
 * @param {{elements: Array<object>}} roadData
 * @param {Map<number, object>} osmNodes
 * @param {() => void} [tick]
 * @returns {Array<{aLat: number, aLng: number, bLat: number, bLng: number}>}
 */
function collectBarrierSegments(roadData, osmNodes, tick = () => {}) {
  const barriers = [];
  for (const el of roadData.elements) {
    tick();
    if (!isHighwayWay(el) || !BARRIER_HIGHWAYS.has(el.tags.highway)) continue;
    for (let i = 0; i < el.nodes.length - 1; i++) {
      const nA = osmNodes.get(el.nodes[i]);
      const nB = osmNodes.get(el.nodes[i + 1]);
      if (nA && nB) barriers.push({ aLat: nA.lat, aLng: nA.lng, bLat: nB.lat, bLng: nB.lng });
    }
  }
  return barriers;
}

module.exports = {
  WALKABLE_HIGHWAYS,
  collectBarrierSegments,
  indexNodes,
  buildNodeGrid,
  isHighwayWay,
  computeNodeDegree,
  segmentLengthM,
  forEachWalkableSegment,
  collectWalkableSegments,
};

/**
 * Distance-only graph and A* (phase 1 corridor discovery): the walking network topology with no safety
 * scoring, to find the shortest walking corridor quickly.
 */
const { fastDistance } = require('../geo');
const { SEARCH } = require('../../scoring/config');
const { throwIfCancelled, cancelCallbackOf } = require('./common');
const { MinHeap } = require('./minHeap');
const { indexNodes, buildNodeGrid, forEachWalkableSegment } = require('./osmIndex');

/**
 * Builds a lightweight distance-only graph from road data.
 * @param {{elements: Array<object>}} roadData
 * @returns {{osmNodes: Map, edges: Array<{from: number, to: number, distance: number}>, adjacency: Map, nodeGrid: object}}
 */
function buildDistanceOnlyGraph(roadData) {
  const osmNodes = indexNodes(roadData);
  const nodeGrid = buildNodeGrid(osmNodes);
  const edges = [];
  const adjacency = new Map();

  forEachWalkableSegment(roadData, osmNodes, (el, i, nA, nB, dist) => {
    const from = el.nodes[i];
    const to = el.nodes[i + 1];
    const edgeIdx = edges.length;
    edges.push({ from, to, distance: dist });
    if (!adjacency.has(from)) adjacency.set(from, []);
    if (!adjacency.has(to)) adjacency.set(to, []);
    adjacency.get(from).push({ edgeIdx, neighborId: to });
    adjacency.get(to).push({ edgeIdx, neighborId: from });
  });

  return { osmNodes, edges, adjacency, nodeGrid };
}

/** Walks the predecessor map back from the end node; null when the chain is broken. */
function pathFromPrev(prev, startId, endId) {
  const path = [];
  let node = endId;
  while (node !== startId) {
    path.push(node);
    const p = prev.get(node);
    if (!p) return null;
    node = p.prevNode;
  }
  path.push(startId);
  return path.reverse();
}

/** Total straight-line metres between consecutive path nodes that are known. */
function pathLength(osmNodes, path) {
  let totalDist = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const a = osmNodes.get(path[i]);
    const b = osmNodes.get(path[i + 1]);
    if (a && b) totalDist += fastDistance(a.lat, a.lng, b.lat, b.lng);
  }
  return totalDist;
}

/**
 * Distance-only A*: the shortest walking path by distance, with no safety scoring. Used in phase 1 to trace
 * the walking corridor shape.
 *
 * @param {Map} osmNodes
 * @param {Array<{distance: number}>} edges
 * @param {Map} adjacency
 * @param {number} startId
 * @param {number} endId
 * @param {number} maxDistM Paths longer than this are not considered.
 * @param {{shouldCancel?: () => boolean}} [options] shouldCancel is polled every 1024 heap pops.
 * @returns {{path: Array<number>, totalDist: number}|null}
 * @throws SEARCH_CANCELLED when shouldCancel returns true at a checkpoint.
 */
function aStarDistance(osmNodes, edges, adjacency, startId, endId, maxDistM, options = {}) {
  if (!adjacency.has(startId) || !adjacency.has(endId)) return null;
  const endNode = osmNodes.get(endId);
  const sNode = osmNodes.get(startId);
  if (!endNode || !sNode) return null;

  const shouldCancel = cancelCallbackOf(options);
  const gScore = new Map([[startId, 0]]);
  const prev = new Map();
  const closed = new Set();
  const heap = new MinHeap();
  heap.push(startId, fastDistance(sNode.lat, sNode.lng, endNode.lat, endNode.lng));
  let pops = 0;

  while (heap.size > 0) {
    const { id: current } = heap.pop();
    pops += 1;
    if ((pops & SEARCH.CANCEL_CHECK_MASK) === 0) throwIfCancelled(shouldCancel);
    if (closed.has(current)) continue;
    closed.add(current);
    if (current === endId) break;

    const currentG = gScore.get(current) ?? Infinity;
    for (const { edgeIdx, neighborId } of adjacency.get(current) || []) {
      if (closed.has(neighborId)) continue;
      const tentativeG = currentG + edges[edgeIdx].distance;
      if (tentativeG > maxDistM) continue;
      if (tentativeG < (gScore.get(neighborId) ?? Infinity)) {
        gScore.set(neighborId, tentativeG);
        prev.set(neighborId, { prevNode: current });
        const nNode = osmNodes.get(neighborId);
        const h = nNode ? fastDistance(nNode.lat, nNode.lng, endNode.lat, endNode.lng) : 0;
        heap.push(neighborId, tentativeG + h);
      }
    }
  }

  if (!prev.has(endId) && startId !== endId) return null;
  const path = pathFromPrev(prev, startId, endId);
  return path ? { path, totalDist: pathLength(osmNodes, path) } : null;
}

module.exports = { buildDistanceOnlyGraph, aStarDistance, pathFromPrev, pathLength };

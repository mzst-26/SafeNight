#!/usr/bin/env node
/**
 * calibration-table.js — Prints the v2 calibration archetype table (same scenes and ranges as
 * tests/unit/safety/scoring/calibration.test.js) so constants can be tuned jointly and quickly.
 *
 * Usage: node scripts/eval/calibration-table.js
 */
const path = require('path');
const { buildGraph, routeSafetyBreakdown } = require(path.join(__dirname, '..', '..', 'src', 'safety', 'services', 'safetyGraph'));
const { safetyLabel } = require(path.join(__dirname, '..', '..', 'src', 'safety', 'routes', 'safeRoutesUtils'));
const fixtures = require(path.join(__dirname, '..', '..', 'tests', 'unit', 'safety', 'scoring', 'fixtures', 'calibrationScenes'));

const { NIGHT, ARCHETYPES, ROUTES, routeEdgeIdxs } = fixtures;
const RANGES = fixtures.RANGES || {};

async function graphOf(scene, options = { level: 'extra', crimeStatus: 'ok', ...NIGHT }) {
  return buildGraph(scene.roadData, scene.lightData, scene.cctvData, scene.placeData,
    scene.transitData, scene.crimes, scene.bbox, options);
}

async function main() {
  const rows = [];
  for (const letter of Object.keys(ARCHETYPES)) {
    const graph = await graphOf(ARCHETYPES[letter]());
    const edge = graph.edges.find((e) => e.roadName === 'target');
    const score = Math.round(100 * (1 - edge.risk));
    const range = RANGES[letter];
    const ok = range ? (score >= range[0] && score <= range[1] ? 'ok' : 'OUT') : '';
    rows.push(`${letter.padEnd(3)} ${String(score).padStart(3)}  ${range ? `${range[0]}-${range[1]}`.padEnd(7) : ''.padEnd(7)} ${ok.padEnd(3)} pLit=${edge.pLit.toFixed(3)} eff=${edge.lightScore.toFixed(3)} ${edge.litEstimate}`);
  }
  console.log('Archetype scores at 23:00');
  console.log(rows.join('\n'));
  console.log('\nRoutes');
  for (const name of Object.keys(ROUTES)) {
    const graph = await graphOf(ROUTES[name]());
    const b = routeSafetyBreakdown(graph.edges, routeEdgeIdxs(graph), graph.weights, []);
    const s = Math.round(100 * b.overall);
    console.log(`${name.padEnd(8)} ${s}  ${safetyLabel(s).label}`);
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });

/**
 * leaveout.js — Spatial leave-block-out evaluation of inferLighting.
 *
 * For each fold, the 1 km blocks of that fold are held out:
 *   - the lit tag of every way in those blocks is hidden (labelled ways are the ones scored);
 *   - lit=yes vertices of those ways are removed from the lit-way index, because buildGraphV2
 *     counts a lit-way vertex within 30 m as a lamp, which would leak the label;
 *   - in mode 'hidden', lamps in those blocks are removed too (the spec's default). In mode
 *     'visible', lamps stay, which is the situation a deployed router is in.
 * Predictions for a held-out way come only from the fold that holds it out.
 */

const { blockKeyOf, assignFolds, DEFAULT_BLOCK_M } = require('./spatial');
const { summarise, brierScore } = require('./metrics');
const { outOfFoldBaselines, v1LitRule } = require('./baselines');
const { buildLampIndex, buildLitIndex, lightingFeatures, estimateLighting, areaKeyOf } = require('./features');
const { isLabelled } = require('./records');

const SOURCES = ['prior', 'lamp', 'neighbour-lit', 'absence', 'tag', 'cache'];

function summariseMode(preds, labels) {
  const effective = preds.map((p) => p.effective);
  const pLit = preds.map((p) => p.pLit);
  const bySource = {};
  for (const source of SOURCES) {
    const idx = preds.map((p, i) => (p.source === source ? i : -1)).filter((i) => i >= 0);
    if (idx.length === 0) continue;
    const eff = idx.map((i) => effective[i]);
    const y = idx.map((i) => labels[i]);
    bySource[source] = {
      n: idx.length,
      positiveRate: y.reduce((s, v) => s + v, 0) / idx.length,
      meanEffective: eff.reduce((s, v) => s + v, 0) / idx.length,
      brier: brierScore(eff, y),
    };
  }
  return {
    effective: summarise(effective, labels),
    pLit: summarise(pLit, labels),
    bySource,
  };
}

/**
 * @param {object} input
 * @param {Array} input.records - buildWayRecord output for every way in the bbox
 * @param {Array<{lat: number, lng: number}>} input.lamps - street lamps in the bbox
 * @param {Map<string, number>} input.areaKm - walkable km per 0.003 deg area cell (all ways, not just labelled)
 * @param {object} [input.roadIndex] - road proximity index (collectStudyArea); without it footway geometry is unknown
 * @param {{south: number, west: number, north: number, east: number}} input.bbox
 * @param {number} [input.k=5]
 * @param {number} [input.seed=1]
 * @param {number} [input.blockM=1000]
 * @param {boolean} [input.collectPredictions=false] - include per-way predictions in the result
 * @param {(rec: object) => boolean} [input.scoreable] - which labelled ways are scored; the others still
 *   feed the area lengths and the lit index (used to keep a margin around the bbox)
 */
function runLeaveOut({
  records, lamps, areaKm, roadIndex, bbox, k = 5, seed = 1, blockM = DEFAULT_BLOCK_M, collectPredictions = false,
  scoreable = () => true,
}) {
  const labelled = records.filter((rec) => isLabelled(rec) && scoreable(rec)).map((rec) => ({
    rec,
    block: blockKeyOf(rec.anchor.midLat, rec.anchor.midLng, bbox, blockM),
  }));
  if (labelled.length === 0) throw new Error('no labelled ways (walkable, lit=yes or lit=no) in the sample');

  const folds = assignFolds(labelled.map((x) => x.block), k, seed);
  const lampBlocks = lamps.map((l) => blockKeyOf(l.lat, l.lng, bbox, blockM));
  const litWays = records
    .filter((r) => r.litVertices)
    .map((r) => ({
      vertices: r.litVertices,
      block: r.anchor ? blockKeyOf(r.anchor.midLat, r.anchor.midLng, bbox, blockM) : null,
    }));

  const n = labelled.length;
  const labels = labelled.map((x) => (x.rec.lit === 'yes' ? 1 : 0));
  const predictions = { hidden: new Array(n), visible: new Array(n) };

  for (let fold = 0; fold < k; fold++) {
    const heldBlocks = new Set([...folds.entries()].filter(([, f]) => f === fold).map(([b]) => b));
    const litVertices = [];
    for (const way of litWays) {
      if (way.block !== null && heldBlocks.has(way.block)) continue;
      litVertices.push(...way.vertices);
    }
    const litIndex = buildLitIndex(litVertices);

    for (const mode of ['hidden', 'visible']) {
      const visibleLamps = mode === 'visible'
        ? lamps
        : lamps.filter((_, i) => !heldBlocks.has(lampBlocks[i]));
      const lampIndex = buildLampIndex(visibleLamps);

      labelled.forEach(({ rec, block }, idx) => {
        if (!heldBlocks.has(block)) return;
        const { midLat, midLng } = rec.anchor;
        const features = lightingFeatures({
          anchor: rec.anchor,
          lampIndex,
          litIndex,
          roadIndex,
          areaWayKm: areaKm.get(areaKeyOf(midLat, midLng)) || 0,
        });
        const est = estimateLighting({ ...rec.tags, lit: undefined }, features);
        predictions[mode][idx] = {
          id: rec.id,
          highway: rec.highway,
          fold,
          block,
          label: labels[idx],
          pLit: est.pLit,
          effective: est.effective,
          source: est.source,
          lampCount30m: features.lampCount30m,
          litNeighbour: features.litNeighbour,
          nearRoad: features.nearRoad,
          areaLampDensityPerKm: features.areaLampDensityPerKm,
          areaWayKm: features.areaWayKm,
        };
      });
    }
  }

  const rows = labelled.map((x, idx) => ({ highway: x.rec.highway, label: labels[idx], fold: folds.get(x.block) }));
  const baseline = outOfFoldBaselines(rows);
  const v1 = labelled.map(() => v1LitRule(undefined));

  const byHighway = {};
  labelled.forEach((x, idx) => {
    const key = x.rec.highway;
    const row = byHighway[key] || { n: 0, positives: 0 };
    row.n += 1;
    row.positives += labels[idx];
    byHighway[key] = row;
  });
  for (const row of Object.values(byHighway)) row.positiveRate = row.positives / row.n;

  // Per road class (lamps visible): where the model beats or loses to the class-rate baseline.
  const classDetail = {};
  labelled.forEach((x, idx) => {
    const pred = predictions.visible[idx];
    const row = classDetail[x.rec.highway] || { n: 0, positives: 0, eff: 0, sqModel: 0, sqBase: 0 };
    row.n += 1;
    row.positives += labels[idx];
    row.eff += pred.effective;
    row.sqModel += (pred.effective - labels[idx]) ** 2;
    row.sqBase += (baseline.roadClass[idx] - labels[idx]) ** 2;
    classDetail[x.rec.highway] = row;
  });
  const visibleByHighway = {};
  for (const [highway, row] of Object.entries(classDetail)) {
    visibleByHighway[highway] = {
      n: row.n,
      positiveRate: row.positives / row.n,
      meanEffective: row.eff / row.n,
      brier: row.sqModel / row.n,
      baselineBrier: row.sqBase / row.n,
    };
  }

  const result = {
    n,
    k,
    seed,
    blockM,
    blocks: folds.size,
    positiveRate: labels.reduce((s, v) => s + v, 0) / n,
    byHighway,
    modes: {
      hidden: summariseMode(predictions.hidden, labels),
      visible: { ...summariseMode(predictions.visible, labels), byHighway: visibleByHighway },
    },
    baselines: {
      global: summarise(baseline.global, labels),
      roadClass: summarise(baseline.roadClass, labels),
      v1Rule: summarise(v1, labels),
    },
  };
  if (collectPredictions) result.predictions = predictions;
  return result;
}

module.exports = { runLeaveOut };

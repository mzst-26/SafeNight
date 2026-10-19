/**
 * thinning.js — Monotonicity check: removing street lamps must never raise the lighting estimate.
 *
 * Removing lamps lowers lampCount30m and area density. The absence penalty (isolated paths only) is the one
 * rule that depends on how many lamps the area has: when the density drops below its threshold the penalty
 * switches off and the estimate rises. Each rise is labelled with its cause.
 */

const { mulberry32, shuffleInPlace } = require('./spatial');
const { buildLampIndex, buildLitIndex, lightingFeatures, estimateLighting, areaKeyOf } = require('./features');

const RISE_EPS = 1e-12;

// The absence rule applies only to isolated paths. A rise is labelled 'absence-threshold' when the rule
// switched off between the two runs (the area density fell below its floor), which only those ways can show.
function causeOf(before, after, fBefore, fAfter) {
  if (after.effective <= before.effective + RISE_EPS) return null;
  if (fBefore.lampCount30m !== fAfter.lampCount30m) return 'lamp-count';
  if ((before.source === 'absence') !== (after.source === 'absence')) return 'absence-threshold';
  return 'other';
}

/**
 * @param {object} input
 * @param {Array} input.sample - records of the ways to check (lit=yes, labelled)
 * @param {Array<{lat: number, lng: number}>} input.lamps - all street lamps in the bbox
 * @param {Array} input.records - all way records; their lit=yes vertices form the lit index
 * @param {Map<string, number>} input.areaKm - walkable km per area cell
 * @param {object} [input.roadIndex] - road proximity index (footway geometry)
 * @param {number} [input.fraction=0.5] - share of lamps removed
 * @param {number} [input.seed=1]
 * @param {boolean} [input.hideTag=true] - hide the lit tag of the sampled ways (lamps then drive the estimate)
 */
function thinLampsAndCompare({ sample, lamps, records, areaKm, roadIndex, fraction = 0.5, seed = 1, hideTag = true }) {
  const sampleIds = new Set(sample.map((r) => r.id));
  const removeCount = Math.floor(lamps.length * fraction);
  const order = shuffleInPlace(Array.from(lamps.keys()), mulberry32(seed));
  const removed = new Set(order.slice(0, removeCount));
  const kept = lamps.filter((_, i) => !removed.has(i));
  const before = buildLampIndex(lamps);
  const after = buildLampIndex(kept);

  // With the tag hidden, the sampled ways' own lit vertices must not count as lamps (same leak as leaveout).
  const litVertices = [];
  for (const r of records) {
    if (!r.litVertices) continue;
    if (hideTag && sampleIds.has(r.id)) continue;
    litVertices.push(...r.litVertices);
  }
  const litIndex = buildLitIndex(litVertices);

  const perWay = sample.map((rec) => {
    const { midLat, midLng } = rec.anchor;
    const areaWayKm = areaKm.get(areaKeyOf(midLat, midLng)) || 0;
    const tags = hideTag ? { ...rec.tags, lit: undefined } : rec.tags;
    const fBefore = lightingFeatures({ anchor: rec.anchor, lampIndex: before, litIndex, roadIndex, areaWayKm });
    const fAfter = lightingFeatures({ anchor: rec.anchor, lampIndex: after, litIndex, roadIndex, areaWayKm });
    const eBefore = estimateLighting(tags, fBefore);
    const eAfter = estimateLighting(tags, fAfter);
    return {
      id: rec.id,
      highway: rec.highway,
      nearRoad: fBefore.nearRoad,
      lampCount30mBefore: fBefore.lampCount30m,
      lampCount30mAfter: fAfter.lampCount30m,
      densityBefore: fBefore.areaLampDensityPerKm,
      densityAfter: fAfter.areaLampDensityPerKm,
      sourceBefore: eBefore.source,
      sourceAfter: eAfter.source,
      effectiveBefore: eBefore.effective,
      effectiveAfter: eAfter.effective,
      delta: eAfter.effective - eBefore.effective,
      rose: eAfter.effective > eBefore.effective + RISE_EPS,
      cause: causeOf(eBefore, eAfter, fBefore, fAfter),
    };
  });

  const n = perWay.length;
  const withLamps = perWay.filter((w) => w.lampCount30mBefore >= 1);
  const roseByCause = { 'lamp-count': 0, 'absence-threshold': 0, other: 0 };
  for (const w of perWay) if (w.cause) roseByCause[w.cause]++;
  const roseByHighway = {};
  for (const w of perWay) if (w.rose) roseByHighway[w.highway] = (roseByHighway[w.highway] || 0) + 1;
  const roseCount = perWay.filter((w) => w.rose).length;
  return {
    perWay,
    summary: {
      n,
      hideTag,
      lampsTotal: lamps.length,
      lampsRemoved: removeCount,
      withLampsBefore: withLamps.length,
      meanDelta: perWay.reduce((s, w) => s + w.delta, 0) / n,
      meanDeltaWithLamps: withLamps.length
        ? withLamps.reduce((s, w) => s + w.delta, 0) / withLamps.length
        : null,
      roseCount,
      roseFraction: n ? roseCount / n : null,
      roseByCause,
      roseByHighway,
    },
  };
}

module.exports = { thinLampsAndCompare };

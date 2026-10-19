/**
 * records.js — Per-way records and the tag-presence tally used by the eval scripts.
 */

const path = require('path');
const { segmentsOf, anchorOf } = require('./features');

const { WALKABLE_HIGHWAYS } = require(path.join(__dirname, '..', '..', '..', 'src', 'safety', 'services', 'safetyGraph'));

/**
 * @param {{id: number, tags?: object, coords?: Array<[number, number]>}} way - a way line from uk-roads.jsonl
 * @returns {{id, highway, tags, lit, walkable, segments, anchor, litVertices}}
 *   lit is trimmed and lower-cased (undefined when absent or empty). litVertices is set only for lit=yes.
 */
function buildWayRecord(way) {
  const tags = way.tags || {};
  const coords = Array.isArray(way.coords) ? way.coords : [];
  const raw = tags.lit === undefined ? undefined : String(tags.lit).trim().toLowerCase();
  const lit = raw === '' ? undefined : raw;
  const segments = segmentsOf(coords);
  return {
    id: way.id,
    highway: tags.highway,
    tags,
    lit,
    walkable: WALKABLE_HIGHWAYS.has(tags.highway),
    segments,
    anchor: anchorOf(segments),
    litVertices: lit === 'yes' ? coords.map(([lng, lat]) => ({ lat, lng })) : null,
  };
}

/** A labelled way is a walkable way with a segment and an explicit lit=yes or lit=no tag. */
function isLabelled(rec) {
  return rec.walkable && rec.anchor !== null && (rec.lit === 'yes' || rec.lit === 'no');
}

function createTally() {
  return { walkableWays: 0, withLitTag: 0, labelledWays: 0, litValueCounts: {}, byHighway: {} };
}

/** Add one way to the tally. Only walkable ways count. */
function tallyRecord(tally, rec) {
  if (!rec.walkable) return;
  tally.walkableWays += 1;
  const classRow = tally.byHighway[rec.highway] || { walkable: 0, labelled: 0 };
  classRow.walkable += 1;
  if (rec.lit !== undefined) {
    tally.withLitTag += 1;
    tally.litValueCounts[rec.lit] = (tally.litValueCounts[rec.lit] || 0) + 1;
  }
  if (isLabelled(rec)) {
    tally.labelledWays += 1;
    classRow.labelled += 1;
  }
  tally.byHighway[rec.highway] = classRow;
}

function summariseTally(tally) {
  const byHighway = {};
  for (const [key, row] of Object.entries(tally.byHighway)) {
    byHighway[key] = { ...row, labelledShare: row.walkable ? row.labelled / row.walkable : null };
  }
  return {
    walkableWays: tally.walkableWays,
    withLitTag: tally.withLitTag,
    litTagShare: tally.walkableWays ? tally.withLitTag / tally.walkableWays : null,
    labelledWays: tally.labelledWays,
    labelledShare: tally.walkableWays ? tally.labelledWays / tally.walkableWays : null,
    litValueCounts: { ...tally.litValueCounts },
    byHighway,
  };
}

module.exports = { buildWayRecord, isLabelled, createTally, tallyRecord, summariseTally };

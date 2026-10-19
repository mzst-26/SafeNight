/**
 * report.js — Plain-text tables for the eval scripts. Pure: takes result objects, returns strings.
 */

const fmt = (value, digits = 4) => (value === null || value === undefined || Number.isNaN(value)
  ? '-'
  : Number(value).toFixed(digits));

/** Left-align the first column and right-align the rest, padded to the widest cell of each column. */
function table(headers, rows) {
  const all = [headers, ...rows];
  const widths = headers.map((_, c) => Math.max(...all.map((r) => String(r[c]).length)));
  const line = (row) => row.map((cell, c) => (c === 0
    ? String(cell).padEnd(widths[c])
    : String(cell).padStart(widths[c]))).join('  ');
  return [line(headers), widths.map((w) => '-'.repeat(w)).join('  '), ...rows.map(line)].join('\n');
}

function metricRow(name, s) {
  return [name, s.n, fmt(s.brier), fmt(s.logLoss), fmt(s.ece), fmt(s.auc), fmt(s.accuracy)];
}

const METRIC_HEADERS = ['model', 'n', 'Brier', 'LogLoss', 'ECE', 'AUC', 'Acc@0.5'];

/** Full leave-out report: metrics against baselines, calibration, sources and tag presence. */
function formatLeaveOut(output) {
  const { result, tagPresence, bbox, stats } = output;
  const lines = [];
  lines.push(`lighting leave-out, bbox ${bbox.name} (${bbox.south}, ${bbox.west}, ${bbox.north}, ${bbox.east})`);
  lines.push(`labelled ways scored: ${result.n}  positive rate: ${fmt(result.positiveRate)}  folds: ${result.k}  blocks: ${result.blocks}  block: ${result.blockM} m  seed: ${result.seed}`);
  lines.push(`lamps in bbox: ${stats.lamps}  road lines read: ${stats.roadLines}`);
  lines.push('');
  lines.push('Tag presence (walkable ways in bbox, before any hiding):');
  lines.push(`  walkable ways: ${tagPresence.walkableWays}  with any lit tag: ${tagPresence.withLitTag} (${fmt(tagPresence.litTagShare, 3)})  labelled yes/no: ${tagPresence.labelledWays} (${fmt(tagPresence.labelledShare, 3)})`);
  lines.push(`  lit values: ${JSON.stringify(tagPresence.litValueCounts)}`);
  lines.push('');
  const rows = [
    metricRow('inferLighting effectiveLit, lamps hidden', result.modes.hidden.effective),
    metricRow('inferLighting pLit (raw), lamps hidden', result.modes.hidden.pLit),
    metricRow('inferLighting effectiveLit, lamps visible', result.modes.visible.effective),
    metricRow('inferLighting pLit (raw), lamps visible', result.modes.visible.pLit),
    metricRow('baseline: global base rate', result.baselines.global),
    metricRow('baseline: road class rate', result.baselines.roadClass),
    metricRow('baseline: old v1 rule (hidden tag -> 0)', result.baselines.v1Rule),
  ];
  lines.push(table(METRIC_HEADERS, rows));
  lines.push('');
  lines.push('Calibration, effectiveLit, lamps hidden (populated bins):');
  const calRows = result.modes.hidden.effective.calibration.map((b) => [
    `[${fmt(b.lo, 1)}, ${fmt(b.hi, 1)})`, b.n, fmt(b.meanPred), fmt(b.observed),
  ]);
  lines.push(table(['bin', 'n', 'mean pred', 'observed'], calRows));
  lines.push('');
  lines.push('By source (lamps hidden):');
  const srcRows = Object.entries(result.modes.hidden.bySource).map(([source, s]) => [
    source, s.n, fmt(s.positiveRate), fmt(s.meanEffective), fmt(s.brier),
  ]);
  lines.push(table(['source', 'n', 'observed rate', 'mean effective', 'Brier'], srcRows));
  if (result.modes.visible.byHighway) {
    lines.push('');
    lines.push('By road class (lamps visible): model vs road-class baseline, Brier');
    const classRows = Object.entries(result.modes.visible.byHighway)
      .sort((a, b) => b[1].n - a[1].n)
      .map(([highway, c]) => [highway, c.n, fmt(c.positiveRate, 3), fmt(c.meanEffective, 3), fmt(c.brier), fmt(c.baselineBrier)]);
    lines.push(table(['class', 'n', 'observed', 'mean model', 'Brier model', 'Brier class-rate'], classRows));
  }
  return lines.join('\n');
}

/** Thinning report for one run (tag visible or hidden). */
function formatThinning(label, summary) {
  const pct = (v) => (v === null ? '-' : `${(100 * v).toFixed(2)}%`);
  return [
    `${label}`,
    `  ways checked: ${summary.n} (with lamps before thinning: ${summary.withLampsBefore})`,
    `  lamps removed: ${summary.lampsRemoved} of ${summary.lampsTotal}`,
    `  mean change in effectiveLit: ${fmt(summary.meanDelta, 5)}  (with lamps: ${fmt(summary.meanDeltaWithLamps, 5)})`,
    `  ROSE after removing lamps: ${summary.roseCount} (${pct(summary.roseFraction)})  causes: ${JSON.stringify(summary.roseByCause)}`,
    `  rises by road class: ${JSON.stringify(summary.roseByHighway || {})}`,
  ].join('\n');
}

module.exports = { formatLeaveOut, formatThinning, table, fmt };

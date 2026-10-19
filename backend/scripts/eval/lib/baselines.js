/**
 * baselines.js — Simple predictors that the lighting inference has to beat.
 *
 * All baselines are fitted on training folds only. A row never affects its own prediction.
 */

/**
 * @param {number[]} labels - 0/1
 * @returns {number} fraction of positives, or NaN for no labels
 */
function globalRate(labels) {
  if (labels.length === 0) return NaN;
  return labels.reduce((sum, y) => sum + y, 0) / labels.length;
}

/**
 * Empirical positive rate per highway class.
 * @param {Array<{highway: string|undefined, label: number}>} rows - training rows
 * @returns {Map<string, number>} classes absent from rows are absent from the map
 */
function classRates(rows) {
  const counts = new Map();
  for (const { highway, label } of rows) {
    const key = highway ?? '(none)';
    const entry = counts.get(key) || { n: 0, pos: 0 };
    entry.n += 1;
    entry.pos += label;
    counts.set(key, entry);
  }
  const rates = new Map();
  for (const [key, { n, pos }] of counts) rates.set(key, pos / n);
  return rates;
}

/**
 * Out-of-fold predictions for two baselines. Each row is predicted from rows in other folds.
 * @param {Array<{highway: string|undefined, label: number, fold: number}>} rows
 * @returns {{global: number[], roadClass: number[]}} aligned with rows
 */
function outOfFoldBaselines(rows) {
  const folds = [...new Set(rows.map((r) => r.fold))];
  const global = new Array(rows.length);
  const roadClass = new Array(rows.length);
  for (const fold of folds) {
    const training = rows.filter((r) => r.fold !== fold);
    const rate = globalRate(training.map((r) => r.label));
    const rates = classRates(training);
    rows.forEach((row, i) => {
      if (row.fold !== fold) return;
      global[i] = rate;
      const key = row.highway ?? '(none)';
      roadClass[i] = rates.has(key) ? rates.get(key) : rate;
    });
  }
  return { global, roadClass };
}

/**
 * The old v1 rule: an explicit lit=yes tag means lit, anything else means unlit.
 * With the lit tag hidden for held-out ways this predicts 0 for all of them.
 * @param {string|undefined} litTag
 * @returns {0|1}
 */
function v1LitRule(litTag) {
  return litTag === 'yes' ? 1 : 0;
}

module.exports = {
  globalRate,
  classRates,
  outOfFoldBaselines,
  v1LitRule,
};

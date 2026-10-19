/**
 * metrics.js — Scoring rules and calibration summaries for probabilistic predictions.
 *
 * Pure functions. Predictions are probabilities in [0, 1]; labels are 0 or 1.
 */

const LOG_LOSS_EPS = 1e-6;

function assertPairs(predictions, labels) {
  if (!Array.isArray(predictions) || !Array.isArray(labels)) {
    throw new TypeError('predictions and labels must be arrays');
  }
  if (predictions.length !== labels.length) {
    throw new TypeError('predictions and labels must have the same length');
  }
  if (predictions.length === 0) {
    throw new TypeError('at least one prediction is required');
  }
}

/**
 * Mean squared error between probability and 0/1 outcome. Lower is better; 0.25 is a constant 0.5.
 * @param {number[]} predictions
 * @param {number[]} labels
 * @returns {number}
 */
function brierScore(predictions, labels) {
  assertPairs(predictions, labels);
  let total = 0;
  for (let i = 0; i < predictions.length; i++) {
    const diff = predictions[i] - labels[i];
    total += diff * diff;
  }
  return total / predictions.length;
}

/**
 * Mean negative log-likelihood. Probabilities are clipped to [eps, 1 - eps] so a hard 0 or 1 cannot give infinity.
 * @param {number[]} predictions
 * @param {number[]} labels
 * @param {number} [eps=1e-6]
 * @returns {number}
 */
function logLoss(predictions, labels, eps = LOG_LOSS_EPS) {
  assertPairs(predictions, labels);
  let total = 0;
  for (let i = 0; i < predictions.length; i++) {
    const p = Math.min(1 - eps, Math.max(eps, predictions[i]));
    total += labels[i] === 1 ? -Math.log(p) : -Math.log(1 - p);
  }
  return total / predictions.length;
}

/**
 * Expected calibration error over equal-width probability bins. A prediction of exactly 1 goes in the last bin.
 * @param {number[]} predictions
 * @param {number[]} labels
 * @param {number} [bins=10]
 * @returns {{ece: number, table: Array<{lo: number, hi: number, n: number, meanPred: number, observed: number}>}}
 *   table lists populated bins only.
 */
function expectedCalibrationError(predictions, labels, bins = 10) {
  assertPairs(predictions, labels);
  const sums = Array.from({ length: bins }, () => ({ n: 0, pred: 0, pos: 0 }));
  for (let i = 0; i < predictions.length; i++) {
    const idx = Math.min(bins - 1, Math.floor(predictions[i] * bins));
    sums[idx].n += 1;
    sums[idx].pred += predictions[i];
    sums[idx].pos += labels[i];
  }
  const total = predictions.length;
  let ece = 0;
  const table = [];
  sums.forEach((bin, idx) => {
    if (bin.n === 0) return;
    const meanPred = bin.pred / bin.n;
    const observed = bin.pos / bin.n;
    ece += (bin.n / total) * Math.abs(meanPred - observed);
    table.push({ lo: idx / bins, hi: (idx + 1) / bins, n: bin.n, meanPred, observed });
  });
  return { ece, table };
}

/**
 * Area under the ROC curve via the Mann-Whitney U statistic, with tied scores given half credit.
 * @param {number[]} scores
 * @param {number[]} labels
 * @returns {number|null} null when only one class is present
 */
function auc(scores, labels) {
  assertPairs(scores, labels);
  const order = scores.map((score, i) => ({ score, label: labels[i] }))
    .sort((a, b) => a.score - b.score);
  let positives = 0;
  let negatives = 0;
  let rankSumPositives = 0;
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1].score === order[i].score) j++;
    const averageRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) {
      if (order[k].label === 1) {
        positives++;
        rankSumPositives += averageRank;
      } else {
        negatives++;
      }
    }
    i = j + 1;
  }
  if (positives === 0 || negatives === 0) return null;
  return (rankSumPositives - (positives * (positives + 1)) / 2) / (positives * negatives);
}

/**
 * Share of predictions on the correct side of the threshold (p >= threshold counts as lit).
 * @param {number[]} predictions
 * @param {number[]} labels
 * @param {number} [threshold=0.5]
 * @returns {number}
 */
function accuracyAt(predictions, labels, threshold = 0.5) {
  assertPairs(predictions, labels);
  let correct = 0;
  for (let i = 0; i < predictions.length; i++) {
    const predicted = predictions[i] >= threshold ? 1 : 0;
    if (predicted === labels[i]) correct++;
  }
  return correct / predictions.length;
}

/**
 * All headline metrics for one set of predictions.
 * @param {number[]} predictions
 * @param {number[]} labels
 * @param {number} [bins=10]
 */
function summarise(predictions, labels, bins = 10) {
  const { ece, table } = expectedCalibrationError(predictions, labels, bins);
  const positives = labels.reduce((sum, y) => sum + y, 0);
  return {
    n: predictions.length,
    positiveRate: positives / labels.length,
    meanPrediction: predictions.reduce((sum, p) => sum + p, 0) / predictions.length,
    brier: brierScore(predictions, labels),
    logLoss: logLoss(predictions, labels),
    ece,
    auc: auc(predictions, labels),
    accuracy: accuracyAt(predictions, labels),
    calibration: table,
  };
}

module.exports = {
  brierScore,
  logLoss,
  expectedCalibrationError,
  auc,
  accuracyAt,
  summarise,
};

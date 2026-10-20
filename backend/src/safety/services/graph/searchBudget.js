/**
 * Expansion budget and error for the A* searches. One budget is shared by all candidate searches of one
 * findKSafestRoutes call, so the cost of the call is bounded as a whole.
 */
const { SEARCH } = require('../../scoring/config');

const MAX_ASTAR_EXPANSIONS = SEARCH.MAX_ASTAR_EXPANSIONS;

/** Error for a trip too long to search: reported as NO_ROUTE_FOUND (404), the same answer as no path. */
function createRouteBudgetError() {
  return Object.assign(
    new Error('This trip is too long to search in one go. Try a closer destination or a smaller detour.'),
    { statusCode: 404, code: 'NO_ROUTE_FOUND' },
  );
}

/**
 * Shared counters for one search.
 * @param {{maxExpansions?: number, shouldCancel?: Function}} [options]
 * @returns {{maxExpansions: number, shouldCancel: Function|null, pops: number, expansions: number}}
 */
function createSearchBudget(options = {}) {
  return {
    maxExpansions: Number.isFinite(options.maxExpansions) ? options.maxExpansions : MAX_ASTAR_EXPANSIONS,
    shouldCancel: typeof options.shouldCancel === 'function' ? options.shouldCancel : null,
    pops: 0,
    expansions: 0,
  };
}

module.exports = { MAX_ASTAR_EXPANSIONS, createRouteBudgetError, createSearchBudget };

const path = require('path');
const budget = require(path.resolve(__dirname, '../../../../../src/safety/services/graph/searchBudget'));

describe('graph/searchBudget', () => {
  test('MAX_ASTAR_EXPANSIONS is 3,000,000', () => {
    expect(budget.MAX_ASTAR_EXPANSIONS).toBe(3_000_000);
  });

  test('createSearchBudget defaults and overrides', () => {
    expect(budget.createSearchBudget()).toEqual({ maxExpansions: 3_000_000, shouldCancel: null, pops: 0, expansions: 0 });
    const fn = () => false;
    expect(budget.createSearchBudget({ maxExpansions: 10, shouldCancel: fn })).toMatchObject({ maxExpansions: 10, shouldCancel: fn });
    expect(budget.createSearchBudget({ maxExpansions: NaN, shouldCancel: 'x' })).toMatchObject({ maxExpansions: 3_000_000, shouldCancel: null });
    expect(budget.createSearchBudget({ maxExpansions: Infinity }).maxExpansions).toBe(3_000_000);
  });

  test('each budget has its own counters', () => {
    const a = budget.createSearchBudget();
    a.pops = 5;
    expect(budget.createSearchBudget().pops).toBe(0);
  });

  test('the budget error is a 404 NO_ROUTE_FOUND with a user-facing message', () => {
    const err = budget.createRouteBudgetError();
    expect(err).toBeInstanceOf(Error);
    expect(err).toMatchObject({ code: 'NO_ROUTE_FOUND', statusCode: 404 });
    expect(err.message).toMatch(/too long/);
  });
});

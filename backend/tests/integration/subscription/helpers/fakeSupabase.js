/**
 * fakeSupabase.js — Minimal chainable Supabase query-builder fake for tests.
 *
 * Every query is recorded as { table, op, payload, filters, select } in
 * `calls`. The `resolve(query)` callback decides what { data, error } each
 * query returns. No network access.
 */

function createFakeSupabase(resolve = () => ({ data: null, error: null })) {
  const calls = [];

  function from(table) {
    const query = { table, op: 'select', payload: null, filters: [], select: null, terminal: null };

    const finish = (terminal) => {
      query.terminal = terminal;
      calls.push(query);
      const result = resolve(query) || { data: null, error: null };
      return Promise.resolve({ data: null, error: null, count: null, ...result });
    };

    const builder = {
      select(cols) {
        if (query.op === 'select') query.select = cols;
        else query.returning = cols;
        return builder;
      },
      insert(payload) { query.op = 'insert'; query.payload = payload; return builder; },
      update(payload) { query.op = 'update'; query.payload = payload; return builder; },
      delete() { query.op = 'delete'; return builder; },
      single: () => finish('single'),
      maybeSingle: () => finish('maybeSingle'),
      then(onFulfilled, onRejected) { return finish('many').then(onFulfilled, onRejected); },
    };

    for (const name of ['eq', 'neq', 'in', 'lt', 'gt', 'lte', 'gte', 'or', 'order', 'limit', 'is']) {
      builder[name] = (...args) => { query.filters.push([name, ...args]); return builder; };
    }

    return builder;
  }

  return { supabase: { from }, calls };
}

function hasFilter(query, op, column, value) {
  return query.filters.some((f) => f[0] === op && f[1] === column && (value === undefined || f[2] === value));
}

module.exports = { createFakeSupabase, hasFilter };

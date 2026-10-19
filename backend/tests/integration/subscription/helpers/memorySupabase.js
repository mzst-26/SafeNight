/**
 * memorySupabase.js — Stateful in-memory Supabase fake for idempotency tests.
 *
 * Supports the query-builder subset used by the webhook and family code:
 * select / insert / update / delete with eq, neq, in, lt, gt, limit, order,
 * or (ignored — matches all), and single / maybeSingle / thenable terminals.
 */

function createMemorySupabase(initial = {}) {
  const tables = {};
  for (const [name, rows] of Object.entries(initial)) tables[name] = rows.map((r) => ({ ...r }));
  let nextId = 1;

  const table = (name) => (tables[name] = tables[name] || []);

  function matches(row, filters) {
    return filters.every(([op, col, val]) => {
      switch (op) {
        case 'eq': return row[col] === val;
        case 'neq': return row[col] !== val;
        case 'in': return val.includes(row[col]);
        case 'lt': return row[col] != null && row[col] < val;
        case 'gt': return row[col] != null && row[col] > val;
        default: return true; // limit, order, or, etc.
      }
    });
  }

  function from(name) {
    const q = { op: 'select', payload: null, filters: [] };

    const run = (terminal) => {
      const rows = table(name);
      let data;
      if (q.op === 'insert') {
        const items = (Array.isArray(q.payload) ? q.payload : [q.payload]).map((r) => ({ id: `row-${nextId++}`, ...r }));
        rows.push(...items);
        data = items;
      } else if (q.op === 'update') {
        data = rows.filter((r) => matches(r, q.filters));
        data.forEach((r) => Object.assign(r, q.payload));
        data = data.map((r) => ({ ...r }));
      } else if (q.op === 'delete') {
        const keep = rows.filter((r) => !matches(r, q.filters));
        data = rows.filter((r) => matches(r, q.filters));
        tables[name] = keep;
      } else {
        data = rows.filter((r) => matches(r, q.filters)).map((r) => ({ ...r }));
      }
      if (terminal === 'single' || terminal === 'maybeSingle') {
        data = data[0] || null;
      }
      return Promise.resolve({ data, error: null, count: Array.isArray(data) ? data.length : null });
    };

    const b = {
      select() { return b; },
      insert(p) { q.op = 'insert'; q.payload = p; return b; },
      update(p) { q.op = 'update'; q.payload = p; return b; },
      delete() { q.op = 'delete'; return b; },
      single: () => run('single'),
      maybeSingle: () => run('maybeSingle'),
      then(res, rej) { return run('many').then(res, rej); },
    };
    for (const op of ['eq', 'neq', 'in', 'lt', 'gt', 'lte', 'gte', 'or', 'order', 'limit', 'is']) {
      b[op] = (...args) => { q.filters.push([op, ...args]); return b; };
    }
    return b;
  }

  return { supabase: { from }, tables, table };
}

module.exports = { createMemorySupabase };

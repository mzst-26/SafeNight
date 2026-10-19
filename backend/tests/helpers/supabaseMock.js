/**
 * Minimal chainable Supabase query-builder mock.
 *
 * createSupabaseMock(resolver) returns { supabase, calls }.
 * Every builder method is recorded; when the query is awaited (or
 * .single()/.maybeSingle() is called) the resolver gets
 * { table, ops } and returns { data, error } (or a promise of it).
 */
function createSupabaseMock(resolver) {
  const calls = [];

  function from(table) {
    const query = { table, ops: [] };
    calls.push(query);

    const resolve = () => Promise.resolve(resolver(query) || { data: null, error: null });

    const builder = new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === 'then') {
            return (onFulfilled, onRejected) => resolve().then(onFulfilled, onRejected);
          }
          if (prop === 'single' || prop === 'maybeSingle') {
            return () => {
              query.ops.push({ op: prop, args: [] });
              return resolve();
            };
          }
          return (...args) => {
            query.ops.push({ op: prop, args });
            return builder;
          };
        },
      },
    );
    return builder;
  }

  const supabase = { from: jest.fn(from), rpc: jest.fn(async () => ({ data: null, error: null })) };
  return { supabase, calls };
}

/** Find the first op of a given name in a recorded query. */
function opOf(query, name) {
  return query.ops.find((o) => o.op === name);
}

module.exports = { createSupabaseMock, opOf };

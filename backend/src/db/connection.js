// PostgreSQL connection pool, wrapped with a thin async shim that keeps the
// call-site ergonomics of the previous better-sqlite3 code (db.get/all/run,
// '?' positional placeholders) so routes/services didn't need a full
// rewrite of their SQL, only `await` added at each call site.
const { Pool, types } = require('pg');

// node-postgres returns BIGINT (OID 20) as a string by default, to avoid
// silent precision loss above Number.MAX_SAFE_INTEGER. Every COUNT(*) and
// SUM() over an INTEGER column in this app comes back as bigint, and none
// of those values can realistically exceed 2^53, so parse them as regular
// JS numbers - otherwise totals/counts render as quoted strings in JSON
// ("1" instead of 1), which breaks strict frontend comparisons and charts.
types.setTypeParser(20, (val) => (val === null ? null : parseInt(val, 10)));

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    'DATABASE_URL não definido. Configure a string de conexão do PostgreSQL em backend/.env (veja .env.example).'
  );
}

// Render (and most managed Postgres providers) require SSL, but a local
// dev/test Postgres on localhost usually doesn't have a cert configured.
const useSSL = process.env.PGSSLMODE !== 'disable' && !/localhost|127\.0\.0\.1/.test(connectionString);

const pool = new Pool({
  connectionString,
  ssl: useSSL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  // A backend connection was idle and errored out (e.g. network blip) -
  // pg already drops it from the pool; just log so it's visible.
  console.error('[db] unexpected error on idle Postgres client', err);
});

/** Converts '?' positional placeholders (used throughout this codebase, a leftover from the original SQLite version) to Postgres's '$1, $2, ...'. */
function toPgSql(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

function makeExecutor(queryFn) {
  return {
    /** Returns all matching rows. */
    async all(sql, ...params) {
      const res = await queryFn(toPgSql(sql), params);
      return res.rows;
    },
    /** Returns the first matching row, or undefined. */
    async get(sql, ...params) {
      const res = await queryFn(toPgSql(sql), params);
      return res.rows[0];
    },
    /** For INSERT/UPDATE/DELETE. Add `RETURNING id` to the SQL to get `lastInsertRowid`. */
    async run(sql, ...params) {
      const res = await queryFn(toPgSql(sql), params);
      return { changes: res.rowCount, rows: res.rows, lastInsertRowid: res.rows[0]?.id };
    },
    /** Runs a raw (possibly multi-statement) SQL string with no parameters - used for migrations. */
    async exec(sql) {
      await queryFn(sql);
    },
  };
}

const db = makeExecutor((sql, params) => pool.query(sql, params));

/**
 * Runs `fn(tx)` inside one Postgres transaction (BEGIN/COMMIT/ROLLBACK on a
 * single dedicated client). `tx` exposes the same get/all/run/exec surface
 * as `db`, bound to that client so every call participates in the same
 * transaction. Mirrors better-sqlite3's synchronous `db.transaction(fn)`,
 * but async, e.g.:
 *
 *   await db.transaction(async (tx) => {
 *     await tx.run('INSERT INTO ...', a, b);
 *     await tx.run('UPDATE ...', c);
 *   });
 */
async function transaction(fn) {
  const client = await pool.connect();
  const tx = makeExecutor((sql, params) => client.query(sql, params));
  try {
    await client.query('BEGIN');
    const result = await fn(tx);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { ...db, transaction, pool };

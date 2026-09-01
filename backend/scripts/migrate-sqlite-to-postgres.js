#!/usr/bin/env node
// ============================================================================
// ONE-TIME data migration: copies every real record from the old local
// SQLite database (created by earlier runs of `Iniciar Sistema.bat`) into
// the new shared PostgreSQL database used by both the web deployment and
// the local desktop shortcut.
//
// - Preserves every primary key exactly as it was (uuid on `actions`,
//   integer `id` elsewhere) so nothing already referencing those ids
//   (audit log, comments, attachments, time entries...) breaks.
// - After copying, resets every PostgreSQL SERIAL sequence so the next
//   INSERT after migration continues from the right number instead of
//   colliding with a migrated id.
// - Uses `ON CONFLICT ... DO NOTHING`, so it's safe to run twice: rows
//   already present (matched by primary/unique key) are left untouched,
//   nothing is ever overwritten.
// - Runs inside a single transaction: if anything fails partway through,
//   nothing is committed and it's safe to fix the issue and re-run.
// - `password_reset_tokens` and `sessions` are intentionally NOT migrated:
//   both are short-lived security tokens tied to the old JWT_SECRET/host,
//   which the security checklist has you rotate anyway before going live.
//
// Usage:
//   node scripts/migrate-sqlite-to-postgres.js [caminho/para/projetos.db]
//
// Requires:
//   - DATABASE_URL pointing at the TARGET Postgres database (already
//     migrated with `npm run migrate` — schema must exist, but should be
//     otherwise empty; run this BEFORE `npm run seed`).
//   - `better-sqlite3` installed (`npm install --no-save better-sqlite3`)
//     — it's not a normal dependency of this app any more (Postgres is),
//     so add it temporarily just to run this one-time script.
// ============================================================================

require('dotenv').config();
const path = require('path');
const db = require('../src/db/connection');

const DEFAULT_SOURCE = 'C:\\Users\\ivoal\\AppData\\Local\\SistemaGestaoProjetos\\backend\\data\\projetos.db';
const SOURCE_FILE = process.argv[2] || DEFAULT_SOURCE;

// Migration order matters: a row can only be inserted after the rows it
// references via foreign key already exist.
const TABLES = [
  { name: 'roles', conflict: ['id'] },
  { name: 'permissions', conflict: ['id'] },
  { name: 'role_permissions', conflict: ['role_id', 'permission_id'] },
  { name: 'users', conflict: ['id'] },
  { name: 'projects', conflict: ['id'] },
  { name: 'areas', conflict: ['id'] },
  { name: 'people', conflict: ['id'] },
  { name: 'user_project_scope', conflict: ['user_id', 'project_id'] },
  { name: 'user_area_scope', conflict: ['user_id', 'area_id'] },
  { name: 'actions', conflict: ['uuid'] },
  { name: 'time_entries', conflict: ['id'] },
  { name: 'comments', conflict: ['id'] },
  { name: 'attachments', conflict: ['id'] },
  { name: 'audit_log', conflict: ['id'] },
  { name: 'import_batches', conflict: ['id'] },
  { name: 'saved_views', conflict: ['id'] },
  // Intentionally NOT migrated: password_reset_tokens, sessions (see header).
];

// Tables whose `id` column is a Postgres SERIAL and needs its sequence
// fast-forwarded past the highest migrated id.
const SERIAL_TABLES = [
  'roles', 'permissions', 'users', 'projects', 'areas', 'people',
  'time_entries', 'comments', 'attachments', 'audit_log', 'import_batches', 'saved_views',
];

function openSqlite(file) {
  let Database;
  try {
    Database = require('better-sqlite3');
  } catch (err) {
    console.error('[migrate-data] O pacote "better-sqlite3" não está instalado.');
    console.error('[migrate-data] Instale temporariamente com: npm install --no-save better-sqlite3');
    process.exit(1);
  }
  return new Database(file, { readonly: true, fileMustExist: true });
}

async function main() {
  console.log(`[migrate-data] Origem (SQLite): ${SOURCE_FILE}`);
  const sqlite = openSqlite(SOURCE_FILE);

  // Fetch every table's Postgres column list up front, using the plain pool
  // (not the transaction client) - doing this lazily *inside* the
  // transaction below interleaves pool.query() calls with the dedicated
  // transaction client and can drop the connection.
  const pgColumnsByTable = {};
  for (const { name: table } of TABLES) {
    const rows = await db.all(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ? ORDER BY ordinal_position`,
      table
    );
    pgColumnsByTable[table] = rows.map((r) => r.column_name);
  }

  const summary = {};

  await db.transaction(async (tx) => {
    for (const { name: table, conflict } of TABLES) {
      const sourceRows = sqlite.prepare(`SELECT * FROM ${table}`).all();
      if (!sourceRows.length) {
        summary[table] = { source: 0, inserted: 0 };
        continue;
      }

      const targetCols = pgColumnsByTable[table];
      const sourceCols = Object.keys(sourceRows[0]);
      const cols = sourceCols.filter((c) => targetCols.includes(c));
      if (!cols.length) throw new Error(`[migrate-data] Nenhuma coluna em comum entre SQLite e Postgres para "${table}".`);

      const placeholders = cols.map(() => '?').join(', ');
      const conflictCols = conflict.join(', ');
      const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders}) ON CONFLICT (${conflictCols}) DO NOTHING`;

      let inserted = 0;
      for (const row of sourceRows) {
        const values = cols.map((c) => row[c]);
        const res = await tx.run(sql, ...values);
        inserted += res.changes || 0;
      }
      summary[table] = { source: sourceRows.length, inserted };
      console.log(`[migrate-data] ${table}: ${inserted}/${sourceRows.length} linhas migradas`);
    }

    for (const table of SERIAL_TABLES) {
      await tx.run(
        `SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE((SELECT MAX(id) FROM ${table}), 1), (SELECT COUNT(*) FROM ${table}) > 0)`
      );
    }
  });

  sqlite.close();

  console.log('[migrate-data] ===== Resumo =====');
  for (const [table, s] of Object.entries(summary)) {
    console.log(`[migrate-data]   ${table.padEnd(20)} origem=${s.source}  inseridas=${s.inserted}`);
  }
  console.log('[migrate-data] Concluído. password_reset_tokens e sessions NÃO foram migrados (tokens de segurança expiráveis).');
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[migrate-data] Erro fatal:', err);
      process.exit(1);
    });
}

module.exports = { main };

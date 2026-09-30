#!/usr/bin/env node
// ============================================================================
// ONE-TIME export: dumps every real row from the LOCAL PostgreSQL database
// (the "ambiente de teste/melhoria" running on this computer, already
// populated with a full copy of the original data) into a single JSON file,
// in the exact { tables: { ... } } shape the production "/api/admin/migrate-data"
// endpoint expects.
//
// This does NOT touch production. It only reads from the database pointed
// to by this computer's backend/.env (DATABASE_URL) and writes a JSON file.
// A separate script (enviar-dados-para-producao.ps1) POSTs that file to
// production.
//
// Usage:
//   node scripts/export-postgres-to-json.js [caminho/de/saida.json]
// ============================================================================

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('../src/db/connection');

const OUT_FILE = process.argv[2] || path.join(__dirname, '..', 'data', 'export-producao.json');

// Same order used by migrate-sqlite-to-postgres.js: a row can only be
// inserted after the rows it references via foreign key already exist.
const TABLES = [
  'roles',
  'permissions',
  'role_permissions',
  'users',
  'projects',
  'areas',
  'people',
  'user_project_scope',
  'user_area_scope',
  'actions',
  'time_entries',
  'comments',
  'attachments',
  'audit_log',
  'import_batches',
  'saved_views',
];

async function main() {
  console.log(`[export] Lendo do banco local (DATABASE_URL=${(process.env.DATABASE_URL || '').replace(/:[^:@]*@/, ':***@')})`);

  const dump = { tables: {}, resetAccessControl: true };
  for (const table of TABLES) {
    const rows = await db.all(`SELECT * FROM ${table}`);
    dump.tables[table] = rows;
    console.log(`[export] ${table.padEnd(20)} ${rows.length} linha(s)`);
  }

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(dump), 'utf8');

  const sizeKb = (fs.statSync(OUT_FILE).size / 1024).toFixed(1);
  console.log(`[export] Concluído. Arquivo: ${OUT_FILE} (${sizeKb} KB)`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[export] Erro fatal:', err);
    process.exit(1);
  });

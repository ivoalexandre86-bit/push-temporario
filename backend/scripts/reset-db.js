#!/usr/bin/env node
// ============================================================================
// DANGER: wipes ALL application data from the shared Postgres database so
// `npm run setup` can re-seed from a clean slate.
//
// The system now uses a single shared Postgres database for both the web
// deployment and the local desktop shortcut (Iniciar Sistema.bat) — there
// is no more local SQLite file to simply delete. Because this could destroy
// real production data, this script refuses to run unless invoked with the
// explicit --force flag AND the CONFIRM_RESET environment variable set to
// the exact string "SIM".
//
// Usage: CONFIRM_RESET=SIM node scripts/reset-db.js --force
// ============================================================================

require('dotenv').config();
const db = require('../src/db/connection');

const TABLES = [
  'audit_log', 'import_batches', 'attachments', 'comments', 'time_entries',
  'saved_views', 'actions', 'people', 'user_area_scope', 'user_project_scope',
  'areas', 'projects', 'sessions', 'password_reset_tokens', 'users',
  'role_permissions', 'permissions', 'roles',
];

async function run() {
  const forced = process.argv.includes('--force');
  if (!forced || process.env.CONFIRM_RESET !== 'SIM') {
    console.error('[reset] Recusado. Este comando apaga TODOS os dados do banco Postgres compartilhado (web + notebook).');
    console.error('[reset] Para confirmar, execute: CONFIRM_RESET=SIM node scripts/reset-db.js --force');
    process.exit(1);
  }

  console.log('[reset] Apagando todas as tabelas de dados...');
  for (const table of TABLES) {
    await db.run(`TRUNCATE TABLE ${table} RESTART IDENTITY CASCADE`);
    console.log(`[reset] truncated ${table}`);
  }
  console.log('[reset] done. Run `npm run setup` to recreate roles/permissions/admin user.');
}

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[reset] Fatal error:', err);
      process.exit(1);
    });
}

module.exports = { run };

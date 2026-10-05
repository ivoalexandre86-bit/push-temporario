// TEMPORARY one-time data-import endpoint.
//
// This sandboxed environment cannot open a direct network connection to
// the Postgres database from outside Render (only HTTPS), so instead of
// running scripts/migrate-sqlite-to-postgres.js against an external
// DATABASE_URL, the real data is exported to JSON locally (where
// better-sqlite3 already has access to the file) and POSTed here once,
// where the already-configured local `db` pool can insert it directly.
//
// Guarded by a bearer token (ADMIN_MIGRATE_TOKEN) so it does nothing
// unless that env var is set. Remove this file and its require in app.js
// after the one-time migration is done - it is not meant to stay in
// production.

const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db/connection');
const { MIN_SECRET_LENGTH } = require('../config');

const router = express.Router();

/**
 * Validates the bearer token against ADMIN_MIGRATE_TOKEN (read from the
 * environment only - never hardcode it in tracked files such as
 * render.yaml). Responds 404 when the variable is unset or too short, so
 * the endpoints are effectively disabled by default. Constant-time compare.
 */
function checkAdminToken(req, res) {
  const token = process.env.ADMIN_MIGRATE_TOKEN;
  if (!token || token.length < MIN_SECRET_LENGTH) {
    res.status(404).json({ error: 'NOT_FOUND' });
    return false;
  }
  const provided = Buffer.from(String(req.get('Authorization') || ''));
  const expected = Buffer.from(`Bearer ${token}`);
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    res.status(401).json({ error: 'UNAUTHORIZED' });
    return false;
  }
  return true;
}

// TEMPORARY: resets the password of one or more existing users directly in
// the production database. Needed because the normal "esqueci minha senha"
// flow only returns its reset token outside NODE_ENV=production (no email
// transport is configured), so it can't be used to recover the demo
// accounts here. Guarded by the same ADMIN_MIGRATE_TOKEN as the migration
// endpoint above. Remove together with the rest of this file once no
// longer needed.
router.post('/admin/reset-password', express.json({ limit: '1mb' }), async (req, res, next) => {
  try {
    if (!checkAdminToken(req, res)) return;

    const { emails, newPassword } = req.body || {};
    if (!Array.isArray(emails) || !emails.length || typeof newPassword !== 'string' || newPassword.length < 8) {
      return res.status(400).json({ error: 'BAD_BODY', message: 'Esperado { emails: ["..."], newPassword: "..." } (senha com 8+ caracteres).' });
    }

    const passwordHash = bcrypt.hashSync(newPassword, 10);
    const updated = [];
    for (const email of emails) {
      const result = await db.run(
        'UPDATE users SET password_hash = ?, must_change_password = 0, failed_login_count = 0, locked_until = NULL WHERE lower(email) = lower(?)',
        passwordHash, email
      );
      updated.push({ email, changed: result.changes || 0 });
    }

    res.json({ ok: true, updated });
  } catch (err) {
    next(err);
  }
});

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
];

const SERIAL_TABLES = [
  'roles', 'permissions', 'users', 'projects', 'areas', 'people',
  'time_entries', 'comments', 'attachments', 'audit_log', 'import_batches', 'saved_views',
];

router.post('/admin/migrate-data', express.json({ limit: '20mb' }), async (req, res, next) => {
  try {
    if (!checkAdminToken(req, res)) return;

    const dump = req.body && req.body.tables;
    if (!dump || typeof dump !== 'object') {
      return res.status(400).json({ error: 'BAD_BODY', message: 'Esperado { tables: { ... } }' });
    }

    // Optional: when a previous partial migration (or the demo seed from
    // adminRunSeed below) already left some rows behind, their ids can
    // collide with the real ids in this dump (the real data preserves its
    // original ids exactly, see migrate-sqlite-to-postgres.js), causing
    // ON CONFLICT DO NOTHING to silently skip real rows and/or leave FK
    // columns (assignee_user_id, person_id's user_id, ...) pointing at the
    // wrong row. Passing resetAccessControl: true clears every table this
    // endpoint manages first (in reverse dependency order, so FKs never
    // block the deletes), then the normal insert loop below reinserts
    // everything fresh and consistent from this dump.
    const resetAccessControl = req.body && req.body.resetAccessControl === true;

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
      if (resetAccessControl) {
        for (const { name: table } of [...TABLES].reverse()) {
          await tx.run(`DELETE FROM ${table}`);
        }
      }

      for (const { name: table, conflict } of TABLES) {
        const sourceRows = dump[table] || [];
        if (!sourceRows.length) {
          summary[table] = { source: 0, inserted: 0 };
          continue;
        }

        const targetCols = pgColumnsByTable[table];
        const sourceCols = Object.keys(sourceRows[0]);
        const cols = sourceCols.filter((c) => targetCols.includes(c));
        if (!cols.length) throw new Error(`Nenhuma coluna em comum para "${table}".`);

        const placeholders = cols.map(() => '?').join(', ');
        const conflictCols = conflict.join(', ');
        const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders}) ON CONFLICT (${conflictCols}) DO NOTHING`;

        let inserted = 0;
        for (const row of sourceRows) {
          const values = cols.map((c) => row[c]);
          const result = await tx.run(sql, ...values);
          inserted += result.changes || 0;
        }
        summary[table] = { source: sourceRows.length, inserted };
      }

      for (const table of SERIAL_TABLES) {
        await tx.run(
          `SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE((SELECT MAX(id) FROM ${table}), 1), (SELECT COUNT(*) FROM ${table}) > 0)`
        );
      }
    });

    res.json({ ok: true, summary });
  } catch (err) {
    next(err);
  }
});

// TEMPORARY: runs the normal `npm run seed` logic (roles, permissions, the
// 5 demo users) against production. This was never actually applied on
// deploy - render.yaml's startCommand only runs `npm run migrate` (schema),
// never `npm run seed` - so the demo accounts never existed here, which is
// why resetting their password above always reported changed:0. Safe to
// call more than once: seed.js only inserts with ON CONFLICT DO NOTHING.
// Remove together with the rest of this file once no longer needed.
router.post('/admin/run-seed', async (req, res, next) => {
  try {
    if (!checkAdminToken(req, res)) return;

    await require('../db/seed').run();
    const count = await db.get('SELECT COUNT(*) AS n FROM users');
    res.json({ ok: true, usersInDb: count.n });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

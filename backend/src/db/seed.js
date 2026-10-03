// Seeds roles, permissions, role_permissions and a starter set of user
// accounts (one per role) so the system is immediately usable/testable.
// Business data (projects, areas, actions) comes from scripts/import-xlsx.js,
// NOT from here - this file only ever creates the access-control skeleton.
//
// Loads backend/.env when run directly (e.g. `npm run seed`), same reasoning
// as in src/db/migrate.js.
require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./connection');
const { ROLES, ROLE_LABELS_PT, PERMISSIONS, ROLE_PERMISSIONS } = require('../permissions');
const { DEMO_ACCOUNTS, demoAccountsSeedAllowed, demoPassword } = require('../config');

async function seedRolesAndPermissions(tx) {
  for (const key of Object.values(ROLES)) {
    await tx.run('INSERT INTO roles (key, name) VALUES (?, ?) ON CONFLICT (key) DO NOTHING', key, ROLE_LABELS_PT[key]);
  }

  for (const key of Object.values(PERMISSIONS)) {
    await tx.run('INSERT INTO permissions (key) VALUES (?) ON CONFLICT (key) DO NOTHING', key);
  }

  for (const [roleKey, perms] of Object.entries(ROLE_PERMISSIONS)) {
    const role = await tx.get('SELECT id FROM roles WHERE key = ?', roleKey);
    for (const permKey of perms) {
      const perm = await tx.get('SELECT id FROM permissions WHERE key = ?', permKey);
      if (role && perm) {
        await tx.run(
          'INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?) ON CONFLICT (role_id, permission_id) DO NOTHING',
          role.id, perm.id
        );
      }
    }
  }
  console.log('[seed] roles & permissions ready');
}

// Demo accounts are a local development/test convenience. In production
// they are skipped unless ALLOW_DEMO_ACCOUNTS=true AND SEED_DEMO_PASSWORD is
// set - there is no default password there. The password is never logged.
async function seedUsers(tx) {
  if (!demoAccountsSeedAllowed()) {
    console.log('[seed] demo users skipped (production; set ALLOW_DEMO_ACCOUNTS=true to create them)');
    return;
  }
  const password = demoPassword();
  if (!password) {
    console.log('[seed] demo users skipped (SEED_DEMO_PASSWORD not set)');
    return;
  }
  const passwordHash = bcrypt.hashSync(password, 10);

  for (const u of DEMO_ACCOUNTS) {
    const role = await tx.get('SELECT id FROM roles WHERE key = ?', ROLES[u.role] || u.role);
    await tx.run(
      'INSERT INTO users (name, email, password_hash, role_id, active) VALUES (?, ?, ?, ?, 1) ON CONFLICT (email) DO NOTHING',
      u.name, u.email, passwordHash, role.id
    );
  }
  console.log('[seed] demo users ready');
}

async function run() {
  await db.transaction(async (tx) => {
    await seedRolesAndPermissions(tx);
    await seedUsers(tx);
  });
  console.log('[seed] done.');
}

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch((err) => { console.error('[seed] failed:', err); process.exit(1); });
}

module.exports = { run };

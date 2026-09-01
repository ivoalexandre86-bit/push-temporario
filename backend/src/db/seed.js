// Seeds roles, permissions, role_permissions and a starter set of user
// accounts (one per role) so the system is immediately usable/testable.
// Business data (projects, areas, actions) comes from scripts/import-xlsx.js,
// NOT from here - this file only ever creates the access-control skeleton.
const bcrypt = require('bcryptjs');
const db = require('./connection');
const { ROLES, ROLE_LABELS_PT, PERMISSIONS, ROLE_PERMISSIONS } = require('../permissions');

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD || 'Mudar@123';

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

async function seedUsers(tx) {
  const passwordHash = bcrypt.hashSync(DEMO_PASSWORD, 10);

  const demoUsers = [
    { name: 'Administrador do Sistema', email: 'admin@projetos.local', role: ROLES.ADMIN },
    { name: 'Gerente de Projetos', email: 'gerente@projetos.local', role: ROLES.PROJECT_MANAGER },
    { name: 'Colaborador Demo', email: 'colaborador@projetos.local', role: ROLES.CONTRIBUTOR },
    { name: 'Visualizador Demo', email: 'visualizador@projetos.local', role: ROLES.VIEWER },
    { name: 'Auditor Demo', email: 'auditor@projetos.local', role: ROLES.AUDITOR },
  ];

  for (const u of demoUsers) {
    const role = await tx.get('SELECT id FROM roles WHERE key = ?', u.role);
    await tx.run(
      'INSERT INTO users (name, email, password_hash, role_id, active) VALUES (?, ?, ?, ?, 1) ON CONFLICT (email) DO NOTHING',
      u.name, u.email, passwordHash, role.id
    );
  }
  console.log(`[seed] demo users ready (password: ${DEMO_PASSWORD})`);
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

module.exports = { run, DEMO_PASSWORD };

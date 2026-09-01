const { PGlite } = require('@electric-sql/pglite');
const { PGLiteSocketServer } = require('@electric-sql/pglite-socket');
const { v4: uuidv4 } = require('uuid');
const request = require('supertest');

let pglite;
let socketServer;

/**
 * Boots a fresh in-memory PGlite instance (a WASM-embedded Postgres, no
 * server/root install needed) behind a local TCP socket, points
 * DATABASE_URL at it, and runs migrations + seed. Must be called (and
 * awaited) before requiring '../src/app' (or anything that transitively
 * requires '../src/db/connection'). Vitest gives each test file its own
 * process (pool: 'forks'), so this is safe to call once per file.
 */
async function initTestDb() {
  pglite = new PGlite();
  socketServer = new PGLiteSocketServer({ db: pglite, port: 0, host: '127.0.0.1', maxConnections: 5 });
  await socketServer.start();
  const [host, port] = socketServer.getServerConn().split(':');

  process.env.DATABASE_URL = `postgres://postgres:postgres@${host}:${port}/postgres`;
  process.env.PGSSLMODE = 'disable';
  process.env.JWT_SECRET = 'test-secret-not-for-production';
  process.env.NODE_ENV = 'test';
  process.env.SEED_DEMO_PASSWORD = 'Test@1234';
  process.env.CORS_ORIGIN = 'http://localhost:5173';

  await require('../src/db/migrate').run();
  await require('../src/db/seed').run();
}

/** Releases the pg pool and shuts down the PGlite instance for this file. */
async function closeTestDb() {
  try {
    const db = require('../src/db/connection');
    await db.pool.end();
  } catch (err) { /* ignore */ }
  if (socketServer) await socketServer.stop().catch(() => {});
  if (pglite) await pglite.close().catch(() => {});
}

function getDb() {
  return require('../src/db/connection');
}

function getApp() {
  return require('../src/app');
}

async function login(app, email, password = 'Test@1234') {
  const res = await request(app).post('/api/auth/login').send({ email, password });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${JSON.stringify(res.body)}`);
  const cookie = res.headers['set-cookie'];
  return { cookie, token: res.body.token, user: res.body.user };
}

/** Helper to attach auth cookie + CSRF header to a single supertest request. */
function withAuth(req, cookie) {
  return req.set('Cookie', cookie).set('X-Requested-With', 'ProjetosApp');
}

async function createProject(db, name) {
  const info = await db.run('INSERT INTO projects (name, is_imported) VALUES (?, 1) RETURNING id', name);
  return info.lastInsertRowid;
}

async function createArea(db, name) {
  const info = await db.run('INSERT INTO areas (name, is_imported) VALUES (?, 1) RETURNING id', name);
  return info.lastInsertRowid;
}

async function createUser(db, { name, email, roleKey, active = 1 }) {
  const bcrypt = require('bcryptjs');
  const role = await db.get('SELECT id FROM roles WHERE key = ?', roleKey);
  const hash = bcrypt.hashSync('Test@1234', 10);
  const info = await db.run(
    'INSERT INTO users (name, email, password_hash, role_id, active) VALUES (?, ?, ?, ?, ?) RETURNING id',
    name, email, hash, role.id, active
  );
  return info.lastInsertRowid;
}

async function scopeUserToProject(db, userId, projectId) {
  await db.run('INSERT INTO user_project_scope (user_id, project_id) VALUES (?, ?) ON CONFLICT (user_id, project_id) DO NOTHING', userId, projectId);
}

async function createAction(db, { projectId, areaId, status = 'ANDAMENTO', businessId, responsibleName = 'Fulano', assigneeUserId = null, plannedHours = null, dueDate = null, completionDate = null, startDate = null, refMonth = '2026-01-01', description = 'Ação de teste' }) {
  const uuid = uuidv4();
  const maxRow = await db.get('SELECT MAX(business_id) AS m FROM actions');
  const id = businessId || (maxRow.m || 0) + 1;
  await db.run(`
    INSERT INTO actions (uuid, business_id, project_id, ref_month, area_id, description, responsible_name, assignee_user_id, planned_hours, start_date, due_date, completion_date, status, source, created_by, updated_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'MANUAL', 1, 1)
  `, uuid, id, projectId, refMonth, areaId, description, responsibleName, assigneeUserId, plannedHours, startDate, dueDate, completionDate, status);
  return { uuid, businessId: id };
}

module.exports = {
  initTestDb, closeTestDb, getDb, getApp, login, withAuth, createProject, createArea, createUser, createAction, scopeUserToProject,
};

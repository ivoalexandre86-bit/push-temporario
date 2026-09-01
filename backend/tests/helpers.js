const path = require('path');
const os = require('os');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const request = require('supertest');

/**
 * Points DB_PATH at a fresh temp SQLite file and runs migrations + seed.
 * Must be called before requiring '../src/app' (or anything that transitively
 * requires '../src/db/connection'). Vitest gives each test file its own
 * module registry by default, so this is safe to call once per file.
 */
function initTestDb() {
  const tmpDb = path.join(os.tmpdir(), `projetos-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  process.env.DB_PATH = tmpDb;
  process.env.JWT_SECRET = 'test-secret-not-for-production';
  process.env.NODE_ENV = 'test';
  process.env.SEED_DEMO_PASSWORD = 'Test@1234';
  process.env.CORS_ORIGIN = 'http://localhost:5173';

  require('../src/db/migrate').run();
  require('../src/db/seed').run();

  return tmpDb;
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

/** Returns a supertest agent pre-authenticated as the given demo user, with the CSRF header pre-set. */
function authed(app, cookie) {
  const agent = request.agent(app);
  agent.set('X-Requested-With', 'ProjetosApp');
  if (cookie) agent.jar && null; // supertest.agent manages cookies automatically once we call with cookie header manually below
  return { agent, cookie };
}

/** Helper to attach auth cookie + CSRF header to a single supertest request. */
function withAuth(req, cookie) {
  return req.set('Cookie', cookie).set('X-Requested-With', 'ProjetosApp');
}

function createProject(db, name, opts = {}) {
  const info = db.prepare('INSERT INTO projects (name, is_imported) VALUES (?, 1)').run(name);
  return info.lastInsertRowid;
}

function createArea(db, name) {
  const info = db.prepare('INSERT INTO areas (name, is_imported) VALUES (?, 1)').run(name);
  return info.lastInsertRowid;
}

function createUser(db, { name, email, roleKey, active = 1 }) {
  const bcrypt = require('bcryptjs');
  const role = db.prepare('SELECT id FROM roles WHERE key = ?').get(roleKey);
  const hash = bcrypt.hashSync('Test@1234', 10);
  const info = db.prepare('INSERT INTO users (name, email, password_hash, role_id, active) VALUES (?, ?, ?, ?, ?)')
    .run(name, email, hash, role.id, active);
  return info.lastInsertRowid;
}

function scopeUserToProject(db, userId, projectId) {
  db.prepare('INSERT OR IGNORE INTO user_project_scope (user_id, project_id) VALUES (?, ?)').run(userId, projectId);
}

function createAction(db, { projectId, areaId, status = 'ANDAMENTO', businessId, responsibleName = 'Fulano', assigneeUserId = null, plannedHours = null, dueDate = null, completionDate = null, startDate = null, refMonth = '2026-01-01', description = 'Ação de teste' }) {
  const uuid = uuidv4();
  const maxId = db.prepare('SELECT MAX(business_id) AS m FROM actions').get().m || 0;
  const id = businessId || maxId + 1;
  db.prepare(`
    INSERT INTO actions (uuid, business_id, project_id, ref_month, area_id, description, responsible_name, assignee_user_id, planned_hours, start_date, due_date, completion_date, status, source, created_by, updated_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'MANUAL', 1, 1)
  `).run(uuid, id, projectId, refMonth, areaId, description, responsibleName, assigneeUserId, plannedHours, startDate, dueDate, completionDate, status);
  return { uuid, businessId: id };
}

module.exports = {
  initTestDb, getDb, getApp, login, withAuth, createProject, createArea, createUser, createAction, scopeUserToProject,
};

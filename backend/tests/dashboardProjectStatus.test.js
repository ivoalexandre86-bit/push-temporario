const request = require('supertest');
const { initTestDb, closeTestDb, getDb, getApp, login, withAuth, createProject, createArea, createUser, createAction, scopeUserToProject } = require('./helpers');

// Painel KPI row: count of visible projects by the project's own status.
let app, db;
let running, stopped, empty, hidden;
let pmCookie, adminCookie;

beforeAll(async () => {
  await initTestDb();
  db = getDb();
  app = getApp();

  running = await createProject(db, 'KPI Andamento');
  stopped = await createProject(db, 'KPI Parado');
  empty = await createProject(db, 'KPI Sem ações');
  hidden = await createProject(db, 'KPI Oculto');
  const area = await createArea(db, 'Área KPI');
  for (const projectId of [running, stopped, hidden]) await createAction(db, { projectId, areaId: area });
  await db.run("UPDATE projects SET status = 'PARADO' WHERE id = ?", stopped);
  await db.run("UPDATE projects SET status = 'CONCLUÍDO' WHERE id = ?", empty);

  const pm = await createUser(db, { name: 'PM KPI', email: 'pm.kpi@test.local', roleKey: 'PROJECT_MANAGER' });
  for (const p of [running, stopped, empty]) await scopeUserToProject(db, pm, p);

  ({ cookie: adminCookie } = await login(app, 'admin@projetos.local'));
  ({ cookie: pmCookie } = await login(app, 'pm.kpi@test.local'));
});

afterAll(async () => {
  await closeTestDb();
});

describe('Dashboard projects by status', () => {
  it('counts only visible projects, including ones without actions', async () => {
    const res = await withAuth(request(app).get('/api/dashboard'), pmCookie);
    expect(res.status).toBe(200);
    expect(res.body.projectsByStatus).toEqual({ ANDAMENTO: 1, PARADO: 1, 'CONCLUÍDO': 1, CANCELADO: 0 });
    expect(res.body.totalProjects).toBe(3);
  });

  it('keeps every status count when filtering by project status', async () => {
    const res = await withAuth(request(app).get('/api/dashboard?projectStatus=PARADO'), pmCookie);
    expect(res.body.projectsByStatus.ANDAMENTO).toBe(1);
    expect(res.body.totalActions).toBe(1);
  });

  it('honors the project filter', async () => {
    const res = await withAuth(request(app).get(`/api/dashboard?projectId=${stopped}`), adminCookie);
    expect(res.body.projectsByStatus).toEqual({ ANDAMENTO: 0, PARADO: 1, 'CONCLUÍDO': 0, CANCELADO: 0 });
  });
});

const request = require('supertest');
const { initTestDb, closeTestDb, getDb, getApp, login, withAuth, createProject, createArea, createAction } = require('./helpers');

let app, db, cookie, projectId;

beforeAll(async () => {
  await initTestDb();
  db = getDb();
  app = getApp();
  ({ cookie } = await login(app, 'admin@projetos.local', 'Test@1234'));
  projectId = await createProject(db, 'Projeto KPIs Ações');
  const otherProject = await createProject(db, 'Outro Projeto KPIs');
  const areaId = await createArea(db, 'Área KPIs');
  await createAction(db, { projectId, areaId, status: 'ANDAMENTO' });
  await createAction(db, { projectId, areaId, status: 'ANDAMENTO' });
  await createAction(db, { projectId, areaId, status: 'CONCLUÍDO', completionDate: '2026-01-10' });
  await createAction(db, { projectId: otherProject, areaId, status: 'CANCELADO' });
});

afterAll(async () => {
  await closeTestDb();
});

describe('Action status KPIs on the Ações list', () => {
  it('counts actions per status using the other filters but not the status filter', async () => {
    const res = await withAuth(request(app).get(`/api/actions?projectId=${projectId}&status=CONCLUÍDO`), cookie);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.statusCounts).toEqual({ ANDAMENTO: 2, CANCELADO: 0, 'CONCLUÍDO': 1, 'EM ESTUDO': 0 });
  });
});

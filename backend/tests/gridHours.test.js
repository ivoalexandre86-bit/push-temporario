const request = require('supertest');
const { initTestDb, closeTestDb, getDb, getApp, login, withAuth, createProject, createArea, createAction, createUser, scopeUserToProject } = require('./helpers');

let app, db, adminCookie, proj, area;

beforeAll(async () => {
  await initTestDb();
  db = getDb();
  app = getApp();
  proj = await createProject(db, 'Projeto Totais');
  area = await createArea(db, 'Área Totais');
  ({ cookie: adminCookie } = await login(app, 'admin@projetos.local', 'Test@1234'));
});

afterAll(async () => { await closeTestDb(); });

describe('Ações grid: totals and inline horas reais', () => {
  it('returns planned/actual totals for every filtered action, not just the page', async () => {
    const a1 = await createAction(db, { projectId: proj, areaId: area, plannedHours: 10 });
    await createAction(db, { projectId: proj, areaId: area, plannedHours: 5.5 });
    await withAuth(request(app).post('/api/time-entries'), adminCookie).send({ actionId: a1.businessId, entryDate: '2026-01-05', hours: 4, type: 'ACTUAL' });

    const res = await withAuth(request(app).get(`/api/actions?projectId=${proj}&pageSize=1`), adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.hoursTotals).toEqual({ planned: 15.5, actual: 4, variance: -11.5 });
  });

  it('sets the total horas reais through one approved adjustment entry, up and down', async () => {
    const action = await createAction(db, { projectId: proj, areaId: area, plannedHours: 20 });
    await withAuth(request(app).post('/api/time-entries'), adminCookie).send({ actionId: action.businessId, entryDate: '2026-01-05', hours: 6, type: 'ACTUAL' });

    let res = await withAuth(request(app).put(`/api/actions/${action.businessId}/actual-hours`), adminCookie).send({ actualHours: 15 });
    expect(res.status).toBe(200);
    expect(res.body.actualHours).toBe(15);

    res = await withAuth(request(app).put(`/api/actions/${action.businessId}/actual-hours`), adminCookie).send({ actualHours: 2.5 });
    expect(res.body.actualHours).toBe(2.5);

    const entries = await db.all("SELECT hours, note FROM time_entries WHERE action_uuid = ? AND note LIKE 'Ajuste%'", action.uuid);
    expect(entries).toHaveLength(1);
    expect(entries[0].hours).toBe(-3.5);

    res = await withAuth(request(app).put(`/api/actions/${action.businessId}/actual-hours`), adminCookie).send({ actualHours: -1 });
    expect(res.status).toBe(400);
  });

  it('a Contributor cannot set horas reais from the grid', async () => {
    const contributor = await createUser(db, { name: 'Colab Totais', email: 'colab.totais@test.local', roleKey: 'CONTRIBUTOR' });
    await scopeUserToProject(db, contributor, proj);
    const action = await createAction(db, { projectId: proj, areaId: area, assigneeUserId: contributor });
    const { cookie } = await login(app, 'colab.totais@test.local');
    const res = await withAuth(request(app).put(`/api/actions/${action.businessId}/actual-hours`), cookie).send({ actualHours: 3 });
    expect(res.status).toBe(403);
  });
});

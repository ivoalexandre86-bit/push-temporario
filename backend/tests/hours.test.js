const request = require('supertest');
const { initTestDb, getDb, getApp, login, withAuth, createProject, createArea, createAction, createUser, scopeUserToProject } = require('./helpers');

let app, db, adminCookie;
let proj, area;

beforeAll(async () => {
  initTestDb();
  db = getDb();
  app = getApp();
  proj = createProject(db, 'Projeto Horas');
  area = createArea(db, 'Área Horas');
  ({ cookie: adminCookie } = await login(app, 'admin@projetos.local', 'Test@1234'));
});

describe('Hours management', () => {
  it('planned hours default from the action-level field when no planned time entries exist', async () => {
    const action = createAction(db, { projectId: proj, areaId: area, status: 'ANDAMENTO', plannedHours: 10 });
    const res = await withAuth(request(app).get(`/api/actions/${action.businessId}`), adminCookie);
    expect(res.body.plannedHours).toBe(10);
    expect(res.body.actualHours).toBe(0);
  });

  it('actual hours are the sum of APPROVED actual time entries only', async () => {
    const action = createAction(db, { projectId: proj, areaId: area, status: 'ANDAMENTO', plannedHours: 20 });

    await withAuth(request(app).post('/api/time-entries'), adminCookie).send({ actionId: action.businessId, entryDate: '2026-01-05', hours: 5, type: 'ACTUAL' });
    await withAuth(request(app).post('/api/time-entries'), adminCookie).send({ actionId: action.businessId, entryDate: '2026-01-06', hours: 3, type: 'ACTUAL' });

    const res = await withAuth(request(app).get(`/api/actions/${action.businessId}`), adminCookie);
    expect(res.body.actualHours).toBe(8);
    expect(res.body.plannedHours).toBe(20);
    expect(res.body.varianceHours).toBe(8 - 20);
  });

  it("a Contributor's actual-hours entries start PENDING and do not count until approved", async () => {
    const contributor = createUser(db, { name: 'Colaborador Horas', email: 'contrib.horas@test.local', roleKey: 'CONTRIBUTOR' });
    scopeUserToProject(db, contributor, proj);
    const action = createAction(db, { projectId: proj, areaId: area, status: 'ANDAMENTO', plannedHours: 10, assigneeUserId: contributor });
    const { cookie: contribCookie } = await login(app, 'contrib.horas@test.local');

    const entryRes = await withAuth(request(app).post('/api/time-entries'), contribCookie).send({ actionId: action.businessId, entryDate: '2026-01-05', hours: 4, type: 'ACTUAL' });
    expect(entryRes.status).toBe(201);
    expect(entryRes.body.approvalStatus).toBe('PENDING');

    const beforeApproval = await withAuth(request(app).get(`/api/actions/${action.businessId}`), adminCookie);
    expect(beforeApproval.body.actualHours).toBe(0);

    const approveRes = await withAuth(request(app).patch(`/api/time-entries/${entryRes.body.id}/approve`), adminCookie).send({ approve: true });
    expect(approveRes.status).toBe(200);

    const afterApproval = await withAuth(request(app).get(`/api/actions/${action.businessId}`), adminCookie);
    expect(afterApproval.body.actualHours).toBe(4);
  });

  it('rejects negative new time entries', async () => {
    const action = createAction(db, { projectId: proj, areaId: area, status: 'ANDAMENTO', plannedHours: 10 });
    const res = await withAuth(request(app).post('/api/time-entries'), adminCookie).send({ actionId: action.businessId, entryDate: '2026-01-05', hours: -5, type: 'ACTUAL' });
    expect(res.status).toBe(400);
  });

  it('preserves negative imported legacy hours exactly, without altering them', async () => {
    const uuid = require('uuid').v4();
    const maxId = db.prepare('SELECT MAX(business_id) m FROM actions').get().m || 0;
    db.prepare(`
      INSERT INTO actions (uuid, business_id, project_id, ref_month, area_id, description, responsible_name, actual_hours_legacy, status, source, created_by, updated_by, import_exceptions)
      VALUES (?, ?, ?, '2026-01-01', ?, 'Ação legada com horas negativas', 'Legado', -12, 'CONCLUÍDO', 'IMPORT', 1, 1, '["NEGATIVE_LEGACY_HOURS"]')
    `).run(uuid, maxId + 1, proj, area);

    const res = await withAuth(request(app).get(`/api/actions/${maxId + 1}`), adminCookie);
    expect(res.body.actualHoursLegacy).toBe(-12);
    expect(res.body.importExceptions).toContain('NEGATIVE_LEGACY_HOURS');
  });
});

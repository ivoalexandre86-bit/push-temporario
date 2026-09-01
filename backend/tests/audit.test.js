const request = require('supertest');
const { initTestDb, closeTestDb, getDb, getApp, login, withAuth, createProject, createArea, createAction, createUser } = require('./helpers');

let app, db, adminCookie, auditorCookie;
let proj, area;

beforeAll(async () => {
  await initTestDb();
  db = getDb();
  app = getApp();
  proj = await createProject(db, 'Projeto Auditoria');
  area = await createArea(db, 'Área Auditoria');
  await createUser(db, { name: 'Auditor X', email: 'auditor.x@test.local', roleKey: 'AUDITOR' });
  ({ cookie: adminCookie } = await login(app, 'admin@projetos.local', 'Test@1234'));
  ({ cookie: auditorCookie } = await login(app, 'auditor.x@test.local'));
});

afterAll(async () => {
  await closeTestDb();
});

describe('Audit trail', () => {
  it('is immutable: no route exists to update or delete an audit_log record', async () => {
    const row = await db.get('SELECT * FROM audit_log LIMIT 1');
    if (row) {
      const patchRes = await withAuth(request(app).patch(`/api/audit/${row.id}`), adminCookie).send({ new_value: 'hacked' });
      expect(patchRes.status).toBe(404);
      const deleteRes = await withAuth(request(app).delete(`/api/audit/${row.id}`), adminCookie);
      expect(deleteRes.status).toBe(404);
    }
  });

  it('an Auditor has read-only access: can view audit but cannot mutate actions', async () => {
    const auditRes = await withAuth(request(app).get('/api/audit'), auditorCookie);
    expect(auditRes.status).toBe(200);

    const createRes = await withAuth(request(app).post('/api/actions'), auditorCookie).send({
      projectId: proj, areaId: area, refMonth: '2026-01', description: 'Auditor tentando criar', status: 'ANDAMENTO', responsibleName: 'X',
    });
    expect(createRes.status).toBe(403);
  });

  it('a non-auditor, non-admin role cannot view the audit trail', async () => {
    await createUser(db, { name: 'Viewer sem auditoria', email: 'viewer.audit@test.local', roleKey: 'VIEWER' });
    const { cookie } = await login(app, 'viewer.audit@test.local');
    const res = await withAuth(request(app).get('/api/audit'), cookie);
    expect(res.status).toBe(403);
  });

  it('records old and new values, actor, and timestamp for a status change', async () => {
    const action = await createAction(db, { projectId: proj, areaId: area, status: 'ANDAMENTO' });
    const res = await withAuth(request(app).patch(`/api/actions/${action.businessId}`), adminCookie).send({ status: 'EM ESTUDO' });
    expect(res.status).toBe(200);

    const auditRow = await db.get(`
      SELECT * FROM audit_log WHERE entity_type = 'ACTION' AND entity_id = ? AND field_name = 'status' ORDER BY id DESC LIMIT 1
    `, action.uuid);
    expect(auditRow).toBeTruthy();
    expect(auditRow.old_value).toBe('ANDAMENTO');
    expect(auditRow.new_value).toBe('EM ESTUDO');
    expect(auditRow.actor_name).toBe('Administrador do Sistema');
    expect(auditRow.action_type).toBe('STATUS_CHANGE');
    expect(auditRow.created_at).toBeTruthy();
  });
});

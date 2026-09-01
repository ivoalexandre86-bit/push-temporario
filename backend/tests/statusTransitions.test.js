const request = require('supertest');
const { initTestDb, getDb, getApp, login, withAuth, createProject, createArea, createAction } = require('./helpers');

let app, db, cookie;
let proj, area;

beforeAll(async () => {
  initTestDb();
  db = getDb();
  app = getApp();
  proj = createProject(db, 'Projeto Status');
  area = createArea(db, 'Área Status');
  ({ cookie } = await login(app, 'admin@projetos.local', 'Test@1234'));
});

describe('Business rules: status transitions', () => {
  it('rejects creating a CONCLUÍDO action without a completion date', async () => {
    const res = await withAuth(request(app).post('/api/actions'), cookie).send({
      projectId: proj, areaId: area, refMonth: '2026-01', description: 'Ação concluída sem data', status: 'CONCLUÍDO', responsibleName: 'X',
    });
    expect(res.status).toBe(400);
  });

  it('accepts creating a CONCLUÍDO action WITH a completion date', async () => {
    const res = await withAuth(request(app).post('/api/actions'), cookie).send({
      projectId: proj, areaId: area, refMonth: '2026-01', description: 'Ação concluída com data', status: 'CONCLUÍDO', completionDate: '2026-01-15', responsibleName: 'X',
    });
    expect(res.status).toBe(201);
  });

  it('rejects creating a CANCELADO action without a cancellation reason', async () => {
    const res = await withAuth(request(app).post('/api/actions'), cookie).send({
      projectId: proj, areaId: area, refMonth: '2026-01', description: 'Ação cancelada sem motivo', status: 'CANCELADO', responsibleName: 'X',
    });
    expect(res.status).toBe(400);
  });

  it('accepts CANCELADO with a reason', async () => {
    const res = await withAuth(request(app).post('/api/actions'), cookie).send({
      projectId: proj, areaId: area, refMonth: '2026-01', description: 'Ação cancelada com motivo', status: 'CANCELADO', cancellationReason: 'Escopo descontinuado', responsibleName: 'X',
    });
    expect(res.status).toBe(201);
  });

  it('requires an explicit reason to reopen a CONCLUÍDO action', async () => {
    const action = createAction(db, { projectId: proj, areaId: area, status: 'CONCLUÍDO', completionDate: '2026-01-20' });
    const res = await withAuth(request(app).patch(`/api/actions/${action.businessId}`), cookie).send({ status: 'ANDAMENTO' });
    expect(res.status).toBe(400);

    const res2 = await withAuth(request(app).patch(`/api/actions/${action.businessId}`), cookie).send({ status: 'ANDAMENTO', statusChangeReason: 'Retrabalho necessário' });
    expect(res2.status).toBe(200);
    expect(res2.body.status).toBe('ANDAMENTO');
  });

  it('requires project, area, description, status and a responsible/unassigned flag on creation', async () => {
    const res = await withAuth(request(app).post('/api/actions'), cookie).send({
      projectId: proj, areaId: area, refMonth: '2026-01', description: 'Sem responsável nem flag', status: 'ANDAMENTO',
    });
    expect(res.status).toBe(400);

    const res2 = await withAuth(request(app).post('/api/actions'), cookie).send({
      projectId: proj, areaId: area, refMonth: '2026-01', description: 'Explicitamente sem responsável', status: 'ANDAMENTO', unassigned: true,
    });
    expect(res2.status).toBe(201);
    expect(res2.body.responsibleName).toBeFalsy();
  });

  it('every create/update produces an audit trail entry', async () => {
    const before = db.prepare("SELECT COUNT(*) c FROM audit_log WHERE entity_type='ACTION'").get().c;
    const res = await withAuth(request(app).post('/api/actions'), cookie).send({
      projectId: proj, areaId: area, refMonth: '2026-01', description: 'Ação para auditoria', status: 'ANDAMENTO', responsibleName: 'Zeca',
    });
    expect(res.status).toBe(201);
    const after = db.prepare("SELECT COUNT(*) c FROM audit_log WHERE entity_type='ACTION'").get().c;
    expect(after).toBeGreaterThan(before);

    const patchRes = await withAuth(request(app).patch(`/api/actions/${res.body.id}`), cookie).send({ observations: 'nota adicionada' });
    expect(patchRes.status).toBe(200);
    const rows = db.prepare("SELECT * FROM audit_log WHERE entity_type='ACTION' AND entity_id = ? AND field_name = 'observations'").all(res.body.uuid);
    expect(rows.length).toBe(1);
    expect(rows[0].new_value).toBe('nota adicionada');
  });
});

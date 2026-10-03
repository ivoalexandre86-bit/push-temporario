const request = require('supertest');
const { initTestDb, closeTestDb, getDb, getApp, login, withAuth, createProject, createArea, createAction } = require('./helpers');

let app, db, cookie, adminId;

beforeAll(async () => {
  await initTestDb();
  db = getDb();
  app = getApp();
  ({ cookie, user: { id: adminId } } = await login(app, 'admin@projetos.local', 'Test@1234'));
});

afterAll(async () => {
  await closeTestDb();
});

describe('Project status (Melhoria 9 e 10)', () => {
  it('defaults a new project to ANDAMENTO when no status is given', async () => {
    const res = await withAuth(request(app).post('/api/projects'), cookie).send({ name: 'Projeto Sem Status Informado', managerUserId: adminId });
    expect(res.status).toBe(201);
    const row = await db.get('SELECT status FROM projects WHERE id = ?', res.body.id);
    expect(row.status).toBe('ANDAMENTO');
  });

  it('accepts an explicit status on creation and rejects an invalid one', async () => {
    const ok = await withAuth(request(app).post('/api/projects'), cookie).send({ name: 'Projeto Parado Desde o Início', managerUserId: adminId, status: 'PARADO' });
    expect(ok.status).toBe(201);
    const row = await db.get('SELECT status FROM projects WHERE id = ?', ok.body.id);
    expect(row.status).toBe('PARADO');

    const bad = await withAuth(request(app).post('/api/projects'), cookie).send({ name: 'Projeto Status Invalido', managerUserId: adminId, status: 'NAO_EXISTE' });
    expect(bad.status).toBe(400);
  });

  it('updates a project status via PATCH', async () => {
    const created = await withAuth(request(app).post('/api/projects'), cookie).send({ name: 'Projeto Para Concluir', managerUserId: adminId });
    const patchRes = await withAuth(request(app).patch(`/api/projects/${created.body.id}`), cookie).send({ status: 'CONCLUÍDO' });
    expect(patchRes.status).toBe(200);
    const row = await db.get('SELECT status FROM projects WHERE id = ?', created.body.id);
    expect(row.status).toBe('CONCLUÍDO');
  });

  it('filters the dashboard (and action list) by project status', async () => {
    const area = await createArea(db, 'Área Status Projeto');
    const activeProjectId = await createProject(db, 'Projeto Ativo Dashboard');
    const stoppedProjectRes = await withAuth(request(app).post('/api/projects'), cookie).send({ name: 'Projeto Parado Dashboard', managerUserId: adminId, status: 'PARADO' });
    const stoppedProjectId = stoppedProjectRes.body.id;

    await createAction(db, { projectId: activeProjectId, areaId: area, status: 'ANDAMENTO' });
    await createAction(db, { projectId: stoppedProjectId, areaId: area, status: 'ANDAMENTO' });

    const stoppedOnly = await withAuth(request(app).get('/api/actions?projectStatus=PARADO'), cookie);
    expect(stoppedOnly.body.items.every((i) => i.project.id === stoppedProjectId)).toBe(true);
    expect(stoppedOnly.body.items.some((i) => i.project.id === activeProjectId)).toBe(false);

    const dashRes = await withAuth(request(app).get('/api/dashboard?projectStatus=PARADO'), cookie);
    expect(dashRes.status).toBe(200);
    expect(dashRes.body.byProject.every((p) => p.id !== activeProjectId)).toBe(true);
  });
});

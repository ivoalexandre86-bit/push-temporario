const request = require('supertest');
const { initTestDb, closeTestDb, getDb, getApp, login, withAuth, createProject, createArea, createUser, createAction, scopeUserToProject } = require('./helpers');

let app, db;
let projectA, projectB, areaA;
let pmA, viewerNoScope, admin;

beforeAll(async () => {
  await initTestDb();
  db = getDb();
  app = getApp();

  projectA = await createProject(db, 'Projeto A');
  projectB = await createProject(db, 'Projeto B');
  areaA = await createArea(db, 'Área A');

  await createAction(db, { projectId: projectA, areaId: areaA, status: 'ANDAMENTO' });
  await createAction(db, { projectId: projectB, areaId: areaA, status: 'ANDAMENTO' });

  pmA = await createUser(db, { name: 'PM A', email: 'pm.a@test.local', roleKey: 'PROJECT_MANAGER' });
  await scopeUserToProject(db, pmA, projectA);

  viewerNoScope = await createUser(db, { name: 'Viewer sem escopo', email: 'viewer.none@test.local', roleKey: 'VIEWER' });

  admin = 1; // seeded admin
});

afterAll(async () => {
  await closeTestDb();
});

describe('Authentication', () => {
  it('rejects requests without a session', async () => {
    const res = await request(app).get('/api/actions');
    expect(res.status).toBe(401);
  });

  it('rejects invalid credentials', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'pm.a@test.local', password: 'wrong-password' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('INVALID_CREDENTIALS');
  });

  it('logs in with valid credentials and sets a session cookie', async () => {
    const { cookie, user } = await login(app, 'pm.a@test.local');
    expect(cookie).toBeTruthy();
    expect(user.role).toBe('PROJECT_MANAGER');
  });
});

describe('Project-level scoping', () => {
  it('a Project Manager only sees actions from their assigned project', async () => {
    const { cookie } = await login(app, 'pm.a@test.local');
    const res = await withAuth(request(app).get('/api/actions'), cookie);
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThan(0);
    for (const item of res.body.items) {
      expect(item.project.id).toBe(projectA);
    }
  });

  it('a Project Manager cannot access another project action by guessing its ID (IDOR check)', async () => {
    const { cookie } = await login(app, 'pm.a@test.local');
    const other = await createAction(db, { projectId: projectB, areaId: areaA, status: 'ANDAMENTO' });
    const res = await withAuth(request(app).get(`/api/actions/${other.businessId}`), cookie);
    expect(res.status).toBe(403);
  });

  it('a user with no project scope sees zero actions rather than erroring', async () => {
    const { cookie } = await login(app, 'viewer.none@test.local');
    const res = await withAuth(request(app).get('/api/actions'), cookie);
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBe(0);
    expect(res.body.total).toBe(0);
  });

  it('Admin sees actions across all projects', async () => {
    const { cookie } = await login(app, 'admin@projetos.local', 'Test@1234');
    const res = await withAuth(request(app).get('/api/actions'), cookie);
    expect(res.status).toBe(200);
    const projectIds = new Set(res.body.items.map((i) => i.project.id));
    expect(projectIds.has(projectA)).toBe(true);
    expect(projectIds.has(projectB)).toBe(true);
  });
});

describe('Role-based write permissions', () => {
  it('a Viewer cannot create actions', async () => {
    const { cookie } = await login(app, 'viewer.none@test.local');
    const res = await withAuth(request(app).post('/api/actions'), cookie).send({
      projectId: projectA, areaId: areaA, refMonth: '2026-01', description: 'Nova ação', status: 'ANDAMENTO', responsibleName: 'X',
    });
    expect(res.status).toBe(403);
  });

  it('a Viewer cannot manage users', async () => {
    const { cookie } = await login(app, 'viewer.none@test.local');
    const res = await withAuth(request(app).get('/api/users'), cookie);
    expect(res.status).toBe(403);
  });

  it('a Project Manager can create an action within their scoped project', async () => {
    const { cookie } = await login(app, 'pm.a@test.local');
    const res = await withAuth(request(app).post('/api/actions'), cookie).send({
      projectId: projectA, areaId: areaA, refMonth: '2026-01', description: 'Nova ação de PM', status: 'ANDAMENTO', responsibleName: 'Fulano',
    });
    expect(res.status).toBe(201);
  });

  it('a Project Manager cannot create an action in a project outside their scope', async () => {
    const { cookie } = await login(app, 'pm.a@test.local');
    const res = await withAuth(request(app).post('/api/actions'), cookie).send({
      projectId: projectB, areaId: areaA, refMonth: '2026-01', description: 'Tentativa fora do escopo', status: 'ANDAMENTO', responsibleName: 'Fulano',
    });
    expect(res.status).toBe(403);
  });

  it('a Contributor can only edit actions assigned to them', async () => {
    const contributorId = await createUser(db, { name: 'Colaborador X', email: 'contrib.x@test.local', roleKey: 'CONTRIBUTOR' });
    await scopeUserToProject(db, contributorId, projectA);
    const assignedToOther = await createAction(db, { projectId: projectA, areaId: areaA, status: 'ANDAMENTO', assigneeUserId: admin });
    const { cookie } = await login(app, 'contrib.x@test.local');
    const res = await withAuth(request(app).patch(`/api/actions/${assignedToOther.businessId}`), cookie).send({ observations: 'tentando editar' });
    expect(res.status).toBe(403);
  });

  it('a Contributor CAN edit an action assigned to them', async () => {
    const contributorId = await createUser(db, { name: 'Colaborador Y', email: 'contrib.y@test.local', roleKey: 'CONTRIBUTOR' });
    await scopeUserToProject(db, contributorId, projectA);
    const assigned = await createAction(db, { projectId: projectA, areaId: areaA, status: 'ANDAMENTO', assigneeUserId: contributorId });
    const { cookie } = await login(app, 'contrib.y@test.local');
    const res = await withAuth(request(app).patch(`/api/actions/${assigned.businessId}`), cookie).send({ observations: 'atualizado pelo colaborador' });
    expect(res.status).toBe(200);
    expect(res.body.observations).toBe('atualizado pelo colaborador');
  });
});

describe('CSRF protection', () => {
  it('rejects a cookie-authenticated mutation without the custom header', async () => {
    const { cookie } = await login(app, 'pm.a@test.local');
    const res = await request(app).post('/api/actions').set('Cookie', cookie).send({
      projectId: projectA, areaId: areaA, refMonth: '2026-01', description: 'sem header csrf', status: 'ANDAMENTO', responsibleName: 'X',
    });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('CSRF_CHECK_FAILED');
  });
});

const request = require('supertest');
const { initTestDb, closeTestDb, getDb, getApp, login, withAuth, createProject, createArea, createUser, createAction, scopeUserToProject } = require('./helpers');

// Visibility rule: Admins see every project; everyone else sees only the
// projects they are linked to (user_project_scope), manage or created.
let app, db;
let linked, managed, created, other, area;
let pm, pmCookie, viewer, viewerCookie, adminCookie;

beforeAll(async () => {
  await initTestDb();
  db = getDb();
  app = getApp();

  linked = await createProject(db, 'Vínculo');
  managed = await createProject(db, 'Gerenciado');
  created = await createProject(db, 'Criado');
  other = await createProject(db, 'Outro');
  area = await createArea(db, 'Área');
  for (const projectId of [linked, managed, created, other]) await createAction(db, { projectId, areaId: area });

  pm = await createUser(db, { name: 'PM Visível', email: 'pm.vis@test.local', roleKey: 'PROJECT_MANAGER' });
  viewer = await createUser(db, { name: 'Viewer Visível', email: 'viewer.vis@test.local', roleKey: 'VIEWER' });
  await scopeUserToProject(db, pm, linked);
  await db.run('UPDATE projects SET manager_user_id = ? WHERE id = ?', pm, managed);
  await db.run('UPDATE projects SET created_by_user_id = ? WHERE id = ?', pm, created);

  ({ cookie: adminCookie } = await login(app, 'admin@projetos.local'));
  ({ cookie: pmCookie } = await login(app, 'pm.vis@test.local'));
  ({ cookie: viewerCookie } = await login(app, 'viewer.vis@test.local'));
});

afterAll(async () => {
  await closeTestDb();
});

describe('Project visibility', () => {
  it('admins see every project', async () => {
    const res = await withAuth(request(app).get('/api/projects'), adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.items.map((p) => p.id)).toEqual(expect.arrayContaining([linked, managed, created, other]));
  });

  it('other users see only projects they are linked to, manage or created', async () => {
    const res = await withAuth(request(app).get('/api/projects'), pmCookie);
    expect(res.status).toBe(200);
    expect(res.body.items.map((p) => p.id).sort((a, b) => a - b)).toEqual([linked, managed, created].sort((a, b) => a - b));
  });

  it('users with no link see no projects', async () => {
    const res = await withAuth(request(app).get('/api/projects'), viewerCookie);
    expect(res.body.items).toEqual([]);
  });

  it('applies the same rule to a single project and its actions', async () => {
    expect((await withAuth(request(app).get(`/api/projects/${managed}`), pmCookie)).status).toBe(200);
    expect((await withAuth(request(app).get(`/api/projects/${other}`), pmCookie)).status).toBe(403);
    const actions = await withAuth(request(app).get('/api/actions?pageSize=100'), pmCookie);
    expect(new Set(actions.body.items.map((a) => a.project.id))).toEqual(new Set([linked, managed, created]));
  });

  it('does not let a manager edit a project outside their visibility', async () => {
    const res = await withAuth(request(app).patch(`/api/projects/${other}`), pmCookie).send({ priority: 'ALTA' });
    expect(res.status).toBe(403);
  });

  it('records who created a project', async () => {
    const res = await withAuth(request(app).post('/api/projects'), adminCookie).send({ name: 'Novo projeto', managerUserId: 1 });
    expect(res.status).toBe(201);
    const row = await db.get('SELECT created_by_user_id FROM projects WHERE id = ?', res.body.id);
    expect(row.created_by_user_id).toBe(1);
  });
});

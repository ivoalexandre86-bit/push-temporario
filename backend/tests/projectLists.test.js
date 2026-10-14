const request = require('supertest');
const { initTestDb, closeTestDb, getDb, getApp, login, withAuth, createUser } = require('./helpers');

let app, db, adminCookie, viewerCookie, projectId, personA, personB, areaA;

beforeAll(async () => {
  await initTestDb();
  db = getDb();
  app = getApp();
  ({ cookie: adminCookie } = await login(app, 'admin@projetos.local', 'Test@1234'));
  await createUser(db, { name: 'Leitor Listas Projeto', email: 'leitor.lp@projetos.local', roleKey: 'VIEWER' });
  ({ cookie: viewerCookie } = await login(app, 'leitor.lp@projetos.local', 'Test@1234'));
  projectId = (await db.run("INSERT INTO projects (name) VALUES ('Projeto com Listas') RETURNING id")).lastInsertRowid;
  personA = (await db.run("INSERT INTO people (name) VALUES ('Pessoa A Projeto') RETURNING id")).lastInsertRowid;
  personB = (await db.run("INSERT INTO people (name) VALUES ('Pessoa B Projeto') RETURNING id")).lastInsertRowid;
  areaA = (await db.run("INSERT INTO areas (name) VALUES ('Área A Projeto') RETURNING id")).lastInsertRowid;
});

afterAll(async () => {
  await closeTestDb();
});

describe('Per-project lists (/api/projects/:id/lists)', () => {
  it('starts empty, meaning every active item is offered', async () => {
    const res = await withAuth(request(app).get(`/api/projects/${projectId}/lists`), adminCookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ projectId, personIds: [], areaIds: [] });
  });

  it('saves the chosen responsáveis and áreas and records it in the audit log', async () => {
    const put = await withAuth(request(app).put(`/api/projects/${projectId}/lists`), adminCookie)
      .send({ personIds: [personB, personA, personA], areaIds: [areaA] });
    expect(put.status).toBe(200);
    expect(put.body).toEqual({ projectId, personIds: [personA, personB].sort((a, b) => a - b), areaIds: [areaA] });

    const all = await withAuth(request(app).get('/api/projects/lists'), adminCookie);
    expect(all.body.items.find((i) => i.projectId === projectId).areaIds).toEqual([areaA]);

    const audit = await db.all("SELECT field_name, new_value FROM audit_log WHERE entity_type = 'PROJECT' AND entity_id = ? ORDER BY id", String(projectId));
    expect(audit.map((a) => a.field_name)).toEqual(['projectPeople', 'projectAreas']);
    expect(audit[1].new_value).toContain('Área A Projeto');
  });

  it('clears a selection back to "all"', async () => {
    const put = await withAuth(request(app).put(`/api/projects/${projectId}/lists`), adminCookie).send({ personIds: [], areaIds: [areaA] });
    expect(put.body.personIds).toEqual([]);
    const row = await db.get('SELECT COUNT(*) AS n FROM project_people WHERE project_id = ?', projectId);
    expect(Number(row.n)).toBe(0);
  });

  it('rejects unknown ids', async () => {
    const res = await withAuth(request(app).put(`/api/projects/${projectId}/lists`), adminCookie).send({ personIds: [999999], areaIds: [] });
    expect(res.status).toBe(400);
  });

  it('does not let a viewer change the selection', async () => {
    const res = await withAuth(request(app).put(`/api/projects/${projectId}/lists`), viewerCookie).send({ personIds: [], areaIds: [] });
    expect(res.status).toBe(403);
  });
});

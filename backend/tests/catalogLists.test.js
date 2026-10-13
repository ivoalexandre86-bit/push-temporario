const request = require('supertest');
const { initTestDb, closeTestDb, getDb, getApp, login, withAuth, createUser } = require('./helpers');

let app, db, adminCookie, viewerCookie;

beforeAll(async () => {
  await initTestDb();
  db = getDb();
  app = getApp();
  ({ cookie: adminCookie } = await login(app, 'admin@projetos.local', 'Test@1234'));
  await createUser(db, { name: 'Leitor Listas', email: 'leitor.listas@projetos.local', roleKey: 'VIEWER' });
  ({ cookie: viewerCookie } = await login(app, 'leitor.listas@projetos.local', 'Test@1234'));
});

afterAll(async () => {
  await closeTestDb();
});

describe('Editable responsible list (/api/people)', () => {
  it('adds a responsible and rejects a duplicate name', async () => {
    const res = await withAuth(request(app).post('/api/people'), adminCookie).send({ name: 'Maria Lista' });
    expect(res.status).toBe(201);
    const dup = await withAuth(request(app).post('/api/people'), adminCookie).send({ name: 'maria lista' });
    expect(dup.status).toBe(409);
  });

  it('renames a responsible and keeps the name on their actions in step', async () => {
    const created = await withAuth(request(app).post('/api/people'), adminCookie).send({ name: 'João Antigo' });
    const personId = created.body.id;
    const project = await db.run("INSERT INTO projects (name) VALUES ('Projeto Listas') RETURNING id");
    const area = await db.run("INSERT INTO areas (name) VALUES ('Área Listas') RETURNING id");
    const action = await withAuth(request(app).post('/api/actions'), adminCookie).send({
      projectId: project.lastInsertRowid, areaId: area.lastInsertRowid, refMonth: '2026-10',
      description: 'Ação do João', responsibleName: 'João Antigo', status: 'ANDAMENTO',
    });
    expect(action.status).toBe(201);

    const patch = await withAuth(request(app).patch(`/api/people/${personId}`), adminCookie).send({ name: 'João Novo' });
    expect(patch.status).toBe(200);
    const row = await db.get('SELECT responsible_name, person_id FROM actions WHERE uuid = ?', action.body.uuid);
    expect(row.responsible_name).toBe('João Novo');
    expect(row.person_id).toBe(personId);
  });

  it('inactivates a responsible without deleting it', async () => {
    const created = await withAuth(request(app).post('/api/people'), adminCookie).send({ name: 'Pessoa Inativa' });
    const patch = await withAuth(request(app).patch(`/api/people/${created.body.id}`), adminCookie).send({ active: false });
    expect(patch.status).toBe(200);
    const list = await withAuth(request(app).get('/api/people'), adminCookie);
    expect(list.body.items.find((p) => p.id === created.body.id).active).toBe(0);
  });

  it('does not let a viewer edit the list', async () => {
    const res = await withAuth(request(app).post('/api/people'), viewerCookie).send({ name: 'Não Pode' });
    expect(res.status).toBe(403);
  });
});

describe('Editable área/processo list (/api/areas)', () => {
  it('adds, renames and inactivates an área/processo', async () => {
    const created = await withAuth(request(app).post('/api/areas'), adminCookie).send({ name: 'Processo Novo' });
    expect(created.status).toBe(201);
    const renamed = await withAuth(request(app).patch(`/api/areas/${created.body.id}`), adminCookie).send({ name: 'Processo Renomeado', active: false });
    expect(renamed.status).toBe(200);
    const row = await db.get('SELECT name, active FROM areas WHERE id = ?', created.body.id);
    expect(row).toEqual({ name: 'Processo Renomeado', active: 0 });
  });
});

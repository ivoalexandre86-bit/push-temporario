const request = require('supertest');
const { initTestDb, closeTestDb, getDb, getApp, login, withAuth, createProject, createArea, createAction } = require('./helpers');

let app, db, cookie, action;

beforeAll(async () => {
  await initTestDb();
  db = getDb();
  app = getApp();
  ({ cookie } = await login(app, 'admin@projetos.local', 'Test@1234'));
  const projectId = await createProject(db, 'Projeto Anexos');
  const areaId = await createArea(db, 'Área Anexos');
  action = await createAction(db, { projectId, areaId });
});

afterAll(async () => {
  await closeTestDb();
});

describe('Action attachments', () => {
  let attachmentId;

  it('stores the uploaded file in the database', async () => {
    const res = await withAuth(request(app).post(`/api/actions/${action.businessId}/attachments`), cookie)
      .attach('file', Buffer.from('conteúdo do anexo'), { filename: 'relatório.txt', contentType: 'text/plain' });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('relatório.txt');
    attachmentId = res.body.id;
    const row = await db.get('SELECT content FROM attachments WHERE id = ?', attachmentId);
    expect(row.content.toString()).toBe('conteúdo do anexo');
  });

  it('lists attachments and counts them on the Ações grid', async () => {
    const list = await withAuth(request(app).get(`/api/actions/${action.businessId}/attachments`), cookie);
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].original_name).toBe('relatório.txt');
    expect(list.body.items[0].content).toBeUndefined();

    const grid = await withAuth(request(app).get('/api/actions'), cookie);
    const item = grid.body.items.find((i) => i.uuid === action.uuid);
    expect(item.attachmentCount).toBe(1);
  });

  it('opens the file inline or downloads it', async () => {
    const url = `/api/actions/${action.businessId}/attachments/${attachmentId}/download`;
    const open = await withAuth(request(app).get(`${url}?inline=1`), cookie);
    expect(open.status).toBe(200);
    expect(open.headers['content-disposition']).toMatch(/^inline/);
    expect(open.text).toBe('conteúdo do anexo');

    const download = await withAuth(request(app).get(url), cookie);
    expect(download.headers['content-disposition']).toMatch(/^attachment/);
  });
});

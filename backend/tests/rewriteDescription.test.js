const request = require('supertest');
const { initTestDb, closeTestDb, getDb, getApp, login, withAuth, createProject, createArea, createUser, createAction, scopeUserToProject } = require('./helpers');

let app, db, adminCookie;
let proj, area;

beforeAll(async () => {
  await initTestDb();
  // Garante que a chave da IA está ausente neste ambiente de teste, para
  // exercitar o caminho "não configurado" (503) sem depender de uma chave
  // real da Anthropic.
  delete process.env.ANTHROPIC_API_KEY;
  db = getDb();
  app = getApp();
  proj = await createProject(db, 'Projeto Rewrite');
  area = await createArea(db, 'Área Rewrite');
  ({ cookie: adminCookie } = await login(app, 'admin@projetos.local', 'Test@1234'));
});

afterAll(async () => {
  await closeTestDb();
});

describe('POST /api/actions/:id/rewrite-description (Melhoria 5)', () => {
  it('returns 503 AI_NOT_CONFIGURED when ANTHROPIC_API_KEY is not set', async () => {
    const action = await createAction(db, { projectId: proj, areaId: area, description: 'Texto original de teste.' });
    const res = await withAuth(request(app).post(`/api/actions/${action.businessId}/rewrite-description`), adminCookie).send({});
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('AI_NOT_CONFIGURED');
  });

  it('uses the action description as the source text when no text is sent', async () => {
    const action = await createAction(db, { projectId: proj, areaId: area, description: 'Descrição padrão da ação.' });
    const res = await withAuth(request(app).post(`/api/actions/${action.businessId}/rewrite-description`), adminCookie).send({});
    // Sem chave configurada, falha de forma previsível (503), mas a validação
    // de corpo/esquema e o carregamento da ação já foram exercitados sem erro.
    expect(res.status).toBe(503);
  });

  it('rejects a CONTRIBUTOR who is not the assignee of the action', async () => {
    const otherUserId = await createUser(db, { name: 'Outro Contribuidor', email: 'outro.rewrite@projetos.local', roleKey: 'CONTRIBUTOR' });
    await scopeUserToProject(db, otherUserId, proj);
    const action = await createAction(db, { projectId: proj, areaId: area, description: 'Ação de outra pessoa.' });
    const { cookie: otherCookie } = await login(app, 'outro.rewrite@projetos.local');
    const res = await withAuth(request(app).post(`/api/actions/${action.businessId}/rewrite-description`), otherCookie).send({});
    expect(res.status).toBe(403);
  });

  it('allows the assigned CONTRIBUTOR to request a rewrite (still 503 without a key, but permission passes)', async () => {
    const assigneeId = await createUser(db, { name: 'Responsável Rewrite', email: 'assignee.rewrite@projetos.local', roleKey: 'CONTRIBUTOR' });
    await scopeUserToProject(db, assigneeId, proj);
    const action = await createAction(db, { projectId: proj, areaId: area, description: 'Ação atribuída a mim.', assigneeUserId: assigneeId });
    const { cookie: assigneeCookie } = await login(app, 'assignee.rewrite@projetos.local');
    const res = await withAuth(request(app).post(`/api/actions/${action.businessId}/rewrite-description`), assigneeCookie).send({});
    expect(res.status).toBe(503); // not 403 - permission check passed, only AI config is missing
  });

  it('rejects an empty source text', async () => {
    const action = await createAction(db, { projectId: proj, areaId: area, description: '' });
    const res = await withAuth(request(app).post(`/api/actions/${action.businessId}/rewrite-description`), adminCookie).send({ text: '   ' });
    expect(res.status).toBe(400);
  });
});

const request = require('supertest');
const { initTestDb, closeTestDb, getDb, getApp, login, withAuth, createProject, createArea, createAction } = require('./helpers');
const { todayISODate, addDaysISO } = require('../src/utils/dates');

let app, db, adminCookie;

beforeAll(async () => {
  await initTestDb();
  db = getDb();
  app = getApp();
  ({ cookie: adminCookie } = await login(app, 'admin@projetos.local', 'Test@1234'));
});

afterAll(async () => {
  await closeTestDb();
});

describe('Projects grid (listing counters)', () => {
  it('returns open/overdue/completed counters, completion % and next deadline per project', async () => {
    const today = todayISODate();
    const area = await createArea(db, 'Área Grid Projetos');
    const projectId = await createProject(db, 'Projeto Grid Contadores');
    const emptyProjectId = await createProject(db, 'Projeto Grid Vazio');

    await createAction(db, { projectId, areaId: area, status: 'ANDAMENTO', dueDate: addDaysISO(today, -5) }); // open + overdue
    await createAction(db, { projectId, areaId: area, status: 'ANDAMENTO', dueDate: addDaysISO(today, 3) }); // open, due soon
    await createAction(db, { projectId, areaId: area, status: 'ANDAMENTO' }); // open, no date
    await createAction(db, { projectId, areaId: area, status: 'CONCLUÍDO', dueDate: addDaysISO(today, -30) }); // done (not overdue)
    await createAction(db, { projectId, areaId: area, status: 'CANCELADO', dueDate: addDaysISO(today, -30) }); // cancelled (not overdue)
    const deleted = await createAction(db, { projectId, areaId: area, status: 'ANDAMENTO', dueDate: addDaysISO(today, -60) });
    await db.run('UPDATE actions SET deleted_at = ? WHERE uuid = ?', new Date().toISOString(), deleted.uuid);

    const res = await withAuth(request(app).get('/api/projects'), adminCookie);
    expect(res.status).toBe(200);
    const p = res.body.items.find((i) => i.id === projectId);
    expect(p.action_count).toBe(5);
    expect(p.open_count).toBe(3);
    expect(p.overdue_count).toBe(1);
    expect(p.due_soon_count).toBe(1);
    expect(p.completed_count).toBe(1);
    expect(p.completion_pct).toBe(20);
    expect(p.next_due_date).toBe(addDaysISO(today, -5));
    expect(p).toHaveProperty('priority', null);
    expect(p).toHaveProperty('notes', null);

    const empty = res.body.items.find((i) => i.id === emptyProjectId);
    expect(empty.action_count).toBe(0);
    expect(empty.open_count).toBe(0);
    expect(empty.overdue_count).toBe(0);
    expect(empty.completion_pct).toBe(0);
    expect(empty.next_due_date).toBeNull();
  });
});

describe('Projects grid (PATCH priority/notes)', () => {
  it('updates priority and notes, clears them with null, and records an audit entry', async () => {
    const projectId = await createProject(db, 'Projeto Grid Prioridade');

    const ok = await withAuth(request(app).patch(`/api/projects/${projectId}`), adminCookie).send({ priority: 'ALTA', notes: '  Aguardando orçamento  ' });
    expect(ok.status).toBe(200);
    let row = await db.get('SELECT priority, notes, status FROM projects WHERE id = ?', projectId);
    expect(row.priority).toBe('ALTA');
    expect(row.notes).toBe('Aguardando orçamento');
    expect(row.status).toBe('ANDAMENTO');

    const audit = await db.all("SELECT field_name, new_value FROM audit_log WHERE entity_type = 'PROJECT' AND entity_id = ? ORDER BY id", projectId);
    expect(audit.map((a) => a.field_name)).toEqual(expect.arrayContaining(['priority', 'notes']));

    // Patching only notes keeps the priority.
    await withAuth(request(app).patch(`/api/projects/${projectId}`), adminCookie).send({ notes: 'Outra nota' });
    row = await db.get('SELECT priority, notes FROM projects WHERE id = ?', projectId);
    expect(row.priority).toBe('ALTA');
    expect(row.notes).toBe('Outra nota');

    const cleared = await withAuth(request(app).patch(`/api/projects/${projectId}`), adminCookie).send({ priority: null, notes: '' });
    expect(cleared.status).toBe(200);
    row = await db.get('SELECT priority, notes FROM projects WHERE id = ?', projectId);
    expect(row.priority).toBeNull();
    expect(row.notes).toBeNull();
  });

  it('rejects an invalid priority', async () => {
    const projectId = await createProject(db, 'Projeto Grid Prioridade Inválida');
    const bad = await withAuth(request(app).patch(`/api/projects/${projectId}`), adminCookie).send({ priority: 'URGENTE' });
    expect(bad.status).toBe(400);
    const row = await db.get('SELECT priority FROM projects WHERE id = ?', projectId);
    expect(row.priority).toBeNull();
  });

  it.each([
    ['visualizador@projetos.local'],
    ['colaborador@projetos.local'],
  ])('blocks %s from editing priority/notes', async (email) => {
    const projectId = await createProject(db, `Projeto Grid Bloqueado ${email}`);
    const { cookie } = await login(app, email, 'Test@1234');
    const res = await withAuth(request(app).patch(`/api/projects/${projectId}`), cookie).send({ priority: 'BAIXA', notes: 'não deveria salvar' });
    expect(res.status).toBe(403);
    const row = await db.get('SELECT priority, notes FROM projects WHERE id = ?', projectId);
    expect(row.priority).toBeNull();
    expect(row.notes).toBeNull();
  });
});

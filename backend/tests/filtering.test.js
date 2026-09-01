const request = require('supertest');
const { initTestDb, getDb, getApp, login, withAuth, createProject, createArea, createAction } = require('./helpers');

let app, db, cookie;
let projA, projB, areaX, areaY;

beforeAll(async () => {
  initTestDb();
  db = getDb();
  app = getApp();

  projA = createProject(db, 'Projeto Filtro A');
  projB = createProject(db, 'Projeto Filtro B');
  areaX = createArea(db, 'Área Filtro X');
  areaY = createArea(db, 'Área Filtro Y');

  createAction(db, { projectId: projA, areaId: areaX, status: 'ANDAMENTO', refMonth: '2026-01-01', responsibleName: 'Ana' });
  createAction(db, { projectId: projA, areaId: areaY, status: 'CONCLUÍDO', refMonth: '2026-02-01', responsibleName: 'Bruno', completionDate: '2026-02-10' });
  createAction(db, { projectId: projB, areaId: areaX, status: 'EM ESTUDO', refMonth: '2026-01-01', responsibleName: 'Ana' });
  createAction(db, { projectId: projB, areaId: areaY, status: 'CANCELADO', refMonth: '2026-03-01', responsibleName: 'Carla' });

  ({ cookie } = await login(app, 'admin@projetos.local', 'Test@1234'));
});

async function query(qs) {
  return withAuth(request(app).get(`/api/actions?${qs}`), cookie);
}

describe('Action filters', () => {
  it('filters by a single project', async () => {
    const res = await query(`projectId=${projA}`);
    expect(res.body.items.every((i) => i.project.id === projA)).toBe(true);
    expect(res.body.total).toBe(2);
  });

  it('OR logic within the same category: multiple statuses', async () => {
    const res = await query('status=ANDAMENTO,CANCELADO');
    expect(res.body.total).toBe(2);
    const statuses = new Set(res.body.items.map((i) => i.status));
    expect(statuses.has('ANDAMENTO')).toBe(true);
    expect(statuses.has('CANCELADO')).toBe(true);
  });

  it('AND logic across categories: project AND status', async () => {
    const res = await query(`projectId=${projA}&status=CONCLU%C3%8DDO`);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].project.id).toBe(projA);
    expect(res.body.items[0].status).toBe('CONCLUÍDO');
  });

  it('filters by area', async () => {
    const res = await query(`areaId=${areaX}`);
    expect(res.body.total).toBe(2);
    expect(res.body.items.every((i) => i.area.id === areaX)).toBe(true);
  });

  it('filters by reference month', async () => {
    const res = await query('refMonth=2026-01');
    expect(res.body.total).toBe(2);
  });

  it('filters by year', async () => {
    const res = await query('year=2026');
    expect(res.body.total).toBe(4);
  });

  it('filters by responsible person', async () => {
    const res = await query('responsible=Ana');
    expect(res.body.total).toBe(2);
  });

  it('keyword search across description/observations', async () => {
    const res = await query('q=teste');
    expect(res.body.total).toBeGreaterThanOrEqual(4); // all fixture rows use the default "Ação de teste" description
  });

  it('combines project + area + status (AND) correctly returning zero when no match', async () => {
    const res = await query(`projectId=${projA}&areaId=${areaX}&status=CANCELADO`);
    expect(res.body.total).toBe(0);
  });
});

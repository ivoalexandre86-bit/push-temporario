const request = require('supertest');
const ExcelJS = require('exceljs');
const { initTestDb, closeTestDb, getDb, getApp, login, withAuth, createProject, createArea, createAction } = require('./helpers');

let app, db, cookie;
let proj, area;

beforeAll(async () => {
  await initTestDb();
  db = getDb();
  app = getApp();
  proj = await createProject(db, 'Projeto Export');
  area = await createArea(db, 'Área Export');
  await createAction(db, { projectId: proj, areaId: area, status: 'ANDAMENTO' });
  await createAction(db, { projectId: proj, areaId: area, status: 'CONCLUÍDO', completionDate: '2026-01-10' });
  await createAction(db, { projectId: proj, areaId: area, status: 'CANCELADO' });
  ({ cookie } = await login(app, 'admin@projetos.local', 'Test@1234'));
});

afterAll(async () => {
  await closeTestDb();
});

describe('Filter-aware exports', () => {
  it('exports CSV with Portuguese headers, only the filtered rows', async () => {
    const res = await withAuth(request(app).get(`/api/actions/export?format=csv&status=ANDAMENTO&projectId=${proj}`), cookie);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    const text = res.text;
    expect(text).toContain('ID;Projeto;Mês Ref.'); // Portuguese header row
    const dataLines = text.trim().split('\r\n').slice(1);
    expect(dataLines.length).toBe(1); // only the ANDAMENTO row
  });

  it('exports XLSX and embeds the applied filters as report metadata', async () => {
    const res = await withAuth(request(app).get(`/api/actions/export?format=xlsx&status=CONCLU%C3%8DDO&projectId=${proj}`), cookie).buffer(true).parse((response, cb) => {
      const chunks = [];
      response.on('data', (c) => chunks.push(c));
      response.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body);
    const sheet = wb.getWorksheet('Ações');
    expect(sheet).toBeTruthy();
    expect(sheet.rowCount).toBe(2); // header + 1 matching row

    const metaSheet = wb.getWorksheet('Filtros aplicados');
    expect(metaSheet).toBeTruthy();
  });

  it('records an EXPORT audit event with the applied filters', async () => {
    await withAuth(request(app).get(`/api/actions/export?format=csv&status=CANCELADO`), cookie);
    const row = await db.get("SELECT * FROM audit_log WHERE entity_type='EXPORT' ORDER BY id DESC LIMIT 1");
    expect(row).toBeTruthy();
    expect(row.new_value).toContain('CANCELADO');
  });
});

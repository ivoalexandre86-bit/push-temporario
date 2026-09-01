const path = require('path');
const { initTestDb, closeTestDb, getDb } = require('./helpers');

let db;

beforeAll(async () => {
  await initTestDb();
  db = getDb();
});

afterAll(async () => {
  await closeTestDb();
});

describe('Workbook import utility', () => {
  it('imports every valid row from the original PROJETOS.xlsx, preserving business IDs 1-401', async () => {
    const { run } = require('../scripts/import-xlsx');
    await run();

    const countRow = await db.get('SELECT COUNT(*) c FROM actions');
    expect(countRow.c).toBe(401);

    const idRows = await db.all('SELECT business_id FROM actions ORDER BY business_id');
    const ids = idRows.map((r) => r.business_id);
    expect(ids[0]).toBe(1);
    expect(ids[ids.length - 1]).toBe(401);
    expect(new Set(ids).size).toBe(401); // all unique, none reused

    const action1 = await db.get('SELECT * FROM actions WHERE business_id = 1');
    expect(action1.status).toBe('CONCLUÍDO');
    expect(action1.description).toContain('Barcaças');
  });

  it('is idempotent: running the import twice does not duplicate or renumber rows', async () => {
    const { run } = require('../scripts/import-xlsx');
    await run();
    const countRow = await db.get('SELECT COUNT(*) c FROM actions');
    expect(countRow.c).toBe(401);
  });

  it('flags data-quality exceptions instead of silently altering historical values', async () => {
    const flaggedRow = await db.get("SELECT COUNT(*) c FROM actions WHERE import_exceptions IS NOT NULL");
    expect(flaggedRow.c).toBeGreaterThan(0);

    const negativeLegacyRow = await db.get("SELECT COUNT(*) c FROM actions WHERE actual_hours_legacy < 0");
    expect(negativeLegacyRow.c).toBe(6);
    const flaggedNegativeRow = await db.get("SELECT COUNT(*) c FROM actions WHERE import_exceptions LIKE '%NEGATIVE_LEGACY_HOURS%'");
    expect(flaggedNegativeRow.c).toBe(negativeLegacyRow.c);
  });

  it('writes an import audit summary batch record', async () => {
    const batch = await db.get('SELECT * FROM import_batches ORDER BY id DESC LIMIT 1');
    expect(batch).toBeTruthy();
    expect(batch.total_rows).toBe(401);
    expect(batch.inserted_rows).toBeGreaterThanOrEqual(0); // 0 on the second (idempotent) run
    expect(JSON.parse(batch.summary_json)).toHaveProperty('exceptionsSummary');
  });

  it('preserves the full original project and area/process catalogs even for values not present in every row', async () => {
    const { PROJECTS, AREAS } = require('../src/data/catalogs');
    const projectRows = await db.all('SELECT name FROM projects');
    const areaRows = await db.all('SELECT name FROM areas');
    const projectNames = new Set(projectRows.map((r) => r.name));
    const areaNames = new Set(areaRows.map((r) => r.name));
    for (const p of PROJECTS) expect(projectNames.has(p)).toBe(true);
    for (const a of AREAS) expect(areaNames.has(a)).toBe(true);
  });
});

const path = require('path');
const { initTestDb, getDb } = require('./helpers');

let db;

beforeAll(() => {
  initTestDb();
  db = getDb();
});

describe('Workbook import utility', () => {
  it('imports every valid row from the original PROJETOS.xlsx, preserving business IDs 1-401', async () => {
    const { run } = require('../scripts/import-xlsx');
    await run();

    const count = db.prepare('SELECT COUNT(*) c FROM actions').get().c;
    expect(count).toBe(401);

    const ids = db.prepare('SELECT business_id FROM actions ORDER BY business_id').all().map((r) => r.business_id);
    expect(ids[0]).toBe(1);
    expect(ids[ids.length - 1]).toBe(401);
    expect(new Set(ids).size).toBe(401); // all unique, none reused

    const action1 = db.prepare('SELECT * FROM actions WHERE business_id = 1').get();
    expect(action1.status).toBe('CONCLUÍDO');
    expect(action1.description).toContain('Barcaças');
  });

  it('is idempotent: running the import twice does not duplicate or renumber rows', async () => {
    const { run } = require('../scripts/import-xlsx');
    await run();
    const count = db.prepare('SELECT COUNT(*) c FROM actions').get().c;
    expect(count).toBe(401);
  });

  it('flags data-quality exceptions instead of silently altering historical values', () => {
    const flagged = db.prepare("SELECT COUNT(*) c FROM actions WHERE import_exceptions IS NOT NULL").get().c;
    expect(flagged).toBeGreaterThan(0);

    const negativeLegacy = db.prepare("SELECT COUNT(*) c FROM actions WHERE actual_hours_legacy < 0").get().c;
    expect(negativeLegacy).toBe(6);
    const flaggedNegative = db.prepare("SELECT COUNT(*) c FROM actions WHERE import_exceptions LIKE '%NEGATIVE_LEGACY_HOURS%'").get().c;
    expect(flaggedNegative).toBe(negativeLegacy);
  });

  it('writes an import audit summary batch record', () => {
    const batch = db.prepare('SELECT * FROM import_batches ORDER BY id DESC LIMIT 1').get();
    expect(batch).toBeTruthy();
    expect(batch.total_rows).toBe(401);
    expect(batch.inserted_rows).toBeGreaterThanOrEqual(0); // 0 on the second (idempotent) run
    expect(JSON.parse(batch.summary_json)).toHaveProperty('exceptionsSummary');
  });

  it('preserves the full original project and area/process catalogs even for values not present in every row', () => {
    const { PROJECTS, AREAS } = require('../src/data/catalogs');
    const projectNames = new Set(db.prepare('SELECT name FROM projects').all().map((r) => r.name));
    const areaNames = new Set(db.prepare('SELECT name FROM areas').all().map((r) => r.name));
    for (const p of PROJECTS) expect(projectNames.has(p)).toBe(true);
    for (const a of AREAS) expect(areaNames.has(a)).toBe(true);
  });
});

#!/usr/bin/env node
// ============================================================================
// Import utility for the original "PROJETOS.xlsx" action-plan workbook.
//
//  - Preserves the original spreadsheet Action ID as the immutable
//    `business_id` (never reused, even for rejected/skipped rows).
//  - Normalizes catalog values (project, area/process) against the
//    canonical lists while never renaming/merging what was in the sheet:
//    only leading/trailing/duplicate whitespace is trimmed for matching.
//  - Flags, rather than silently "fixes", data-quality exceptions:
//    legacy hours pending confirmation, negative legacy hours, missing
//    completion date on CONCLUÍDO rows, free-text month/date formats.
//  - Rejects (does not insert) rows missing hard-required fields, and
//    records every rejection with a reason.
//  - Writes an import_batches row summarizing the run (import audit
//    summary), consumable from the Admin > Imports UI.
//
// Usage: node scripts/import-xlsx.js [path/to/workbook.xlsx]
// ============================================================================

require('dotenv').config();
const path = require('path');
const ExcelJS = require('exceljs');
const { v4: uuidv4 } = require('uuid');
const db = require('../src/db/connection');
const { parseRefMonth, parseDateCell, nowISO } = require('../src/utils/dates');
const { PROJECTS, AREAS, STATUSES } = require('../src/data/catalogs');

const SOURCE_FILE = process.argv[2] || path.join(__dirname, '..', 'data', 'seed', 'PROJETOS.xlsx');
const SHEET_NAME = 'Projetos';
const HEADER_ROW = 2; // row 1 is a merged title banner
const COLS = { ID: 1, PROJETO: 2, MES_REF: 3, AREA: 4, ACAO: 5, QUEM: 6, TEMPO: 7, INICIO: 8, FIM: 9, STATUS: 10, OBS: 11 };

function normalizeCatalogValue(raw) {
  if (raw == null) return null;
  return String(raw).replace(/\s+/g, ' ').trim();
}

function cellText(cell) {
  if (cell == null) return null;
  if (cell instanceof Date) return cell;
  if (typeof cell === 'object') {
    if (Array.isArray(cell.richText)) return cell.richText.map((run) => run.text).join(''); // rich text runs
    if (cell.text !== undefined) return cell.text;
    if (cell.result !== undefined) return cell.result; // formula
    if (cell.hyperlink !== undefined) return cell.text || cell.hyperlink;
  }
  return cell;
}

async function ensureCatalogs(tx) {
  for (const name of PROJECTS) {
    await tx.run('INSERT INTO projects (name, is_imported) VALUES (?, 1) ON CONFLICT (name) DO NOTHING', name);
  }
  for (const name of AREAS) {
    await tx.run('INSERT INTO areas (name, is_imported) VALUES (?, 1) ON CONFLICT (name) DO NOTHING', name);
  }
}

async function getOrCreateProject(tx, name) {
  let row = await tx.get('SELECT id FROM projects WHERE lower(name) = lower(?)', name);
  if (!row) {
    const info = await tx.run('INSERT INTO projects (name, is_imported) VALUES (?, 0) RETURNING id', name);
    row = { id: info.lastInsertRowid };
  }
  return row.id;
}

async function getOrCreateArea(tx, name) {
  let row = await tx.get('SELECT id FROM areas WHERE lower(name) = lower(?)', name);
  if (!row) {
    const info = await tx.run('INSERT INTO areas (name, is_imported) VALUES (?, 0) RETURNING id', name);
    row = { id: info.lastInsertRowid };
  }
  return row.id;
}

async function getOrCreatePerson(tx, name) {
  if (!name) return null;
  let row = await tx.get('SELECT id FROM people WHERE lower(name) = lower(?)', name);
  if (!row) {
    const info = await tx.run('INSERT INTO people (name) VALUES (?) RETURNING id', name);
    row = { id: info.lastInsertRowid };
  }
  return row.id;
}

async function run() {
  const startedAt = nowISO();
  const adminUser = await db.get(`
    SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id WHERE r.key = 'ADMIN' ORDER BY u.id LIMIT 1
  `);
  if (!adminUser) {
    console.error('[import] No ADMIN user found. Run `npm run seed` before importing.');
    process.exit(1);
  }

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(SOURCE_FILE);
  const sheet = wb.getWorksheet(SHEET_NAME);
  if (!sheet) {
    console.error(`[import] Sheet "${SHEET_NAME}" not found in ${SOURCE_FILE}`);
    process.exit(1);
  }

  const existingIdRows = await db.all('SELECT business_id FROM actions');
  const existingIds = new Set(existingIdRows.map((r) => r.business_id));

  let totalRows = 0;
  let inserted = 0;
  let skippedDuplicate = 0;
  const rejected = [];
  const exceptionsSummary = {};
  let maxRowSeen = 0;

  const rows = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber <= HEADER_ROW) return;
    rows.push({ row, rowNumber });
  });

  await db.transaction(async (tx) => {
    await ensureCatalogs(tx);

    for (const { row, rowNumber } of rows) {
      const idRaw = cellText(row.getCell(COLS.ID).value);
      if (idRaw == null || idRaw === '') continue; // blank spacer row, not a data row
      totalRows += 1;
      maxRowSeen = Math.max(maxRowSeen, rowNumber);

      const businessId = Number(idRaw);
      const projetoRaw = normalizeCatalogValue(cellText(row.getCell(COLS.PROJETO).value));
      const areaRaw = normalizeCatalogValue(cellText(row.getCell(COLS.AREA).value));
      const acao = cellText(row.getCell(COLS.ACAO).value);
      const quem = normalizeCatalogValue(cellText(row.getCell(COLS.QUEM).value));
      const tempoRaw = row.getCell(COLS.TEMPO).value;
      const statusRaw = normalizeCatalogValue(cellText(row.getCell(COLS.STATUS).value));
      const obs = cellText(row.getCell(COLS.OBS).value);

      const rowExceptions = [];

      if (!Number.isFinite(businessId)) { rejected.push({ row: rowNumber, id: idRaw, reason: 'ID inválido (não numérico).' }); continue; }
      if (existingIds.has(businessId)) { skippedDuplicate += 1; continue; }
      if (!projetoRaw) { rejected.push({ row: rowNumber, id: businessId, reason: 'Projeto ausente.' }); continue; }
      if (!areaRaw) { rejected.push({ row: rowNumber, id: businessId, reason: 'Área/Processo ausente.' }); continue; }
      if (!acao || !String(acao).trim()) { rejected.push({ row: rowNumber, id: businessId, reason: 'Descrição da ação ausente.' }); continue; }
      if (!statusRaw || !STATUSES.includes(statusRaw)) { rejected.push({ row: rowNumber, id: businessId, reason: `Status inválido: "${statusRaw}".` }); continue; }

      const refMonthValue = row.getCell(COLS.MES_REF).value;
      const refMonthParsed = parseRefMonth(refMonthValue instanceof Date ? refMonthValue : cellText(refMonthValue));
      if (!refMonthParsed || !refMonthParsed.refMonth) { rejected.push({ row: rowNumber, id: businessId, reason: 'Mês de referência inválido.' }); continue; }
      const refYear = Number(refMonthParsed.refMonth.slice(0, 4));
      if (typeof refMonthParsed.raw === 'string' && !(refMonthValue instanceof Date)) {
        rowExceptions.push('FREE_TEXT_MONTH_FORMAT');
      }

      const inicioValue = row.getCell(COLS.INICIO).value;
      const inicioParsed = parseDateCell(inicioValue instanceof Date ? inicioValue : cellText(inicioValue), refYear);
      if (inicioParsed.raw) rowExceptions.push('FREE_TEXT_START_DATE_FORMAT');

      const fimValue = row.getCell(COLS.FIM).value;
      const fimParsed = parseDateCell(fimValue instanceof Date ? fimValue : cellText(fimValue), refYear);
      if (fimParsed.raw) rowExceptions.push('FREE_TEXT_COMPLETION_DATE_FORMAT');

      let legacyHours = null;
      if (tempoRaw !== null && tempoRaw !== undefined && tempoRaw !== '') {
        legacyHours = Number(tempoRaw);
        if (Number.isFinite(legacyHours)) {
          rowExceptions.push('LEGACY_HOURS_REVIEW');
          if (legacyHours < 0) rowExceptions.push('NEGATIVE_LEGACY_HOURS');
        } else {
          legacyHours = null;
        }
      }

      if (statusRaw === 'CONCLUÍDO' && !fimParsed.date) {
        rowExceptions.push('MISSING_COMPLETION_DATE');
      }

      const projectId = await getOrCreateProject(tx, projetoRaw);
      const areaId = await getOrCreateArea(tx, areaRaw);
      const personId = await getOrCreatePerson(tx, quem);

      await tx.run(`
        INSERT INTO actions (
          uuid, business_id, project_id, ref_month, ref_month_raw, area_id, description,
          responsible_name, person_id, planned_hours, actual_hours_legacy, legacy_hours_confirmed,
          start_date, due_date, completion_date, status, observations, import_exceptions,
          source, created_by, updated_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, NULL, ?, ?, ?, ?, 'IMPORT', ?, ?)
      `,
        uuidv4(), businessId, projectId, refMonthParsed.refMonth, String(refMonthParsed.raw ?? ''),
        areaId, String(acao).trim(), quem || null, personId,
        null, // planned_hours: not present in the legacy sheet - left for users to set going forward
        legacyHours, inicioParsed.date, fimParsed.date, statusRaw, obs ? String(obs).trim() : null,
        rowExceptions.length ? JSON.stringify(rowExceptions) : null,
        adminUser.id, adminUser.id
      );

      inserted += 1;
      for (const ex of rowExceptions) exceptionsSummary[ex] = (exceptionsSummary[ex] || 0) + 1;
    }
  });

  const finishedAt = nowISO();
  let exceptionRows = 0;
  if (Object.values(exceptionsSummary).length) {
    const r = await db.get("SELECT COUNT(*) AS c FROM actions WHERE import_exceptions IS NOT NULL");
    exceptionRows = Number(r.c);
  }

  await db.run(`
    INSERT INTO import_batches (source_file, imported_by, started_at, finished_at, total_rows, inserted_rows, rejected_rows, exception_rows, summary_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    path.basename(SOURCE_FILE), adminUser.id, startedAt, finishedAt,
    totalRows, inserted, rejected.length, exceptionRows,
    JSON.stringify({ skippedDuplicate, exceptionsSummary, rejected }, null, 2)
  );

  console.log('[import] ===== Import summary =====');
  console.log(`[import] Source file:        ${SOURCE_FILE}`);
  console.log(`[import] Rows scanned:       ${totalRows}`);
  console.log(`[import] Rows inserted:      ${inserted}`);
  console.log(`[import] Rows skipped (dup): ${skippedDuplicate}`);
  console.log(`[import] Rows rejected:      ${rejected.length}`);
  console.log(`[import] Rows with exceptions flagged for review: ${exceptionRows}`);
  console.log('[import] Exceptions by type:', exceptionsSummary);
  if (rejected.length) {
    console.log('[import] Rejected rows detail:', JSON.stringify(rejected, null, 2));
  }
  console.log('[import] Done.');
}

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[import] Fatal error:', err);
      process.exit(1);
    });
}

module.exports = { run };

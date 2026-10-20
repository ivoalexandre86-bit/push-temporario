// Importação inteligente de Excel para os cadastros de logística.
//
// Fluxo (sem estado no servidor — o navegador reenvia o arquivo a cada passo):
//   1. analyzeWorkbook(buffer)          -> abas, cabeçalhos, amostra, sugestão de destino e mapeamento
//   2. buildPlan(...)                   -> pré-visualização linha a linha (novo / atualizar / sem
//                                          alteração / já existe / duplicado / rejeitado) + avisos
//   3. commitPlan(...)                  -> grava tudo numa única transação e registra o histórico
//
// O plano é recalculado no passo 3 e comparado com o hash do passo 2: se os
// dados do banco mudaram nesse meio-tempo, a importação é recusada para que
// o usuário revise de novo (nada é sobrescrito sem ele ter visto).
const crypto = require('crypto');
const ExcelJS = require('exceljs');
const { TARGETS, dataFields } = require('./fields');
const N = require('./normalize');
const { AppError } = require('../../middleware/errorHandler');

const MAX_ROWS = 5000;
const HEADER_SCAN_ROWS = 15;

// ---------------------------------------------------------------------------
// 1. Leitura das abas
// ---------------------------------------------------------------------------

function cellRaw(cell) {
  const v = cell?.value;
  if (v === null || v === undefined) return null;
  if (typeof v === 'object' && !(v instanceof Date)) {
    if (Array.isArray(v.richText)) return v.richText.map((r) => r.text).join('');
    if (v.text !== undefined) return typeof v.text === 'object' ? cellRaw({ value: v.text }) : v.text; // hyperlink
    if (v.result !== undefined) return v.result; // formula
    if (v.error) return null;
  }
  return v;
}

async function loadWorkbook(buffer) {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch (err) {
    throw new AppError(400, 'INVALID_FILE', 'Não foi possível ler o arquivo. Envie uma planilha Excel (.xlsx) válida.');
  }
  return wb;
}

/** Reads one worksheet: finds the header row and returns columns + data rows. */
function readSheet(ws) {
  const rawRows = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const cells = {};
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const raw = cellRaw(cell);
      if (N.cleanText(raw) !== null) cells[colNumber] = raw;
    });
    if (Object.keys(cells).length) rawRows.push({ rowNumber, cells });
  });

  // Header = first row (among the first ones) with at least two text cells.
  const headerRow = rawRows.slice(0, HEADER_SCAN_ROWS).find((r) => Object.values(r.cells).filter((v) => typeof v === 'string' && N.cleanText(v)).length >= 2);
  if (!headerRow) return { name: ws.name, headerRowNumber: null, columns: [], rows: [] };

  const seen = new Map();
  const columns = Object.keys(headerRow.cells)
    .map(Number)
    .sort((a, b) => a - b)
    .map((index) => {
      const label = N.cleanText(headerRow.cells[index]);
      const key = N.headerKey(label);
      const occurrence = (seen.get(key) || 0) + 1;
      seen.set(key, occurrence);
      return { index, label, key, occurrence };
    });
  const colSet = new Set(columns.map((c) => c.index));

  const rows = rawRows
    .filter((r) => r.rowNumber > headerRow.rowNumber)
    .map((r) => ({ rowNumber: r.rowNumber, cells: Object.fromEntries(Object.entries(r.cells).filter(([i]) => colSet.has(Number(i)))) }))
    .filter((r) => Object.keys(r.cells).length > 0);

  // Disambiguate repeated headers for display: "Email", "Email (2)", ...
  const totals = new Map();
  for (const c of columns) totals.set(c.key, (totals.get(c.key) || 0) + 1);
  for (const c of columns) c.displayLabel = totals.get(c.key) > 1 ? `${c.label} (${c.occurrence})` : c.label;

  return { name: ws.name, headerRowNumber: headerRow.rowNumber, columns, rows };
}

/** Auto-maps spreadsheet columns to the target's fields. Returns { fieldKey: columnIndex }. */
function autoMap(targetKey, columns) {
  const mapping = {};
  const usedCols = new Set();
  for (const field of TARGETS[targetKey].fields) {
    for (const alias of field.aliases || []) {
      const a = typeof alias === 'string' ? { key: N.headerKey(alias) } : { key: N.headerKey(alias.key), occurrence: alias.occurrence };
      const col = columns.find((c) => !usedCols.has(c.index) && c.key === a.key && (!a.occurrence || c.occurrence === a.occurrence));
      if (col) {
        mapping[field.key] = col.index;
        usedCols.add(col.index);
        break;
      }
    }
  }
  return mapping;
}

function scoreTarget(targetKey, mapping) {
  const fields = TARGETS[targetKey].fields;
  const missingRequired = fields.filter((f) => f.required && mapping[f.key] === undefined).length;
  return { matched: Object.keys(mapping).length, missingRequired };
}

async function analyzeWorkbook(buffer) {
  const wb = await loadWorkbook(buffer);
  const sheets = [];
  wb.eachSheet((ws) => {
    const sheet = readSheet(ws);
    const mappings = {};
    let best = null;
    for (const targetKey of Object.keys(TARGETS)) {
      const mapping = autoMap(targetKey, sheet.columns);
      mappings[targetKey] = mapping;
      const score = scoreTarget(targetKey, mapping);
      if (score.missingRequired === 0 && score.matched >= 2 && (!best || score.matched > best.matched)) best = { targetKey, ...score };
    }
    sheets.push({
      name: sheet.name,
      headerRowNumber: sheet.headerRowNumber,
      rowCount: sheet.rows.length,
      columns: sheet.columns.map(({ index, label, displayLabel }) => ({
        index,
        label: displayLabel,
        originalLabel: label,
        samples: sheet.rows.map((r) => N.cleanText(r.cells[index])).filter(Boolean).slice(0, 3),
      })),
      suggestedTarget: best?.targetKey || null,
      mappings,
    });
  });
  return { sheets };
}

async function readSheetByName(buffer, sheetName) {
  const wb = await loadWorkbook(buffer);
  const ws = wb.worksheets.find((w) => w.name === sheetName);
  if (!ws) throw new AppError(400, 'SHEET_NOT_FOUND', `A aba "${sheetName}" não existe no arquivo enviado.`);
  const sheet = readSheet(ws);
  if (sheet.rows.length > MAX_ROWS) throw new AppError(400, 'TOO_MANY_ROWS', `A aba tem ${sheet.rows.length} linhas; o limite por importação é ${MAX_ROWS}.`);
  return sheet;
}

// ---------------------------------------------------------------------------
// 2. Plano (pré-visualização)
// ---------------------------------------------------------------------------

const DEFAULT_OPTIONS = {
  mode: 'INSERT_ONLY',            // INSERT_ONLY | UPSERT
  placeholdersAsEmpty: true,      // "NA", "-", "Não tem" -> vazio
  keepExistingWhenEmpty: true,    // na atualização, célula vazia não apaga o valor atual
  duplicateStrategy: 'MERGE',     // linhas repetidas na planilha: MERGE (completa campos vazios) | FIRST
  createMissingRegions: false,    // filiais/transportadores: cadastrar regional inexistente
};

function normalizeOptions(raw = {}) {
  const o = { ...DEFAULT_OPTIONS, ...raw };
  return {
    mode: o.mode === 'UPSERT' ? 'UPSERT' : 'INSERT_ONLY',
    placeholdersAsEmpty: o.placeholdersAsEmpty !== false,
    keepExistingWhenEmpty: o.keepExistingWhenEmpty !== false,
    duplicateStrategy: o.duplicateStrategy === 'FIRST' ? 'FIRST' : 'MERGE',
    createMissingRegions: o.createMissingRegions === true,
  };
}

function validateMapping(targetKey, mapping, columns) {
  const target = TARGETS[targetKey];
  if (!target) throw new AppError(400, 'INVALID_TARGET', 'Destino de importação inválido.');
  const colSet = new Set(columns.map((c) => c.index));
  const clean = {};
  const usedCols = new Map();
  for (const field of target.fields) {
    const raw = mapping?.[field.key];
    if (raw === undefined || raw === null || raw === '') continue;
    const index = Number(raw);
    if (!colSet.has(index)) throw new AppError(400, 'INVALID_MAPPING', `A coluna escolhida para "${field.label}" não existe na aba.`);
    if (usedCols.has(index)) throw new AppError(400, 'INVALID_MAPPING', `A mesma coluna foi escolhida para "${usedCols.get(index)}" e "${field.label}".`);
    usedCols.set(index, field.label);
    clean[field.key] = index;
  }
  const missing = target.fields.filter((f) => f.required && clean[f.key] === undefined);
  if (missing.length) {
    throw new AppError(400, 'MAPPING_INCOMPLETE', `Escolha a coluna da planilha para: ${missing.map((f) => f.label).join(', ')}.`);
  }
  if (targetKey === 'CARRIERS' && clean.branchName === undefined && clean.cnpj === undefined) {
    throw new AppError(400, 'MAPPING_INCOMPLETE', 'Escolha a coluna de "Nome da Filial" ou de "CNPJ" para identificar a unidade atendida.');
  }
  return clean;
}

/** Converts one cell to the stored value, collecting warnings. */
function convertValue(field, raw, options, warnings) {
  let value = N.cleanText(raw);
  if (value === null) return null;
  if (options.placeholdersAsEmpty && N.isPlaceholder(value)) {
    warnings.placeholders.push(field.label);
    return null;
  }
  switch (field.kind) {
    case 'cnpj': {
      const digits = N.digitsOnly(value);
      if (digits.length === 14 && N.isValidCnpj(digits)) return N.formatCnpj(digits);
      warnings.list.push(`CNPJ "${value}" inválido (dígitos ou dígito verificador); mantido como está.`);
      return value;
    }
    case 'zip': {
      const { value: zip, warning } = N.normalizeZip(raw);
      if (warning) warnings.list.push(warning);
      return zip;
    }
    case 'uf': {
      const uf = value.toUpperCase();
      if (!N.UFS.has(uf)) warnings.list.push(`UF "${value}" não é uma sigla de estado válida.`);
      return uf;
    }
    case 'email': {
      const parts = value.split(/\s*(?:\/|;|,|\se\s)\s*/i).filter(Boolean);
      const bad = parts.filter((p) => !N.isValidEmail(p));
      if (bad.length) warnings.list.push(`${field.label}: "${bad.join(', ')}" não parece um e-mail válido.`);
      return value;
    }
    default:
      return value;
  }
}

async function loadExisting(db, targetKey) {
  const regions = await db.all('SELECT id, name, dedupe_key FROM regions WHERE deleted_at IS NULL');
  const regionByKey = new Map(regions.map((r) => [r.dedupe_key, r]));
  const out = { regionByKey, byKey: new Map(), branchByKey: new Map() };
  if (targetKey === 'REGIONS') {
    const rows = await db.all('SELECT * FROM region_contacts WHERE deleted_at IS NULL');
    for (const r of rows) out.byKey.set(r.dedupe_key, r);
  } else {
    const table = TARGETS[targetKey].table;
    const rows = await db.all(`SELECT * FROM ${table} WHERE deleted_at IS NULL`);
    for (const r of rows) out.byKey.set(r.dedupe_key, r);
  }
  if (targetKey === 'CARRIERS') {
    const branches = await db.all('SELECT id, region_id, dedupe_key, branch_name FROM branches WHERE deleted_at IS NULL');
    for (const b of branches) out.branchByKey.set(b.dedupe_key, b);
  }
  return out;
}

function rowKey(targetKey, v, regionName) {
  if (targetKey === 'REGIONS') return v.department ? N.contactKey(regionName, v.department) : `regiao:${N.regionKey(regionName)}`;
  const parts = { cnpjDigits: N.digitsOnly(v.cnpj), branchCode: v.branchCode, branchName: v.branchName, regionName };
  return targetKey === 'BRANCHES' ? N.branchKey(parts) : N.carrierKey({ ...parts, carrierName: v.carrierName });
}

/**
 * Builds the full import plan. Pure apart from reading the current DB state.
 * Every row ends in exactly one status:
 *   INSERT, UPDATE, UNCHANGED, SKIPPED_EXISTS, DUPLICATE (merged/ignored), REJECTED
 */
async function buildPlan({ db, buffer, sheetName, targetKey, mapping: rawMapping, options: rawOptions }) {
  const target = TARGETS[targetKey];
  if (!target) throw new AppError(400, 'INVALID_TARGET', 'Destino de importação inválido.');
  const sheet = await readSheetByName(buffer, sheetName);
  const mapping = validateMapping(targetKey, rawMapping, sheet.columns);
  const options = normalizeOptions(rawOptions);
  const existing = await loadExisting(db, targetKey);
  const fields = target.fields.filter((f) => mapping[f.key] !== undefined);
  const storedFields = dataFields(targetKey).filter((f) => mapping[f.key] !== undefined);

  const newRegions = new Map(); // regionKey -> name
  const firstByKey = new Map(); // key -> planned row (first occurrence in the file)
  const rows = [];

  for (const src of sheet.rows) {
    const warnings = { list: [], placeholders: [] };
    const errors = [];
    const values = {};
    for (const f of fields) {
      values[f.key] = convertValue(f, src.cells[mapping[f.key]], options, warnings);
    }
    const regionName = values.region;
    delete values.region;

    // Required identification
    if (!regionName) errors.push('Regional não informada.');
    for (const f of fields) if (f.required && f.key !== 'region' && !values[f.key]) errors.push(`${f.label} não informado(a).`);
    if (targetKey === 'CARRIERS' && !values.branchName && !values.cnpj) errors.push('Informe o nome da filial ou o CNPJ da unidade atendida.');
    if (targetKey === 'REGIONS' && !values.department && (values.name || values.email || values.phone || values.mobile || values.voiceChannel)) {
      errors.push('Contato sem departamento: informe o departamento (ex.: Regionais, Programador).');
    }

    // Region lookup
    let region = null;
    let regionIsNew = false;
    if (regionName) {
      const rk = N.regionKey(regionName);
      region = existing.regionByKey.get(rk) || null;
      if (!region) {
        if (targetKey === 'REGIONS' || options.createMissingRegions) {
          regionIsNew = true;
          if (targetKey !== 'REGIONS') warnings.list.push(`A regional "${regionName}" será cadastrada.`);
        } else {
          errors.push(`Regional "${regionName}" não cadastrada. Importe a aba de regionais antes ou marque "Cadastrar regionais que ainda não existem".`);
        }
      }
    }

    if (warnings.placeholders.length) {
      warnings.list.unshift(`Valores "NA", "-" ou "Não tem" tratados como vazios em: ${[...new Set(warnings.placeholders)].join(', ')}.`);
    }

    const row = {
      rowNumber: src.rowNumber,
      status: null,
      key: null,
      regionName: regionName || null,
      regionId: region?.id ?? null,
      regionIsNew,
      values,
      changes: [],
      errors,
      warnings: warnings.list,
      duplicateOf: null,
      label: values.branchName || values.carrierName || values.name || regionName || null,
    };

    if (errors.length) {
      row.status = 'REJECTED';
      rows.push(row);
      continue;
    }
    if (regionIsNew && !newRegions.has(N.regionKey(regionName))) newRegions.set(N.regionKey(regionName), regionName);

    row.key = rowKey(targetKey, values, regionName);

    // Repeated in the spreadsheet itself
    const first = firstByKey.get(row.key);
    if (first) {
      row.status = 'DUPLICATE';
      row.duplicateOf = first.rowNumber;
      if (options.duplicateStrategy === 'MERGE') {
        const filled = [];
        for (const f of storedFields) {
          if ((first.values[f.key] === null || first.values[f.key] === undefined) && values[f.key] !== null && values[f.key] !== undefined) {
            first.values[f.key] = values[f.key];
            filled.push(f.label);
          }
        }
        row.warnings.push(filled.length
          ? `Repete a linha ${first.rowNumber}; os campos vazios dela foram completados com: ${filled.join(', ')}.`
          : `Repete a linha ${first.rowNumber}; nada novo a aproveitar, linha ignorada.`);
        first.mergedFrom = [...(first.mergedFrom || []), src.rowNumber];
      } else {
        row.warnings.push(`Repete a linha ${first.rowNumber}; linha ignorada.`);
      }
      rows.push(row);
      continue;
    }
    firstByKey.set(row.key, row);
    rows.push(row);
  }

  // Resolve status of each first occurrence against the database (after merges).
  for (const row of rows) {
    if (row.status) continue;
    if (targetKey === 'CARRIERS') {
      const bk = N.branchKey({ cnpjDigits: N.digitsOnly(row.values.cnpj), branchCode: row.values.branchCode, branchName: row.values.branchName, regionName: row.regionName });
      const branch = existing.branchByKey.get(bk);
      row.branchId = branch?.id ?? null;
      if (!branch) row.warnings.push('Unidade não encontrada no cadastro de filiais; o transportador fica sem filial vinculada.');
      else if (row.regionId && branch.region_id !== row.regionId) row.warnings.push('A filial vinculada pertence a outra regional no cadastro.');
    }
    if (targetKey === 'REGIONS' && !row.values.department) {
      // Only the region itself
      row.status = row.regionIsNew ? 'INSERT' : (options.mode === 'UPSERT' ? 'UNCHANGED' : 'SKIPPED_EXISTS');
      continue;
    }
    const current = existing.byKey.get(row.key);
    if (!current) {
      row.status = 'INSERT';
      continue;
    }
    row.existingId = current.id;
    if (options.mode === 'INSERT_ONLY') {
      row.status = 'SKIPPED_EXISTS';
      continue;
    }
    for (const f of storedFields) {
      const next = row.values[f.key] ?? null;
      const prev = current[f.column] ?? null;
      if (next === null && options.keepExistingWhenEmpty) continue;
      if (String(prev ?? '') !== String(next ?? '')) row.changes.push({ field: f.key, label: f.label, column: f.column, oldValue: prev, newValue: next });
    }
    if (targetKey === 'CARRIERS' && row.branchId && current.branch_id !== row.branchId) {
      row.changes.push({ field: 'branchId', label: 'Filial vinculada', column: 'branch_id', oldValue: current.branch_id, newValue: row.branchId });
    }
    row.status = row.changes.length ? 'UPDATE' : 'UNCHANGED';
  }

  const summary = { total: rows.length, INSERT: 0, UPDATE: 0, UNCHANGED: 0, SKIPPED_EXISTS: 0, DUPLICATE: 0, REJECTED: 0, withWarnings: 0 };
  for (const r of rows) {
    summary[r.status] += 1;
    if (r.warnings.length) summary.withWarnings += 1;
  }
  summary.newRegions = [...newRegions.values()];

  const planHash = crypto.createHash('sha1').update(JSON.stringify({
    targetKey, sheetName, mapping, options,
    rows: rows.map((r) => [r.rowNumber, r.status, r.key, r.values, r.changes, r.existingId ?? null, r.branchId ?? null]),
    newRegions: summary.newRegions,
  })).digest('hex');

  return { targetKey, sheetName, mapping, options, rows, summary, planHash, newRegions };
}

// ---------------------------------------------------------------------------
// 3. Gravação
// ---------------------------------------------------------------------------

function columnsAndValues(targetKey, values) {
  const cols = [];
  const vals = [];
  for (const f of dataFields(targetKey)) {
    if (values[f.key] !== undefined) {
      cols.push(f.column);
      vals.push(values[f.key]);
    }
  }
  return { cols, vals };
}

async function commitPlan({ tx, plan, user, fileName, auditService, req }) {
  const now = new Date().toISOString();
  const { targetKey } = plan;
  const target = TARGETS[targetKey];
  const result = { inserted: 0, updated: 0, unchanged: 0, skipped: 0, rejected: 0, regionsCreated: 0 };

  // Regions first
  const regionIdByKey = new Map();
  for (const [rk, name] of plan.newRegions) {
    const info = await tx.run(
      "INSERT INTO regions (name, dedupe_key, source, created_by, updated_by, created_at, updated_at) VALUES (?, ?, 'IMPORT', ?, ?, ?, ?) RETURNING id",
      name, rk, user.id, user.id, now, now,
    );
    regionIdByKey.set(rk, info.lastInsertRowid);
    result.regionsCreated += 1;
    await auditService.record({ entityType: 'REGION', entityId: info.lastInsertRowid, actionType: 'CREATE', newValue: name, actor: user, req, tx });
  }
  const regionIdOf = (row) => row.regionId ?? regionIdByKey.get(N.regionKey(row.regionName));

  for (const row of plan.rows) {
    if (row.status === 'REJECTED') { result.rejected += 1; continue; }
    if (row.status === 'DUPLICATE' || row.status === 'SKIPPED_EXISTS') { result.skipped += 1; continue; }
    if (row.status === 'UNCHANGED') { result.unchanged += 1; continue; }
    if (targetKey === 'REGIONS' && !row.values.department) {
      if (row.status === 'INSERT') result.inserted += 1;
      continue;
    }
    const regionId = regionIdOf(row);

    if (row.status === 'INSERT') {
      const { cols, vals } = columnsAndValues(targetKey, row.values);
      const extraCols = ['region_id', 'dedupe_key', 'source', 'created_by', 'updated_by', 'created_at', 'updated_at'];
      const extraVals = [regionId, row.key, 'IMPORT', user.id, user.id, now, now];
      if (targetKey === 'BRANCHES' || targetKey === 'CARRIERS') {
        extraCols.push('cnpj_digits');
        extraVals.push(N.digitsOnly(row.values.cnpj) || null);
      }
      if (targetKey === 'CARRIERS') {
        extraCols.push('branch_id', 'carrier_key');
        extraVals.push(row.branchId ?? null, N.normalizeKey(row.values.carrierName));
      }
      const table = targetKey === 'REGIONS' ? 'region_contacts' : target.table;
      const allCols = [...cols, ...extraCols];
      const info = await tx.run(
        `INSERT INTO ${table} (${allCols.join(', ')}) VALUES (${allCols.map(() => '?').join(', ')}) RETURNING id`,
        ...vals, ...extraVals,
      );
      result.inserted += 1;
      await auditService.record({ entityType: target.entityType, entityId: info.lastInsertRowid, actionType: 'CREATE', newValue: row.label, actor: user, req, tx });
      continue;
    }

    if (row.status === 'UPDATE') {
      const table = targetKey === 'REGIONS' ? 'region_contacts' : target.table;
      const sets = row.changes.map((c) => `${c.column} = ?`);
      const vals = row.changes.map((c) => c.newValue);
      if (targetKey !== 'REGIONS' && row.changes.some((c) => c.column === 'cnpj')) {
        sets.push('cnpj_digits = ?');
        vals.push(N.digitsOnly(row.values.cnpj) || null);
      }
      if (targetKey === 'CARRIERS' && row.changes.some((c) => c.column === 'carrier_name')) {
        sets.push('carrier_key = ?');
        vals.push(N.normalizeKey(row.values.carrierName));
      }
      await tx.run(
        `UPDATE ${table} SET ${sets.join(', ')}, updated_by = ?, updated_at = ? WHERE id = ?`,
        ...vals, user.id, now, row.existingId,
      );
      result.updated += 1;
      for (const c of row.changes) {
        await auditService.record({
          entityType: target.entityType, entityId: row.existingId, actionType: 'UPDATE',
          fieldName: c.column, oldValue: c.oldValue, newValue: c.newValue, actor: user, req, tx,
        });
      }
    }
  }

  const summaryJson = {
    regionsCreated: plan.summary.newRegions,
    rejected: plan.rows.filter((r) => r.status === 'REJECTED').map((r) => ({ rowNumber: r.rowNumber, errors: r.errors })),
    duplicates: plan.rows.filter((r) => r.status === 'DUPLICATE').map((r) => ({ rowNumber: r.rowNumber, duplicateOf: r.duplicateOf })),
    warnings: plan.rows.filter((r) => r.warnings.length).map((r) => ({ rowNumber: r.rowNumber, warnings: r.warnings })),
  };

  const batch = await tx.run(`
    INSERT INTO logistics_import_batches
      (target, source_file, sheet_name, mode, imported_by, imported_by_name, started_at, finished_at,
       total_rows, inserted_rows, updated_rows, unchanged_rows, skipped_rows, rejected_rows,
       mapping_json, options_json, summary_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  targetKey, fileName || 'planilha.xlsx', plan.sheetName, plan.options.mode, user.id, user.name, now, new Date().toISOString(),
  plan.rows.length, result.inserted, result.updated, result.unchanged, result.skipped, result.rejected,
  JSON.stringify(plan.mapping), JSON.stringify(plan.options), JSON.stringify(summaryJson));

  await auditService.record({
    entityType: 'IMPORT', entityId: `logistics:${batch.lastInsertRowid}`, actionType: 'IMPORT',
    newValue: { target: targetKey, file: fileName, sheet: plan.sheetName, ...result }, actor: user, req, tx,
  });

  return { batchId: batch.lastInsertRowid, ...result };
}

module.exports = { analyzeWorkbook, buildPlan, commitPlan, autoMap, readSheet, normalizeOptions, DEFAULT_OPTIONS };

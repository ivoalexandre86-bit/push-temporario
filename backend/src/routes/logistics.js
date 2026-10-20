// Cadastros de logística: Regionais (com contatos), Filiais e Transportadores,
// exportação para Excel/CSV e importação inteligente de planilha.
//
//   GET    /api/logistics/regions                 lista (com contagens)
//   GET    /api/logistics/regions/:id             detalhe (contatos, filiais, transportadores)
//   POST   /api/logistics/regions                 { name, notes }
//   PATCH  /api/logistics/regions/:id
//   DELETE /api/logistics/regions/:id             (lógica; recusa com vínculos ativos)
//   POST   /api/logistics/regions/:id/contacts    contatos por departamento
//   PATCH  /api/logistics/contacts/:id
//   DELETE /api/logistics/contacts/:id
//   GET|POST|PATCH|DELETE /api/logistics/branches[/:id]
//   GET|POST|PATCH|DELETE /api/logistics/carriers[/:id]
//   POST   /api/logistics/{regions|branches|carriers}/bulk-delete  { ids }
//   GET    /api/logistics/{regions|branches|carriers}/export?format=xlsx|csv&ids=1,2
//   GET    /api/logistics/fields                  catálogo de campos (rótulos, grupos, tipos)
//   GET    /api/logistics/import/history
//   POST   /api/logistics/import/analyze | /import/preview | /import/commit   (multipart: file + campos)
const express = require('express');
const multer = require('multer');
const { z } = require('zod');
const db = require('../db/connection');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { PERMISSIONS } = require('../permissions');
const auditService = require('../services/auditService');
const { AppError } = require('../middleware/errorHandler');
const { toCSV, toXLSXBuffer, dateFmt } = require('../services/exportService');
const N = require('../services/logistics/normalize');
const { TARGETS, dataFields, publicTargets } = require('../services/logistics/fields');
const registry = require('../services/logistics/registry');
const importer = require('../services/logistics/importer');

const router = express.Router();
router.use(authenticate);

const canView = requirePermission(PERMISSIONS.LOGISTICS_VIEW);
const canManage = requirePermission(PERMISSIONS.LOGISTICS_MANAGE);
const canImport = requirePermission(PERMISSIONS.LOGISTICS_IMPORT);
const canExport = requirePermission(PERMISSIONS.REPORTS_EXPORT);

const idParam = (req) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new AppError(400, 'INVALID_ID', 'Identificador inválido.');
  return id;
};

const textOrNull = z.union([z.string().max(4000), z.number(), z.null()]).optional();
const idsSchema = z.object({ ids: z.array(z.number().int().positive()).min(1, 'Selecione ao menos um registro.').max(1000) });

function parseIds(query) {
  if (!query.ids) return null;
  const ids = String(query.ids).split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0);
  return ids.length ? ids : null;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

const REGION_LIST_SQL = `
  SELECT r.*,
    (SELECT COUNT(*) FROM branches b WHERE b.region_id = r.id AND b.deleted_at IS NULL) AS branch_count,
    (SELECT COUNT(*) FROM carriers c WHERE c.region_id = r.id AND c.deleted_at IS NULL) AS carrier_count,
    (SELECT COUNT(DISTINCT c.carrier_key) FROM carriers c WHERE c.region_id = r.id AND c.deleted_at IS NULL) AS carrier_company_count,
    (SELECT COUNT(*) FROM region_contacts rc WHERE rc.region_id = r.id AND rc.deleted_at IS NULL) AS contact_count
  FROM regions r
  WHERE r.deleted_at IS NULL`;

function shapeRegion(r, contacts = []) {
  return {
    id: r.id,
    name: r.name,
    notes: r.notes,
    source: r.source,
    branchCount: r.branch_count ?? undefined,
    carrierCount: r.carrier_count ?? undefined,
    carrierCompanyCount: r.carrier_company_count ?? undefined,
    contactCount: r.contact_count ?? undefined,
    contacts: contacts.map((c) => registry.toApi('REGIONS', c)),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

async function listContacts(regionIds) {
  if (!regionIds.length) return new Map();
  const rows = await db.all(
    `SELECT * FROM region_contacts WHERE deleted_at IS NULL AND region_id IN (${regionIds.map(() => '?').join(',')}) ORDER BY department, name`,
    ...regionIds,
  );
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.region_id)) map.set(r.region_id, []);
    map.get(r.region_id).push(r);
  }
  return map;
}

async function listRegions(ids = null) {
  const rows = await db.all(`${REGION_LIST_SQL}${ids ? ` AND r.id IN (${ids.map(() => '?').join(',')})` : ''} ORDER BY r.name`, ...(ids || []));
  const contacts = await listContacts(rows.map((r) => r.id));
  return rows.map((r) => shapeRegion(r, contacts.get(r.id) || []));
}

const BRANCH_SQL = `
  SELECT b.*, r.name AS region_name,
    (SELECT COUNT(*) FROM carriers c WHERE c.branch_id = b.id AND c.deleted_at IS NULL) AS carrier_count
  FROM branches b JOIN regions r ON r.id = b.region_id
  WHERE b.deleted_at IS NULL`;

const CARRIER_SQL = `
  SELECT c.*, r.name AS region_name, b.branch_name AS linked_branch_name
  FROM carriers c
  JOIN regions r ON r.id = c.region_id
  LEFT JOIN branches b ON b.id = c.branch_id AND b.deleted_at IS NULL
  WHERE c.deleted_at IS NULL`;

function buildFilter(base, alias, query) {
  const where = [];
  const params = [];
  const ids = parseIds(query);
  if (ids) { where.push(`${alias}.id IN (${ids.map(() => '?').join(',')})`); params.push(...ids); }
  if (query.regionId) {
    const regionIds = String(query.regionId).split(',').map(Number).filter(Boolean);
    if (regionIds.length) { where.push(`${alias}.region_id IN (${regionIds.map(() => '?').join(',')})`); params.push(...regionIds); }
  }
  if (query.branchId) { where.push(`${alias}.branch_id = ?`); params.push(Number(query.branchId)); }
  return { sql: `${base}${where.length ? ` AND ${where.join(' AND ')}` : ''}`, params };
}

async function listBranches(query = {}) {
  const { sql, params } = buildFilter(BRANCH_SQL, 'b', query);
  const rows = await db.all(`${sql} ORDER BY r.name, b.branch_name`, ...params);
  return rows.map((r) => registry.toApi('BRANCHES', r, { carrierCount: r.carrier_count }));
}

async function listCarriers(query = {}) {
  const { sql, params } = buildFilter(CARRIER_SQL, 'c', query);
  const rows = await db.all(`${sql} ORDER BY c.carrier_name, r.name, c.branch_name`, ...params);
  return rows.map((r) => registry.toApi('CARRIERS', r));
}

// ---------------------------------------------------------------------------
// Regions
// ---------------------------------------------------------------------------

router.get('/regions', canView, async (req, res, next) => {
  try {
    res.json({ items: await listRegions(parseIds(req.query)) });
  } catch (err) { next(err); }
});

router.get('/regions/:id(\\d+)', canView, async (req, res, next) => {
  try {
    const id = idParam(req);
    const [region] = await listRegions([id]);
    if (!region) throw new AppError(404, 'NOT_FOUND', 'Regional não encontrada.');
    res.json({ ...region, branches: await listBranches({ regionId: id }), carriers: await listCarriers({ regionId: id }) });
  } catch (err) { next(err); }
});

const regionSchema = z.object({
  name: z.string({ required_error: 'Informe o nome da regional.' }).trim().min(1, 'Informe o nome da regional.').max(200),
  notes: z.string().max(4000).nullable().optional(),
});

router.post('/regions', canManage, async (req, res, next) => {
  try {
    const body = regionSchema.parse(req.body);
    const name = N.cleanText(body.name);
    const key = N.regionKey(name);
    const id = await db.transaction(async (tx) => {
      const dup = await tx.get('SELECT id FROM regions WHERE dedupe_key = ? AND deleted_at IS NULL', key);
      if (dup) throw new AppError(409, 'DUPLICATE', 'Já existe uma regional com este nome.', { existingId: dup.id });
      const now = new Date().toISOString();
      const info = await tx.run(
        "INSERT INTO regions (name, dedupe_key, notes, source, created_by, updated_by, created_at, updated_at) VALUES (?, ?, ?, 'MANUAL', ?, ?, ?, ?) RETURNING id",
        name, key, N.cleanText(body.notes), req.user.id, req.user.id, now, now,
      );
      await auditService.record({ entityType: 'REGION', entityId: info.lastInsertRowid, actionType: 'CREATE', newValue: name, actor: req.user, req, tx });
      return info.lastInsertRowid;
    });
    res.status(201).json({ id });
  } catch (err) { next(err); }
});

router.patch('/regions/:id(\\d+)', canManage, async (req, res, next) => {
  try {
    const id = idParam(req);
    const body = regionSchema.partial().parse(req.body);
    await db.transaction(async (tx) => {
      const before = await registry.getRegion(tx, id);
      const name = body.name !== undefined ? N.cleanText(body.name) : before.name;
      const key = N.regionKey(name);
      const dup = await tx.get('SELECT id FROM regions WHERE dedupe_key = ? AND deleted_at IS NULL AND id <> ?', key, id);
      if (dup) throw new AppError(409, 'DUPLICATE', 'Já existe uma regional com este nome.', { existingId: dup.id });
      const notes = body.notes !== undefined ? N.cleanText(body.notes) : before.notes;
      await tx.run('UPDATE regions SET name = ?, dedupe_key = ?, notes = ?, updated_by = ?, updated_at = ? WHERE id = ?',
        name, key, notes, req.user.id, new Date().toISOString(), id);
      if (key !== before.dedupe_key) await registry.recomputeKeysForRegion(tx, id, name);
      await auditService.recordDiff({ entityType: 'REGION', entityId: id, before, after: { ...before, name, notes }, fieldsToTrack: ['name', 'notes'], actor: req.user, req, tx });
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.delete('/regions/:id(\\d+)', canManage, async (req, res, next) => {
  try {
    const id = idParam(req);
    const blocked = await db.transaction((tx) => registry.softDelete(tx, 'REGION', id, { user: req.user, auditService, req }));
    if (blocked) throw new AppError(blocked.includes('não encontrad') ? 404 : 409, blocked.includes('não encontrad') ? 'NOT_FOUND' : 'HAS_LINKS', blocked);
    res.status(204).end();
  } catch (err) { next(err); }
});

// Contacts of a region (one row per department in the "REGIONAIS" sheet)
const contactSchema = z.object(Object.fromEntries(dataFields('REGIONS').map((f) => [f.key, textOrNull])));

router.post('/regions/:id(\\d+)/contacts', canManage, async (req, res, next) => {
  try {
    const regionId = idParam(req);
    const body = contactSchema.parse(req.body);
    const id = await db.transaction((tx) => registry.saveRecord(tx, 'CONTACTS', { body: { ...body, regionId }, user: req.user, auditService, req }));
    res.status(201).json({ id });
  } catch (err) { next(err); }
});

router.patch('/contacts/:id(\\d+)', canManage, async (req, res, next) => {
  try {
    const id = idParam(req);
    const body = contactSchema.partial().parse(req.body);
    await db.transaction((tx) => registry.saveRecord(tx, 'CONTACTS', { id, body, user: req.user, auditService, req }));
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.delete('/contacts/:id(\\d+)', canManage, async (req, res, next) => {
  try {
    const id = idParam(req);
    const blocked = await db.transaction((tx) => registry.softDelete(tx, 'CONTACTS', id, { user: req.user, auditService, req }));
    if (blocked) throw new AppError(404, 'NOT_FOUND', blocked);
    res.status(204).end();
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Branches & carriers (same shape of routes)
// ---------------------------------------------------------------------------

function crudRoutes(path, entityKey, listFn) {
  const targetKey = registry.ENTITY[entityKey].target;
  const schema = z.object({
    regionId: z.number({ invalid_type_error: 'Selecione a regional.' }).int().positive('Selecione a regional.').optional(),
    ...(entityKey === 'CARRIERS' ? { branchId: z.number().int().positive().nullable().optional() } : {}),
    ...Object.fromEntries(dataFields(targetKey).map((f) => [f.key, textOrNull])),
  });

  router.get(`/${path}`, canView, async (req, res, next) => {
    try { res.json({ items: await listFn(req.query) }); } catch (err) { next(err); }
  });

  router.get(`/${path}/:id(\\d+)`, canView, async (req, res, next) => {
    try {
      const [item] = await listFn({ ids: String(idParam(req)) });
      if (!item) throw new AppError(404, 'NOT_FOUND', `${registry.ENTITY[entityKey].label} não encontrado(a).`);
      res.json(item);
    } catch (err) { next(err); }
  });

  router.post(`/${path}`, canManage, async (req, res, next) => {
    try {
      const body = schema.parse(req.body);
      if (!body.regionId) throw new AppError(400, 'VALIDATION_ERROR', 'Selecione a regional.', [{ path: 'regionId', message: 'Selecione a regional.' }]);
      const id = await db.transaction((tx) => registry.saveRecord(tx, entityKey, { body, user: req.user, auditService, req }));
      res.status(201).json({ id });
    } catch (err) { next(err); }
  });

  router.patch(`/${path}/:id(\\d+)`, canManage, async (req, res, next) => {
    try {
      const id = idParam(req);
      const body = schema.parse(req.body);
      await db.transaction((tx) => registry.saveRecord(tx, entityKey, { id, body, user: req.user, auditService, req }));
      res.json({ ok: true });
    } catch (err) { next(err); }
  });

  router.delete(`/${path}/:id(\\d+)`, canManage, async (req, res, next) => {
    try {
      const id = idParam(req);
      const blocked = await db.transaction((tx) => registry.softDelete(tx, entityKey, id, { user: req.user, auditService, req }));
      if (blocked) {
        const notFound = blocked.includes('não encontrad');
        throw new AppError(notFound ? 404 : 409, notFound ? 'NOT_FOUND' : 'HAS_LINKS', blocked);
      }
      res.status(204).end();
    } catch (err) { next(err); }
  });
}

crudRoutes('branches', 'BRANCHES', listBranches);
crudRoutes('carriers', 'CARRIERS', listCarriers);

// Bulk delete: each record is checked on its own; blocked ones are reported.
for (const [path, kind] of [['regions', 'REGION'], ['branches', 'BRANCHES'], ['carriers', 'CARRIERS']]) {
  router.post(`/${path}/bulk-delete`, canManage, async (req, res, next) => {
    try {
      const { ids } = idsSchema.parse(req.body);
      const result = { deleted: [], blocked: [] };
      for (const id of ids) {
        const blocked = await db.transaction((tx) => registry.softDelete(tx, kind, id, { user: req.user, auditService, req }));
        if (blocked) result.blocked.push({ id, reason: blocked });
        else result.deleted.push(id);
      }
      res.json(result);
    } catch (err) { next(err); }
  });
}

// ---------------------------------------------------------------------------
// Export (headers equal to the original spreadsheet, so it can be re-imported)
// ---------------------------------------------------------------------------

function exportColumns(targetKey, extra = []) {
  return [
    { key: 'regionName', header: 'Regional', width: 18 },
    ...dataFields(targetKey).map((f) => ({ key: f.key, header: f.header, width: f.kind === 'email' ? 32 : f.key === 'address' ? 48 : 22 })),
    ...extra,
  ];
}

async function sendExport(req, res, { rows, columns, sheetName, fileBase, entityId }) {
  const format = String(req.query.format || 'xlsx').toLowerCase();
  const meta = { 'Exportado em': new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }), Registros: rows.length };
  if (req.query.filters) meta['Filtros aplicados na tela'] = String(req.query.filters).slice(0, 2000);
  await auditService.record({ entityType: 'EXPORT', entityId, actionType: 'EXPORT', newValue: { format, rows: rows.length, ids: parseIds(req.query)?.length ?? 'todos' }, actor: req.user, req });
  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileBase}.csv"`);
    return res.send(Buffer.from(toCSV(rows, columns), 'utf8'));
  }
  const buf = await toXLSXBuffer(rows, columns, sheetName, meta);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${fileBase}.xlsx"`);
  res.send(Buffer.from(buf));
}

router.get('/regions/export', canView, canExport, async (req, res, next) => {
  try {
    const regions = await listRegions(parseIds(req.query));
    // One row per contact, like the "REGIONAIS" sheet; regions without contacts get one row.
    const rows = [];
    for (const r of regions) {
      if (!r.contacts.length) rows.push({ regionName: r.name });
      for (const c of r.contacts) rows.push({ ...c, regionName: r.name });
    }
    const columns = [
      { key: 'department', header: 'Departamento', width: 16 },
      { key: 'regionName', header: 'Regional', width: 18 },
      ...dataFields('REGIONS').filter((f) => f.key !== 'department').map((f) => ({ key: f.key, header: f.header, width: f.kind === 'email' ? 32 : 22 })),
    ];
    await sendExport(req, res, { rows, columns, sheetName: 'REGIONAIS', fileBase: 'regionais', entityId: 'regions' });
  } catch (err) { next(err); }
});

router.get('/branches/export', canView, canExport, async (req, res, next) => {
  try {
    const rows = await listBranches(req.query);
    await sendExport(req, res, {
      rows, columns: exportColumns('BRANCHES', [{ key: 'updatedAt', header: 'Última atualização', format: dateFmt, width: 16 }]),
      sheetName: 'Filiais', fileBase: 'filiais', entityId: 'branches',
    });
  } catch (err) { next(err); }
});

router.get('/carriers/export', canView, canExport, async (req, res, next) => {
  try {
    const rows = await listCarriers(req.query);
    await sendExport(req, res, {
      rows,
      columns: exportColumns('CARRIERS', [
        { key: 'linkedBranchName', header: 'Filial vinculada no cadastro', width: 28 },
        { key: 'updatedAt', header: 'Última atualização', format: dateFmt, width: 16 },
      ]),
      sheetName: 'TRANSPORTADOR', fileBase: 'transportadores', entityId: 'carriers',
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

const XLSX_MIME = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream',
  'application/zip',
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const okExt = /\.xlsx$/i.test(file.originalname || '');
    if (!okExt || !XLSX_MIME.has(file.mimetype)) return cb(new AppError(400, 'INVALID_FILE_TYPE', 'Envie uma planilha Excel no formato .xlsx.'));
    cb(null, true);
  },
});

function decodeName(name) {
  const decoded = Buffer.from(name || '', 'latin1').toString('utf8');
  return decoded.includes('�') ? name : decoded;
}

function requireFile(req) {
  if (!req.file) throw new AppError(400, 'FILE_REQUIRED', 'Selecione o arquivo Excel (.xlsx).');
  return req.file.buffer;
}

function parseJsonField(value, label) {
  if (value === undefined || value === null || value === '') return {};
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { throw new AppError(400, 'INVALID_FIELD', `Campo "${label}" inválido.`); }
}

function planArgs(req) {
  const targetKey = String(req.body.target || '');
  if (!TARGETS[targetKey]) throw new AppError(400, 'INVALID_TARGET', 'Escolha o cadastro de destino da importação.');
  const sheetName = String(req.body.sheetName ?? '');
  if (!sheetName) throw new AppError(400, 'SHEET_REQUIRED', 'Escolha a aba da planilha.');
  return {
    buffer: requireFile(req),
    targetKey,
    sheetName,
    mapping: parseJsonField(req.body.mapping, 'mapeamento'),
    options: parseJsonField(req.body.options, 'opções'),
  };
}

/** Plan as sent to the browser (no internal column names). */
function publicPlan(plan) {
  return {
    target: plan.targetKey,
    sheetName: plan.sheetName,
    options: plan.options,
    summary: plan.summary,
    planHash: plan.planHash,
    rows: plan.rows.map((r) => ({
      rowNumber: r.rowNumber,
      status: r.status,
      label: r.label,
      regionName: r.regionName,
      regionIsNew: r.regionIsNew,
      values: r.values,
      changes: r.changes.map(({ field, label, oldValue, newValue }) => ({ field, label, oldValue, newValue })),
      errors: r.errors,
      warnings: r.warnings,
      duplicateOf: r.duplicateOf,
      linkedBranch: r.branchId !== undefined ? Boolean(r.branchId) : undefined,
    })),
  };
}

// Field catalog: used by the grids/forms (view) and the import wizard.
router.get('/fields', canView, (req, res) => {
  res.json({ targets: publicTargets(), defaultOptions: importer.DEFAULT_OPTIONS });
});

router.get('/import/history', canView, async (req, res, next) => {
  try {
    const rows = await db.all('SELECT * FROM logistics_import_batches ORDER BY id DESC LIMIT 100');
    res.json({
      items: rows.map((b) => ({
        id: b.id,
        target: b.target,
        targetLabel: TARGETS[b.target]?.label || b.target,
        sourceFile: b.source_file,
        sheetName: b.sheet_name,
        mode: b.mode,
        importedBy: b.imported_by_name,
        startedAt: b.started_at,
        finishedAt: b.finished_at,
        totalRows: b.total_rows,
        insertedRows: b.inserted_rows,
        updatedRows: b.updated_rows,
        unchangedRows: b.unchanged_rows,
        skippedRows: b.skipped_rows,
        rejectedRows: b.rejected_rows,
        summary: (() => { try { return JSON.parse(b.summary_json || '{}'); } catch { return {}; } })(),
      })),
    });
  } catch (err) { next(err); }
});

router.post('/import/analyze', canImport, upload.single('file'), async (req, res, next) => {
  try {
    const result = await importer.analyzeWorkbook(requireFile(req));
    res.json({ fileName: decodeName(req.file.originalname), ...result });
  } catch (err) { next(err); }
});

router.post('/import/preview', canImport, upload.single('file'), async (req, res, next) => {
  try {
    const plan = await importer.buildPlan({ db, ...planArgs(req) });
    res.json(publicPlan(plan));
  } catch (err) { next(err); }
});

router.post('/import/commit', canImport, upload.single('file'), async (req, res, next) => {
  try {
    const args = planArgs(req);
    const expectedHash = String(req.body.planHash || '');
    const result = await db.transaction(async (tx) => {
      // Serialize concurrent imports of logistics data.
      await tx.run('LOCK TABLE regions, region_contacts, branches, carriers IN SHARE ROW EXCLUSIVE MODE');
      const plan = await importer.buildPlan({ db: tx, ...args });
      if (!expectedHash || plan.planHash !== expectedHash) {
        throw new AppError(409, 'PLAN_CHANGED', 'Os dados mudaram desde a pré-visualização. Gere a pré-visualização de novo e confira antes de importar.');
      }
      if (plan.summary.UPDATE > 0 && req.body.confirmUpdates !== 'true') {
        throw new AppError(400, 'CONFIRMATION_REQUIRED', `Esta importação altera ${plan.summary.UPDATE} registro(s) existente(s). Confirme a atualização para continuar.`);
      }
      return importer.commitPlan({ tx, plan, user: req.user, fileName: decodeName(req.file.originalname), auditService, req });
    });
    res.json(result);
  } catch (err) { next(err); }
});

module.exports = router;

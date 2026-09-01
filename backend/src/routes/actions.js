const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { z } = require('zod');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/connection');
const { authenticate } = require('../middleware/auth');
const { requirePermission, canAccessProject, allowedAreaIds } = require('../middleware/rbac');
const { PERMISSIONS } = require('../permissions');
const { buildActionFilters, BASE_FROM } = require('../services/actionFilters');
const { shapeAction, SINGLE_ACTION_SELECT, nextBusinessId } = require('../services/actionsService');
const auditService = require('../services/auditService');
const { toCSV, toXLSXBuffer, dateFmt, numFmt } = require('../services/exportService');
const { AppError } = require('../middleware/errorHandler');
const { nowISO } = require('../utils/dates');

const router = express.Router();
router.use(authenticate);
router.use(requirePermission(PERMISSIONS.ACTIONS_VIEW));

const VALID_STATUSES = ['ANDAMENTO', 'CANCELADO', 'CONCLUÍDO', 'EM ESTUDO'];
const VALID_SORT = new Set(['business_id', 'ref_month', 'start_date', 'due_date', 'completion_date', 'status', 'updated_at', 'project_name', 'area_name']);

async function getUserByNameOrCreatePerson(name) {
  if (!name || !name.trim()) return null;
  const trimmed = name.trim();
  let person = await db.get('SELECT id FROM people WHERE lower(name) = lower(?)', trimmed);
  if (!person) {
    const info = await db.run('INSERT INTO people (name) VALUES (?) RETURNING id', trimmed);
    person = { id: info.lastInsertRowid };
  }
  return person.id;
}

// ------------------------------------------------------------------------
// LIST (paginated, sortable, filterable)
// ------------------------------------------------------------------------
router.get('/', async (req, res, next) => {
  try {
    const { where, params, filtersEcho } = await buildActionFilters(req.query, req.user);
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 25));
    const sortBy = VALID_SORT.has(req.query.sortBy) ? req.query.sortBy : 'business_id';
    const sortDir = req.query.sortDir === 'desc' ? 'DESC' : 'ASC';

    const countRow = await db.get(`SELECT COUNT(*) AS total ${BASE_FROM} WHERE ${where}`, ...params);
    const total = countRow.total;

    const sortCol = sortBy === 'project_name' ? 'p.name' : sortBy === 'area_name' ? 'ar.name' : `a.${sortBy}`;
    const rows = await db.all(`
      SELECT a.*, p.name AS project_name, ar.name AS area_name, au.name AS assignee_name,
             ah.planned_hours_total, ah.actual_hours_total
      ${BASE_FROM}
      WHERE ${where}
      ORDER BY ${sortCol} ${sortDir}, a.business_id ASC
      LIMIT ? OFFSET ?
    `, ...params, pageSize, (page - 1) * pageSize);

    res.json({
      items: rows.map(shapeAction),
      page, pageSize, total, totalPages: Math.ceil(total / pageSize),
      filters: filtersEcho,
    });
  } catch (err) { next(err); }
});

// ------------------------------------------------------------------------
// EXPORT (CSV / XLSX) — respects the exact same filters as the list
// ------------------------------------------------------------------------
const EXPORT_COLUMNS = [
  { key: 'id', header: 'ID' },
  { key: 'projectName', header: 'Projeto' },
  { key: 'refMonth', header: 'Mês Ref.', format: dateFmt },
  { key: 'areaName', header: 'Área/Processo' },
  { key: 'description', header: 'Ação' },
  { key: 'responsibleName', header: 'Quem' },
  { key: 'plannedHours', header: 'Horas Planejadas', format: numFmt },
  { key: 'actualHours', header: 'Horas Reais', format: numFmt },
  { key: 'varianceHours', header: 'Variação (h)', format: numFmt },
  { key: 'startDate', header: 'Início', format: dateFmt },
  { key: 'dueDate', header: 'Prazo', format: dateFmt },
  { key: 'completionDate', header: 'Fim', format: dateFmt },
  { key: 'status', header: 'Status' },
  { key: 'observations', header: 'Observações' },
  { key: 'updatedAt', header: 'Última Atualização', format: dateFmt },
];

router.get('/export', requirePermission(PERMISSIONS.REPORTS_EXPORT), async (req, res, next) => {
  try {
    const { where, params, filtersEcho } = await buildActionFilters(req.query, req.user);
    const rows = await db.all(`
      SELECT a.*, p.name AS project_name, ar.name AS area_name, au.name AS assignee_name,
             ah.planned_hours_total, ah.actual_hours_total
      ${BASE_FROM}
      WHERE ${where}
      ORDER BY a.business_id ASC
    `, ...params);
    const shaped = rows.map(shapeAction).map((r) => ({ ...r, projectName: r.project.name, areaName: r.area.name }));

    const format = (req.query.format || 'xlsx').toLowerCase();
    await auditService.record({ entityType: 'EXPORT', entityId: 'actions', actionType: 'EXPORT', newValue: { format, filters: filtersEcho }, actor: req.user, req });

    if (format === 'csv') {
      const csv = toCSV(shaped, EXPORT_COLUMNS);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="acoes.csv"');
      return res.send(Buffer.from(csv, 'utf8'));
    }
    const buf = await toXLSXBuffer(shaped, EXPORT_COLUMNS, 'Ações', filtersEcho);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="acoes.xlsx"');
    res.send(Buffer.from(buf));
  } catch (err) { next(err); }
});

// ------------------------------------------------------------------------
// GET one
// ------------------------------------------------------------------------
async function loadActionOr404(uuidOrBusinessId) {
  const isNumeric = /^\d+$/.test(uuidOrBusinessId);
  const row = isNumeric
    ? await db.get(`${SINGLE_ACTION_SELECT} WHERE a.business_id = ?`, Number(uuidOrBusinessId))
    : await db.get(`${SINGLE_ACTION_SELECT} WHERE a.uuid = ?`, uuidOrBusinessId);
  return row;
}

// ------------------------------------------------------------------------
// META: distinct reference months present in the data (for filter UI)
// ------------------------------------------------------------------------
router.get('/meta/ref-months', async (req, res, next) => {
  try {
    const { where, params } = await buildActionFilters({}, req.user);
    const rows = await db.all(`SELECT DISTINCT a.ref_month FROM actions a WHERE ${where} ORDER BY a.ref_month DESC`, ...params);
    res.json({ items: rows.map((r) => r.ref_month) });
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const row = await loadActionOr404(req.params.id);
    if (!row || (row.deleted_at && !['ADMIN', 'AUDITOR'].includes(req.user.role_key))) {
      throw new AppError(404, 'NOT_FOUND', 'Ação não encontrada.');
    }
    if (!(await canAccessProject(req.user, row.project_id))) throw new AppError(403, 'FORBIDDEN', 'Você não tem acesso a esta ação.');
    const scopedAreas = await allowedAreaIds(req.user);
    if (scopedAreas !== null && !scopedAreas.includes(row.area_id)) throw new AppError(403, 'FORBIDDEN', 'Você não tem acesso a esta ação.');

    const timeline = await db.all(`
      SELECT * FROM audit_log WHERE entity_type = 'ACTION' AND entity_id = ? ORDER BY created_at DESC
    `, row.uuid);
    const comments = await db.all(`
      SELECT c.*, u.name AS author_name FROM comments c JOIN users u ON u.id = c.author_id
      WHERE c.action_uuid = ? ORDER BY c.created_at DESC
    `, row.uuid);
    const attachments = await db.all(`
      SELECT id, original_name, mime_type, size_bytes, created_at, uploaded_by FROM attachments
      WHERE action_uuid = ? ORDER BY created_at DESC
    `, row.uuid);
    const timeEntries = await db.all(`
      SELECT te.*, u.name AS user_name FROM time_entries te LEFT JOIN users u ON u.id = te.user_id
      WHERE te.action_uuid = ? ORDER BY te.entry_date DESC, te.id DESC
    `, row.uuid);

    res.json({ ...shapeAction(row), timeline, comments, attachments, timeEntries });
  } catch (err) { next(err); }
});

// ------------------------------------------------------------------------
// CREATE
// ------------------------------------------------------------------------
const createSchema = z.object({
  projectId: z.number(),
  areaId: z.number(),
  refMonth: z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/),
  description: z.string().min(3, 'Descreva a ação com ao menos 3 caracteres.'),
  responsibleName: z.string().optional().nullable(),
  unassigned: z.boolean().optional(),
  assigneeUserId: z.number().optional().nullable(),
  plannedHours: z.number().nonnegative().optional().nullable(),
  startDate: z.string().optional().nullable(),
  dueDate: z.string().optional().nullable(),
  completionDate: z.string().optional().nullable(),
  status: z.enum(VALID_STATUSES),
  observations: z.string().optional().nullable(),
  cancellationReason: z.string().optional().nullable(),
});

router.post('/', requirePermission(PERMISSIONS.ACTIONS_CREATE), async (req, res, next) => {
  try {
    const body = createSchema.parse(req.body);
    if (!(await canAccessProject(req.user, body.projectId))) throw new AppError(403, 'FORBIDDEN', 'Você não tem acesso a este projeto.');
    if (!body.responsibleName && !body.assigneeUserId && !body.unassigned) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Informe um responsável ou marque explicitamente como "sem responsável".');
    }
    if (body.status === 'CONCLUÍDO' && !body.completionDate) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Ações concluídas exigem a data de conclusão.');
    }
    if (body.status === 'CANCELADO' && !body.cancellationReason) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Informe o motivo do cancelamento.');
    }

    const uuid = uuidv4();
    const businessId = await nextBusinessId();
    const refMonth = body.refMonth.length === 7 ? `${body.refMonth}-01` : body.refMonth;
    const personId = await getUserByNameOrCreatePerson(body.responsibleName);

    await db.run(`
      INSERT INTO actions (
        uuid, business_id, project_id, ref_month, ref_month_raw, area_id, description,
        responsible_name, person_id, assignee_user_id, planned_hours, start_date, due_date,
        completion_date, status, observations, cancellation_reason, source, created_by, updated_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'MANUAL', ?, ?)
    `,
      uuid, businessId, body.projectId, refMonth, refMonth, body.areaId, body.description,
      body.responsibleName || null, personId, body.assigneeUserId || null, body.plannedHours ?? null,
      body.startDate || null, body.dueDate || null, body.completionDate || null, body.status,
      body.observations || null, body.cancellationReason || null, req.user.id, req.user.id
    );

    await auditService.record({ entityType: 'ACTION', entityId: uuid, businessId, projectId: body.projectId, actionType: 'CREATE', actor: req.user, req, newValue: body });

    const row = await loadActionOr404(uuid);
    res.status(201).json(shapeAction(row));
  } catch (err) { next(err); }
});

// ------------------------------------------------------------------------
// UPDATE
// ------------------------------------------------------------------------
const updateSchema = z.object({
  projectId: z.number().optional(),
  areaId: z.number().optional(),
  refMonth: z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/).optional(),
  description: z.string().min(3).optional(),
  responsibleName: z.string().optional().nullable(),
  unassigned: z.boolean().optional(),
  assigneeUserId: z.number().optional().nullable(),
  plannedHours: z.number().nonnegative().optional().nullable(),
  startDate: z.string().optional().nullable(),
  dueDate: z.string().optional().nullable(),
  completionDate: z.string().optional().nullable(),
  status: z.enum(VALID_STATUSES).optional(),
  observations: z.string().optional().nullable(),
  cancellationReason: z.string().optional().nullable(),
  statusChangeReason: z.string().optional().nullable(),
  legacyHoursConfirmed: z.boolean().optional(),
});

const EDITABLE_FIELD_MAP = {
  projectId: 'project_id', areaId: 'area_id', description: 'description',
  responsibleName: 'responsible_name', assigneeUserId: 'assignee_user_id',
  plannedHours: 'planned_hours', startDate: 'start_date', dueDate: 'due_date',
  completionDate: 'completion_date', status: 'status', observations: 'observations',
  cancellationReason: 'cancellation_reason', legacyHoursConfirmed: 'legacy_hours_confirmed',
};

router.patch('/:id', async (req, res, next) => {
  try {
    const before = await loadActionOr404(req.params.id);
    if (!before || before.deleted_at) throw new AppError(404, 'NOT_FOUND', 'Ação não encontrada.');
    if (!(await canAccessProject(req.user, before.project_id))) throw new AppError(403, 'FORBIDDEN', 'Você não tem acesso a esta ação.');

    const canEditAny = ['ADMIN', 'PROJECT_MANAGER'].includes(req.user.role_key);
    const canEditAssigned = req.user.role_key === 'CONTRIBUTOR' && before.assignee_user_id === req.user.id;
    if (!canEditAny && !canEditAssigned) {
      throw new AppError(403, 'FORBIDDEN', 'Você só pode editar ações atribuídas a você.');
    }

    const body = updateSchema.parse(req.body);
    if (body.unassigned) { body.responsibleName = null; body.assigneeUserId = null; }

    const nextStatus = body.status || before.status;
    if (nextStatus === 'CONCLUÍDO') {
      const completion = body.completionDate !== undefined ? body.completionDate : before.completion_date;
      if (!completion) throw new AppError(400, 'VALIDATION_ERROR', 'Ações concluídas exigem a data de conclusão.');
    }
    if (nextStatus === 'CANCELADO') {
      const reason = body.cancellationReason !== undefined ? body.cancellationReason : before.cancellation_reason;
      if (!reason) throw new AppError(400, 'VALIDATION_ERROR', 'Informe o motivo do cancelamento.');
    }
    if (before.status === 'CONCLUÍDO' && body.status && body.status !== 'CONCLUÍDO' && !body.statusChangeReason) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Informe o motivo para reabrir uma ação concluída.');
    }

    if (body.responsibleName !== undefined) {
      body._personId = await getUserByNameOrCreatePerson(body.responsibleName);
    }

    const sets = [];
    const params = [];
    for (const [key, col] of Object.entries(EDITABLE_FIELD_MAP)) {
      if (body[key] !== undefined) {
        sets.push(`${col} = ?`);
        params.push(typeof body[key] === 'boolean' ? (body[key] ? 1 : 0) : body[key]);
      }
    }
    if (body._personId !== undefined) { sets.push('person_id = ?'); params.push(body._personId); }
    if (body.refMonth) {
      const rm = body.refMonth.length === 7 ? `${body.refMonth}-01` : body.refMonth;
      sets.push('ref_month = ?, ref_month_raw = ?'); params.push(rm, rm);
    }
    if (!sets.length) return res.json(shapeAction(before));

    sets.push('updated_by = ?', 'updated_at = ?');
    params.push(req.user.id, nowISO());
    params.push(before.uuid);

    await db.run(`UPDATE actions SET ${sets.join(', ')} WHERE uuid = ?`, ...params);

    const after = { ...before, ...Object.fromEntries(Object.entries(EDITABLE_FIELD_MAP).filter(([k]) => body[k] !== undefined).map(([k, col]) => [col, body[k]])) };
    await auditService.recordDiff({
      entityType: 'ACTION', entityId: before.uuid, businessId: before.business_id, projectId: before.project_id,
      before, after, fieldsToTrack: Object.values(EDITABLE_FIELD_MAP), actor: req.user, req,
    });
    if (body.statusChangeReason) {
      await auditService.record({ entityType: 'ACTION', entityId: before.uuid, businessId: before.business_id, projectId: before.project_id, actionType: 'STATUS_CHANGE_REASON', newValue: body.statusChangeReason, actor: req.user, req });
    }

    const row = await loadActionOr404(before.uuid);
    res.json(shapeAction(row));
  } catch (err) { next(err); }
});

// ------------------------------------------------------------------------
// SOFT DELETE (admin only)
// ------------------------------------------------------------------------
router.delete('/:id', requirePermission(PERMISSIONS.ACTIONS_DELETE), async (req, res, next) => {
  try {
    const before = await loadActionOr404(req.params.id);
    if (!before || before.deleted_at) throw new AppError(404, 'NOT_FOUND', 'Ação não encontrada.');
    await db.run('UPDATE actions SET deleted_at = ?, updated_by = ?, updated_at = ? WHERE uuid = ?',
      nowISO(), req.user.id, nowISO(), before.uuid);
    await auditService.record({ entityType: 'ACTION', entityId: before.uuid, businessId: before.business_id, projectId: before.project_id, actionType: 'DELETE', actor: req.user, req });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ------------------------------------------------------------------------
// Comments
// ------------------------------------------------------------------------
router.post('/:id/comments', requirePermission(PERMISSIONS.COMMENTS_CREATE), async (req, res, next) => {
  try {
    const action = await loadActionOr404(req.params.id);
    if (!action || action.deleted_at) throw new AppError(404, 'NOT_FOUND', 'Ação não encontrada.');
    if (!(await canAccessProject(req.user, action.project_id))) throw new AppError(403, 'FORBIDDEN', 'Sem acesso.');
    const body = z.object({ body: z.string().min(1) }).parse(req.body);
    const info = await db.run('INSERT INTO comments (action_uuid, author_id, body) VALUES (?, ?, ?) RETURNING id', action.uuid, req.user.id, body.body);
    await auditService.record({ entityType: 'ACTION', entityId: action.uuid, businessId: action.business_id, projectId: action.project_id, actionType: 'COMMENT', newValue: body.body, actor: req.user, req });
    res.status(201).json({ id: info.lastInsertRowid });
  } catch (err) { next(err); }
});

// ------------------------------------------------------------------------
// Attachments
// ------------------------------------------------------------------------
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'data', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_MIME = new Set([
  'application/pdf', 'image/png', 'image/jpeg', 'image/gif',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/csv', 'text/plain',
]);

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).slice(0, 10);
      cb(null, `${crypto.randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) return cb(new AppError(400, 'INVALID_FILE_TYPE', 'Tipo de arquivo não permitido.'));
    cb(null, true);
  },
});

router.post('/:id/attachments', requirePermission(PERMISSIONS.ATTACHMENTS_CREATE), upload.single('file'), async (req, res, next) => {
  try {
    const action = await loadActionOr404(req.params.id);
    if (!action || action.deleted_at) throw new AppError(404, 'NOT_FOUND', 'Ação não encontrada.');
    if (!(await canAccessProject(req.user, action.project_id))) throw new AppError(403, 'FORBIDDEN', 'Sem acesso.');
    if (!req.file) throw new AppError(400, 'VALIDATION_ERROR', 'Nenhum arquivo enviado.');

    const info = await db.run(`
      INSERT INTO attachments (action_uuid, original_name, stored_name, mime_type, size_bytes, uploaded_by)
      VALUES (?, ?, ?, ?, ?, ?) RETURNING id
    `, action.uuid, req.file.originalname, req.file.filename, req.file.mimetype, req.file.size, req.user.id);

    await auditService.record({ entityType: 'ACTION', entityId: action.uuid, businessId: action.business_id, projectId: action.project_id, actionType: 'ATTACHMENT_ADDED', newValue: req.file.originalname, actor: req.user, req });
    res.status(201).json({ id: info.lastInsertRowid, name: req.file.originalname });
  } catch (err) { next(err); }
});

router.get('/:id/attachments/:attachmentId/download', async (req, res, next) => {
  try {
    const action = await loadActionOr404(req.params.id);
    if (!action) throw new AppError(404, 'NOT_FOUND', 'Ação não encontrada.');
    if (!(await canAccessProject(req.user, action.project_id))) throw new AppError(403, 'FORBIDDEN', 'Sem acesso.');
    const att = await db.get('SELECT * FROM attachments WHERE id = ? AND action_uuid = ?', Number(req.params.attachmentId), action.uuid);
    if (!att) throw new AppError(404, 'NOT_FOUND', 'Anexo não encontrado.');
    res.download(path.join(UPLOAD_DIR, att.stored_name), att.original_name);
  } catch (err) { next(err); }
});

module.exports = router;

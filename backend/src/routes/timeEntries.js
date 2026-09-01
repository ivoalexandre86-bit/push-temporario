const express = require('express');
const { z } = require('zod');
const db = require('../db/connection');
const { authenticate } = require('../middleware/auth');
const { requirePermission, canAccessProject } = require('../middleware/rbac');
const { PERMISSIONS } = require('../permissions');
const auditService = require('../services/auditService');
const { AppError } = require('../middleware/errorHandler');
const { nowISO } = require('../utils/dates');

const router = express.Router();
router.use(authenticate);

async function loadAction(uuidOrId) {
  const isNumeric = /^\d+$/.test(uuidOrId);
  return isNumeric
    ? db.get('SELECT * FROM actions WHERE business_id = ?', Number(uuidOrId))
    : db.get('SELECT * FROM actions WHERE uuid = ?', uuidOrId);
}

const createSchema = z.object({
  actionId: z.union([z.string(), z.number()]),
  entryDate: z.string(),
  hours: z.number().positive('As horas devem ser maiores que zero.'),
  type: z.enum(['PLANNED', 'ACTUAL']),
  note: z.string().optional().nullable(),
});

router.post('/', requirePermission(PERMISSIONS.HOURS_EDIT), async (req, res, next) => {
  try {
    const body = createSchema.parse(req.body);
    const action = await loadAction(String(body.actionId));
    if (!action || action.deleted_at) throw new AppError(404, 'NOT_FOUND', 'Ação não encontrada.');
    if (!(await canAccessProject(req.user, action.project_id))) throw new AppError(403, 'FORBIDDEN', 'Sem acesso a esta ação.');

    const canEditAny = ['ADMIN', 'PROJECT_MANAGER'].includes(req.user.role_key);
    const canEditAssigned = req.user.role_key === 'CONTRIBUTOR' && action.assignee_user_id === req.user.id;
    if (!canEditAny && !canEditAssigned) throw new AppError(403, 'FORBIDDEN', 'Você só pode lançar horas em ações atribuídas a você.');

    const approvalStatus = req.user.role_key === 'CONTRIBUTOR' ? 'PENDING' : 'APPROVED';

    const info = await db.run(`
      INSERT INTO time_entries (action_uuid, user_id, entry_date, hours, type, note, approval_status, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id
    `, action.uuid, req.user.id, body.entryDate, body.hours, body.type, body.note || null, approvalStatus, req.user.id);

    await db.run('UPDATE actions SET updated_by = ?, updated_at = ? WHERE uuid = ?', req.user.id, nowISO(), action.uuid);

    await auditService.record({
      entityType: 'TIME_ENTRY', entityId: info.lastInsertRowid, businessId: action.business_id, projectId: action.project_id,
      actionType: 'CREATE', newValue: body, actor: req.user, req,
    });

    res.status(201).json({ id: info.lastInsertRowid, approvalStatus });
  } catch (err) { next(err); }
});

router.patch('/:id/approve', requirePermission(PERMISSIONS.HOURS_APPROVE), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const entry = await db.get('SELECT * FROM time_entries WHERE id = ?', id);
    if (!entry) throw new AppError(404, 'NOT_FOUND', 'Lançamento não encontrado.');
    const action = await db.get('SELECT * FROM actions WHERE uuid = ?', entry.action_uuid);
    if (!(await canAccessProject(req.user, action.project_id))) throw new AppError(403, 'FORBIDDEN', 'Sem acesso.');

    const decision = z.object({ approve: z.boolean() }).parse(req.body);
    const newStatus = decision.approve ? 'APPROVED' : 'REJECTED';
    await db.run('UPDATE time_entries SET approval_status = ?, updated_at = ? WHERE id = ?', newStatus, nowISO(), id);
    await auditService.record({
      entityType: 'TIME_ENTRY', entityId: id, businessId: action.business_id, projectId: action.project_id,
      actionType: 'UPDATE', fieldName: 'approval_status', oldValue: entry.approval_status, newValue: newStatus, actor: req.user, req,
    });
    res.json({ ok: true, approvalStatus: newStatus });
  } catch (err) { next(err); }
});

router.get('/', requirePermission(PERMISSIONS.ACTIONS_VIEW), async (req, res, next) => {
  try {
    const clauses = [];
    const params = [];
    if (req.query.actionId) {
      const action = await loadAction(String(req.query.actionId));
      if (action) { clauses.push('te.action_uuid = ?'); params.push(action.uuid); }
    }
    if (req.query.userId) { clauses.push('te.user_id = ?'); params.push(Number(req.query.userId)); }
    if (req.query.type) { clauses.push('te.type = ?'); params.push(req.query.type); }
    if (req.query.approvalStatus) { clauses.push('te.approval_status = ?'); params.push(req.query.approvalStatus); }
    const where = clauses.length ? clauses.join(' AND ') : '1=1';
    const rows = await db.all(`
      SELECT te.*, u.name AS user_name, a.business_id, a.description AS action_description
      FROM time_entries te
      LEFT JOIN users u ON u.id = te.user_id
      JOIN actions a ON a.uuid = te.action_uuid
      WHERE ${where}
      ORDER BY te.entry_date DESC, te.id DESC
      LIMIT 500
    `, ...params);
    res.json({ items: rows });
  } catch (err) { next(err); }
});

module.exports = router;

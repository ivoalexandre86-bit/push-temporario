const express = require('express');
const db = require('../db/connection');
const { authenticate } = require('../middleware/auth');
const { requirePermission, allowedProjectIds } = require('../middleware/rbac');
const { PERMISSIONS } = require('../permissions');
const { toCSV, toXLSXBuffer, dateFmt } = require('../services/exportService');

const router = express.Router();
router.use(authenticate);
router.use(requirePermission(PERMISSIONS.AUDIT_VIEW));

async function buildWhere(query, user) {
  const clauses = ['1=1'];
  const params = [];
  const scoped = await allowedProjectIds(user);
  if (scoped !== null) {
    if (scoped.length === 0) { clauses.push('1=0'); }
    else { clauses.push(`(al.project_id IS NULL OR al.project_id IN (${scoped.map(() => '?').join(',')}))`); params.push(...scoped); }
  }
  if (query.entityType) { clauses.push('al.entity_type = ?'); params.push(query.entityType); }
  if (query.projectId) { clauses.push('al.project_id = ?'); params.push(Number(query.projectId)); }
  if (query.businessId) { clauses.push('al.business_id = ?'); params.push(Number(query.businessId)); }
  if (query.actorUserId) { clauses.push('al.actor_user_id = ?'); params.push(Number(query.actorUserId)); }
  if (query.actionType) { clauses.push('al.action_type = ?'); params.push(query.actionType); }
  if (query.dateFrom) { clauses.push('al.created_at >= ?'); params.push(query.dateFrom); }
  if (query.dateTo) { clauses.push('al.created_at <= ?'); params.push(query.dateTo + 'T23:59:59.999Z'); }
  return { where: clauses.join(' AND '), params };
}

router.get('/', async (req, res, next) => {
  try {
    const { where, params } = await buildWhere(req.query, req.user);
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 50));

    const totalRow = await db.get(`SELECT COUNT(*) AS total FROM audit_log al WHERE ${where}`, ...params);
    const total = totalRow.total;
    const rows = await db.all(`
      SELECT al.*, p.name AS project_name FROM audit_log al LEFT JOIN projects p ON p.id = al.project_id
      WHERE ${where} ORDER BY al.created_at DESC LIMIT ? OFFSET ?
    `, ...params, pageSize, (page - 1) * pageSize);

    res.json({ items: rows, page, pageSize, total, totalPages: Math.ceil(total / pageSize) });
  } catch (err) { next(err); }
});

const AUDIT_COLUMNS = [
  { key: 'created_at', header: 'Data/Hora', format: (v) => new Date(v).toLocaleString('pt-BR') },
  { key: 'entity_type', header: 'Entidade' },
  { key: 'business_id', header: 'ID da Ação' },
  { key: 'project_name', header: 'Projeto' },
  { key: 'action_type', header: 'Tipo de Alteração' },
  { key: 'field_name', header: 'Campo' },
  { key: 'old_value', header: 'Valor Anterior' },
  { key: 'new_value', header: 'Novo Valor' },
  { key: 'actor_name', header: 'Usuário' },
  { key: 'ip_address', header: 'IP' },
];

router.get('/export', requirePermission(PERMISSIONS.REPORTS_EXPORT), async (req, res, next) => {
  try {
    const { where, params } = await buildWhere(req.query, req.user);
    const rows = await db.all(`
      SELECT al.*, p.name AS project_name FROM audit_log al LEFT JOIN projects p ON p.id = al.project_id
      WHERE ${where} ORDER BY al.created_at DESC LIMIT 20000
    `, ...params);
    const format = (req.query.format || 'xlsx').toLowerCase();
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="auditoria.csv"');
      return res.send(Buffer.from(toCSV(rows, AUDIT_COLUMNS), 'utf8'));
    }
    const buf = await toXLSXBuffer(rows, AUDIT_COLUMNS, 'Auditoria', req.query);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="auditoria.xlsx"');
    res.send(Buffer.from(buf));
  } catch (err) { next(err); }
});

module.exports = router;

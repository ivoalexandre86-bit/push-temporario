const express = require('express');
const db = require('../db/connection');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { PERMISSIONS } = require('../permissions');
const { buildActionFilters, BASE_FROM } = require('../services/actionFilters');
const { round2 } = require('../services/actionsService');
const { toCSV, toXLSXBuffer, dateFmt, numFmt } = require('../services/exportService');
const { todayISODate } = require('../utils/dates');
const auditService = require('../services/auditService');

const router = express.Router();
router.use(authenticate);
router.use(requirePermission(PERMISSIONS.ACTIONS_VIEW));

const REPORT_BUILDERS = {
  'monthly-status-summary': async (where, params) => {
    const rows = await db.all(`
      SELECT a.ref_month AS month, a.status,
        COUNT(*) AS count
      ${BASE_FROM} WHERE ${where} GROUP BY a.ref_month, a.status ORDER BY a.ref_month
    `, ...params);
    return {
      rows,
      columns: [
        { key: 'month', header: 'Mês Ref.', format: dateFmt },
        { key: 'status', header: 'Status' },
        { key: 'count', header: 'Quantidade' },
      ],
    };
  },
  'project-performance': async (where, params) => {
    const rows = await db.all(`
      SELECT p.name AS project, COUNT(*) AS total,
        SUM(CASE WHEN a.status='CONCLUÍDO' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN a.status='CANCELADO' THEN 1 ELSE 0 END) AS cancelled,
        SUM(CASE WHEN a.status NOT IN ('CONCLUÍDO','CANCELADO') THEN 1 ELSE 0 END) AS open,
        SUM(CASE WHEN a.status NOT IN ('CONCLUÍDO','CANCELADO') AND COALESCE(a.due_date,a.completion_date) < ? THEN 1 ELSE 0 END) AS overdue,
        COALESCE(SUM(ah.planned_hours_total),0) AS planned_hours,
        COALESCE(SUM(ah.actual_hours_total),0) AS actual_hours
      ${BASE_FROM} WHERE ${where} GROUP BY p.id, p.name ORDER BY total DESC
    `, todayISODate(), ...params);
    return {
      rows: rows.map((r) => ({ ...r, completion_pct: r.total ? round2((r.completed / r.total) * 100) : 0, variance_hours: round2(r.actual_hours - r.planned_hours) })),
      columns: [
        { key: 'project', header: 'Projeto' },
        { key: 'total', header: 'Total de Ações' },
        { key: 'open', header: 'Em Aberto' },
        { key: 'completed', header: 'Concluídas' },
        { key: 'cancelled', header: 'Canceladas' },
        { key: 'overdue', header: 'Atrasadas' },
        { key: 'completion_pct', header: '% Conclusão', format: numFmt },
        { key: 'planned_hours', header: 'Horas Planejadas', format: numFmt },
        { key: 'actual_hours', header: 'Horas Reais', format: numFmt },
        { key: 'variance_hours', header: 'Variação (h)', format: numFmt },
      ],
    };
  },
  'area-performance': async (where, params) => {
    const rows = await db.all(`
      SELECT ar.name AS area, COUNT(*) AS total,
        SUM(CASE WHEN a.status='CONCLUÍDO' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN a.status='CANCELADO' THEN 1 ELSE 0 END) AS cancelled,
        SUM(CASE WHEN a.status NOT IN ('CONCLUÍDO','CANCELADO') THEN 1 ELSE 0 END) AS open,
        SUM(CASE WHEN a.status NOT IN ('CONCLUÍDO','CANCELADO') AND COALESCE(a.due_date,a.completion_date) < ? THEN 1 ELSE 0 END) AS overdue,
        COALESCE(SUM(ah.planned_hours_total),0) AS planned_hours,
        COALESCE(SUM(ah.actual_hours_total),0) AS actual_hours
      ${BASE_FROM} WHERE ${where} GROUP BY ar.id, ar.name ORDER BY total DESC
    `, todayISODate(), ...params);
    return {
      rows: rows.map((r) => ({ ...r, completion_pct: r.total ? round2((r.completed / r.total) * 100) : 0, variance_hours: round2(r.actual_hours - r.planned_hours) })),
      columns: [
        { key: 'area', header: 'Área/Processo' },
        { key: 'total', header: 'Total de Ações' },
        { key: 'open', header: 'Em Aberto' },
        { key: 'completed', header: 'Concluídas' },
        { key: 'cancelled', header: 'Canceladas' },
        { key: 'overdue', header: 'Atrasadas' },
        { key: 'completion_pct', header: '% Conclusão', format: numFmt },
        { key: 'planned_hours', header: 'Horas Planejadas', format: numFmt },
        { key: 'actual_hours', header: 'Horas Reais', format: numFmt },
        { key: 'variance_hours', header: 'Variação (h)', format: numFmt },
      ],
    };
  },
  workload: async (where, params) => {
    const rows = await db.all(`
      SELECT COALESCE(NULLIF(TRIM(a.responsible_name),''), 'Sem responsável') AS responsible,
        COUNT(*) AS total,
        SUM(CASE WHEN a.status NOT IN ('CONCLUÍDO','CANCELADO') THEN 1 ELSE 0 END) AS open,
        COALESCE(SUM(ah.planned_hours_total),0) AS planned_hours,
        COALESCE(SUM(ah.actual_hours_total),0) AS actual_hours
      ${BASE_FROM} WHERE ${where} GROUP BY responsible ORDER BY total DESC
    `, ...params);
    return {
      rows,
      columns: [
        { key: 'responsible', header: 'Responsável' },
        { key: 'total', header: 'Total de Ações' },
        { key: 'open', header: 'Em Aberto' },
        { key: 'planned_hours', header: 'Horas Planejadas', format: numFmt },
        { key: 'actual_hours', header: 'Horas Reais', format: numFmt },
      ],
    };
  },
  overdue: async (where, params) => {
    const today = todayISODate();
    const rows = await db.all(`
      SELECT a.business_id AS id, p.name AS project, ar.name AS area, a.description,
        a.responsible_name AS responsible, a.status, a.due_date, a.completion_date,
        COALESCE(a.due_date, a.completion_date) AS effective_date
      ${BASE_FROM} WHERE ${where} AND a.status NOT IN ('CONCLUÍDO','CANCELADO')
        AND COALESCE(a.due_date, a.completion_date) IS NOT NULL AND COALESCE(a.due_date, a.completion_date) < ?
      ORDER BY effective_date ASC
    `, ...params, today);
    return {
      rows,
      columns: [
        { key: 'id', header: 'ID' },
        { key: 'project', header: 'Projeto' },
        { key: 'area', header: 'Área/Processo' },
        { key: 'description', header: 'Ação' },
        { key: 'responsible', header: 'Responsável' },
        { key: 'status', header: 'Status' },
        { key: 'effective_date', header: 'Prazo', format: dateFmt },
      ],
    };
  },
  'planned-vs-actual': async (where, params) => {
    const rows = await db.all(`
      SELECT p.name AS project, a.ref_month AS month,
        COALESCE(SUM(ah.planned_hours_total),0) AS planned_hours,
        COALESCE(SUM(ah.actual_hours_total),0) AS actual_hours
      ${BASE_FROM} WHERE ${where} GROUP BY p.id, p.name, a.ref_month ORDER BY a.ref_month, p.name
    `, ...params);
    return {
      rows: rows.map((r) => ({ ...r, variance_hours: round2(r.actual_hours - r.planned_hours) })),
      columns: [
        { key: 'project', header: 'Projeto' },
        { key: 'month', header: 'Mês Ref.', format: dateFmt },
        { key: 'planned_hours', header: 'Horas Planejadas', format: numFmt },
        { key: 'actual_hours', header: 'Horas Reais', format: numFmt },
        { key: 'variance_hours', header: 'Variação (h)', format: numFmt },
      ],
    };
  },
};

router.get('/:type', async (req, res, next) => {
  try {
    const builder = REPORT_BUILDERS[req.params.type];
    if (!builder) return res.status(404).json({ error: 'NOT_FOUND', message: 'Relatório não encontrado.' });
    const { where, params, filtersEcho } = await buildActionFilters(req.query, req.user);
    const { rows, columns } = await builder(where, params);
    res.json({ rows, columns: columns.map((c) => ({ key: c.key, header: c.header })), filters: filtersEcho });
  } catch (err) { next(err); }
});

router.get('/:type/export', requirePermission(PERMISSIONS.REPORTS_EXPORT), async (req, res, next) => {
  try {
    const builder = REPORT_BUILDERS[req.params.type];
    if (!builder) return res.status(404).json({ error: 'NOT_FOUND', message: 'Relatório não encontrado.' });
    const { where, params, filtersEcho } = await buildActionFilters(req.query, req.user);
    const { rows, columns } = await builder(where, params);
    const format = (req.query.format || 'xlsx').toLowerCase();

    await auditService.record({ entityType: 'EXPORT', entityId: req.params.type, actionType: 'EXPORT', newValue: { format, filters: filtersEcho }, actor: req.user, req });

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${req.params.type}.csv"`);
      return res.send(Buffer.from(toCSV(rows, columns), 'utf8'));
    }
    const buf = await toXLSXBuffer(rows, columns, req.params.type.slice(0, 28), filtersEcho);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.type}.xlsx"`);
    res.send(Buffer.from(buf));
  } catch (err) { next(err); }
});

module.exports = router;

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
const { resolvePeriodMonths, fillMonths } = require('../services/monthlySeries');

const router = express.Router();
router.use(authenticate);
router.use(requirePermission(PERMISSIONS.ACTIONS_VIEW));

const pctFmt = (v) => (v === null || v === undefined ? '' : numFmt(v));

/** Utilização (%) = horas reais ÷ horas planejadas × 100 (vazio quando não há horas planejadas). */
function utilizationPct(actual, planned) {
  return planned > 0 ? round2((actual / planned) * 100) : null;
}

const STATUS_COLUMNS = [
  { status: 'ANDAMENTO', key: 'andamento', header: 'Andamento' },
  { status: 'EM ESTUDO', key: 'em_estudo', header: 'Em Estudo' },
  { status: 'CONCLUÍDO', key: 'concluido', header: 'Concluído' },
  { status: 'CANCELADO', key: 'cancelado', header: 'Cancelado' },
];

const REPORT_BUILDERS = {
  // One row per month of the selected period (months without actions show
  // zeros), with one column per action status plus the month total.
  'monthly-status-summary': async (where, params, filtersEcho) => {
    const raw = await db.all(`
      SELECT a.ref_month AS month, a.status, COUNT(*) AS count
      ${BASE_FROM} WHERE ${where} GROUP BY a.ref_month, a.status ORDER BY a.ref_month
    `, ...params);
    const byMonth = new Map();
    for (const r of raw) {
      if (!byMonth.has(r.month)) byMonth.set(r.month, { month: r.month });
      const col = STATUS_COLUMNS.find((c) => c.status === r.status);
      if (col) byMonth.get(r.month)[col.key] = r.count;
    }
    const empty = (month) => ({ month });
    const months = resolvePeriodMonths(filtersEcho, [...byMonth.keys()]);
    const rows = fillMonths([...byMonth.values()], months, empty).map((r) => {
      const row = { month: r.month };
      let total = 0;
      for (const c of STATUS_COLUMNS) { row[c.key] = r[c.key] || 0; total += row[c.key]; }
      row.total = total;
      return row;
    });
    return {
      rows,
      columns: [
        { key: 'month', header: 'Mês Ref.', format: dateFmt },
        ...STATUS_COLUMNS.map((c) => ({ key: c.key, header: c.header })),
        { key: 'total', header: 'Total de Ações' },
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
      rows: rows.map((r) => ({ ...r, completion_pct: r.total ? round2((r.completed / r.total) * 100) : 0, variance_hours: round2(r.actual_hours - r.planned_hours), utilization_pct: utilizationPct(r.actual_hours, r.planned_hours) })),
      columns: [
        { key: 'project', header: 'Projeto' },
        { key: 'total', header: 'Total de Ações' },
        { key: 'open', header: 'Em Aberto' },
        { key: 'completed', header: 'Concluídas' },
        { key: 'cancelled', header: 'Canceladas' },
        { key: 'overdue', header: 'Atrasadas' },
        { key: 'completion_pct', header: '% Conclusão', format: numFmt },
        { key: 'planned_hours', header: 'Horas Planejadas (h)', format: numFmt },
        { key: 'actual_hours', header: 'Horas Reais (h)', format: numFmt },
        { key: 'variance_hours', header: 'Variação (h) = reais − planejadas', format: numFmt },
        { key: 'utilization_pct', header: 'Utilização (%) = reais ÷ planejadas', format: pctFmt },
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
      rows: rows.map((r) => ({ ...r, completion_pct: r.total ? round2((r.completed / r.total) * 100) : 0, variance_hours: round2(r.actual_hours - r.planned_hours), utilization_pct: utilizationPct(r.actual_hours, r.planned_hours) })),
      columns: [
        { key: 'area', header: 'Área/Processo' },
        { key: 'total', header: 'Total de Ações' },
        { key: 'open', header: 'Em Aberto' },
        { key: 'completed', header: 'Concluídas' },
        { key: 'cancelled', header: 'Canceladas' },
        { key: 'overdue', header: 'Atrasadas' },
        { key: 'completion_pct', header: '% Conclusão', format: numFmt },
        { key: 'planned_hours', header: 'Horas Planejadas (h)', format: numFmt },
        { key: 'actual_hours', header: 'Horas Reais (h)', format: numFmt },
        { key: 'variance_hours', header: 'Variação (h) = reais − planejadas', format: numFmt },
        { key: 'utilization_pct', header: 'Utilização (%) = reais ÷ planejadas', format: pctFmt },
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
        { key: 'planned_hours', header: 'Horas Planejadas (h)', format: numFmt },
        { key: 'actual_hours', header: 'Horas Reais (h)', format: numFmt },
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
  // One row per project × month of the selected period; months in which a
  // project has no actions appear with zero hours (continuous timeline).
  'planned-vs-actual': async (where, params, filtersEcho) => {
    const raw = await db.all(`
      SELECT p.id AS project_id, p.name AS project, a.ref_month AS month,
        COALESCE(SUM(ah.planned_hours_total),0) AS planned_hours,
        COALESCE(SUM(ah.actual_hours_total),0) AS actual_hours
      ${BASE_FROM} WHERE ${where} GROUP BY p.id, p.name, a.ref_month ORDER BY a.ref_month, p.name
    `, ...params);
    const months = resolvePeriodMonths(filtersEcho, raw.map((r) => r.month));
    const projects = [...new Map(raw.map((r) => [r.project_id, r.project])).entries()]
      .sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'));
    const rows = [];
    for (const month of months) {
      for (const [projectId, project] of projects) {
        const r = raw.find((x) => x.project_id === projectId && x.month === month)
          || { project, month, planned_hours: 0, actual_hours: 0 };
        rows.push({
          project, month,
          planned_hours: round2(r.planned_hours),
          actual_hours: round2(r.actual_hours),
          variance_hours: round2(r.actual_hours - r.planned_hours),
          utilization_pct: utilizationPct(r.actual_hours, r.planned_hours),
        });
      }
    }
    return {
      rows,
      columns: [
        { key: 'project', header: 'Projeto' },
        { key: 'month', header: 'Mês Ref.', format: dateFmt },
        { key: 'planned_hours', header: 'Horas Planejadas (h)', format: numFmt },
        { key: 'actual_hours', header: 'Horas Reais (h)', format: numFmt },
        { key: 'variance_hours', header: 'Variação (h) = reais − planejadas', format: numFmt },
        { key: 'utilization_pct', header: 'Utilização (%) = reais ÷ planejadas', format: pctFmt },
      ],
    };
  },
};

router.get('/:type', async (req, res, next) => {
  try {
    const builder = REPORT_BUILDERS[req.params.type];
    if (!builder) return res.status(404).json({ error: 'NOT_FOUND', message: 'Relatório não encontrado.' });
    const { where, params, filtersEcho } = await buildActionFilters(req.query, req.user);
    const { rows, columns } = await builder(where, params, filtersEcho);
    res.json({ rows, columns: columns.map((c) => ({ key: c.key, header: c.header })), filters: filtersEcho });
  } catch (err) { next(err); }
});

router.get('/:type/export', requirePermission(PERMISSIONS.REPORTS_EXPORT), async (req, res, next) => {
  try {
    const builder = REPORT_BUILDERS[req.params.type];
    if (!builder) return res.status(404).json({ error: 'NOT_FOUND', message: 'Relatório não encontrado.' });
    const { where, params, filtersEcho } = await buildActionFilters(req.query, req.user);
    const { rows, columns } = await builder(where, params, filtersEcho);
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

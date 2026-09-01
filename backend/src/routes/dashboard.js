const express = require('express');
const db = require('../db/connection');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { PERMISSIONS } = require('../permissions');
const { buildActionFilters, BASE_FROM } = require('../services/actionFilters');
const { todayISODate } = require('../utils/dates');
const { round2, addDaysISO } = require('../services/actionsService');

const router = express.Router();
router.use(authenticate);
router.use(requirePermission(PERMISSIONS.DASHBOARD_VIEW));

router.get('/', async (req, res, next) => {
  try {
    const { where, params } = await buildActionFilters(req.query, req.user);
    const today = todayISODate();

    const totals = await db.get(`SELECT COUNT(*) AS total ${BASE_FROM} WHERE ${where}`, ...params);

    const byStatus = await db.all(`
      SELECT a.status, COUNT(*) AS count ${BASE_FROM} WHERE ${where} GROUP BY a.status
    `, ...params);

    const byProject = await db.all(`
      SELECT p.id, p.name, COUNT(*) AS count,
        SUM(CASE WHEN a.status NOT IN ('CONCLUÍDO','CANCELADO') THEN 1 ELSE 0 END) AS open_count,
        SUM(CASE WHEN a.status NOT IN ('CONCLUÍDO','CANCELADO') AND COALESCE(a.due_date,a.completion_date) IS NOT NULL AND COALESCE(a.due_date,a.completion_date) < ? THEN 1 ELSE 0 END) AS overdue_count,
        SUM(CASE WHEN a.status = 'CONCLUÍDO' THEN 1 ELSE 0 END) AS completed_count
      ${BASE_FROM} WHERE ${where} GROUP BY p.id, p.name ORDER BY count DESC
    `, today, ...params);

    const byArea = await db.all(`
      SELECT ar.id, ar.name, COUNT(*) AS count,
        SUM(CASE WHEN a.status NOT IN ('CONCLUÍDO','CANCELADO') THEN 1 ELSE 0 END) AS open_count,
        SUM(CASE WHEN a.status NOT IN ('CONCLUÍDO','CANCELADO') AND COALESCE(a.due_date,a.completion_date) IS NOT NULL AND COALESCE(a.due_date,a.completion_date) < ? THEN 1 ELSE 0 END) AS overdue_count,
        SUM(CASE WHEN a.status = 'CONCLUÍDO' THEN 1 ELSE 0 END) AS completed_count
      ${BASE_FROM} WHERE ${where} GROUP BY ar.id, ar.name ORDER BY count DESC
    `, today, ...params);

    const overdue = await db.get(`
      SELECT COUNT(*) AS count ${BASE_FROM}
      WHERE ${where} AND a.status NOT IN ('CONCLUÍDO','CANCELADO')
        AND COALESCE(a.due_date, a.completion_date) IS NOT NULL AND COALESCE(a.due_date, a.completion_date) < ?
    `, ...params, today);

    const dueSoonDate = addDaysISO(today, 7);
    const dueSoon = await db.get(`
      SELECT COUNT(*) AS count ${BASE_FROM}
      WHERE ${where} AND a.status NOT IN ('CONCLUÍDO','CANCELADO')
        AND COALESCE(a.due_date, a.completion_date) BETWEEN ? AND ?
    `, ...params, today, dueSoonDate);

    const hours = await db.get(`
      SELECT COALESCE(SUM(ah.planned_hours_total),0) AS planned, COALESCE(SUM(ah.actual_hours_total),0) AS actual
      ${BASE_FROM} WHERE ${where}
    `, ...params);

    const monthlyTrend = await db.all(`
      SELECT a.ref_month AS month,
        COUNT(*) AS created,
        SUM(CASE WHEN a.status = 'CONCLUÍDO' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN a.status NOT IN ('CONCLUÍDO','CANCELADO') AND COALESCE(a.due_date,a.completion_date) IS NOT NULL AND COALESCE(a.due_date,a.completion_date) < ? THEN 1 ELSE 0 END) AS overdue,
        COALESCE(SUM(ah.planned_hours_total),0) AS planned_hours,
        COALESCE(SUM(ah.actual_hours_total),0) AS actual_hours
      ${BASE_FROM} WHERE ${where} GROUP BY a.ref_month ORDER BY a.ref_month
    `, today, ...params);

    const workload = await db.all(`
      SELECT COALESCE(NULLIF(TRIM(a.responsible_name), ''), 'Sem responsável') AS responsible,
        COUNT(*) AS count,
        SUM(CASE WHEN a.status NOT IN ('CONCLUÍDO','CANCELADO') THEN 1 ELSE 0 END) AS open_count,
        COALESCE(SUM(ah.planned_hours_total),0) AS planned_hours,
        COALESCE(SUM(ah.actual_hours_total),0) AS actual_hours
      ${BASE_FROM} WHERE ${where} GROUP BY responsible ORDER BY count DESC
    `, ...params);

    const statusMap = Object.fromEntries(byStatus.map((r) => [r.status, r.count]));
    const completed = statusMap['CONCLUÍDO'] || 0;
    const cancelled = statusMap['CANCELADO'] || 0;
    const inStudy = statusMap['EM ESTUDO'] || 0;
    const inProgress = statusMap['ANDAMENTO'] || 0;
    const open = totals.total - completed - cancelled;
    const completionPct = totals.total ? round2((completed / totals.total) * 100) : 0;

    res.json({
      totalActions: totals.total,
      byStatus: { ANDAMENTO: inProgress, CONCLUÍDO: completed, 'EM ESTUDO': inStudy, CANCELADO: cancelled },
      openActions: open,
      completedActions: completed,
      cancelledActions: cancelled,
      inStudyActions: inStudy,
      overdueActions: overdue.count,
      dueSoonActions: dueSoon.count,
      completionPct,
      hours: {
        planned: round2(hours.planned),
        actual: round2(hours.actual),
        variance: round2(hours.actual - hours.planned),
        utilizationPct: hours.planned ? round2((hours.actual / hours.planned) * 100) : null,
      },
      byProject: byProject.map((r) => ({ id: r.id, name: r.name, count: r.count, openCount: r.open_count, overdueCount: r.overdue_count, completedCount: r.completed_count, completionPct: r.count ? round2((r.completed_count / r.count) * 100) : 0 })),
      byArea: byArea.map((r) => ({ id: r.id, name: r.name, count: r.count, openCount: r.open_count, overdueCount: r.overdue_count, completedCount: r.completed_count, completionPct: r.count ? round2((r.completed_count / r.count) * 100) : 0 })),
      monthlyTrend: monthlyTrend.map((r) => ({ month: r.month, created: r.created, completed: r.completed, overdue: r.overdue, plannedHours: round2(r.planned_hours), actualHours: round2(r.actual_hours) })),
      workloadByResponsible: workload.map((r) => ({ responsible: r.responsible, count: r.count, openCount: r.open_count, plannedHours: round2(r.planned_hours), actualHours: round2(r.actual_hours) })),
      topOpenProjects: [...byProject].sort((a, b) => b.open_count - a.open_count).slice(0, 5).map((r) => ({ id: r.id, name: r.name, openCount: r.open_count, overdueCount: r.overdue_count })),
      topOverdueAreas: [...byArea].sort((a, b) => b.overdue_count - a.overdue_count).slice(0, 5).map((r) => ({ id: r.id, name: r.name, overdueCount: r.overdue_count })),
    });
  } catch (err) { next(err); }
});

module.exports = router;

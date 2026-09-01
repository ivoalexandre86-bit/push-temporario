const db = require('../db/connection');
const { todayISODate, addDaysISO } = require('../utils/dates');

async function nextBusinessId() {
  // Postgres folds unquoted identifiers (including AS aliases) to lower
  // case, so a camelCase alias like "AS maxId" comes back as the key
  // "maxid", not "maxId" - use snake_case here to avoid that trap.
  const row = await db.get('SELECT MAX(business_id) AS max_id FROM actions');
  return (row.max_id || 0) + 1;
}

function parseExceptions(json) {
  if (!json) return [];
  try { return JSON.parse(json); } catch { return []; }
}

/** Adds computed fields (hours totals, variance, overdue, warning flags) to a raw action row. */
function shapeAction(row) {
  const today = todayISODate();
  const plannedTotal = row.planned_hours_total ?? row.planned_hours ?? 0;
  const actualTotal = row.actual_hours_total ?? 0;
  const variance = round2(actualTotal - plannedTotal);
  const utilizationPct = plannedTotal > 0 ? round2((actualTotal / plannedTotal) * 100) : null;

  const effectiveEndDate = row.due_date || row.completion_date || null;
  const isOpen = !['CONCLUÍDO', 'CANCELADO'].includes(row.status);
  const overdue = isOpen && !!effectiveEndDate && effectiveEndDate < today;
  const dueSoon = isOpen && !!effectiveEndDate && effectiveEndDate >= today &&
    effectiveEndDate <= addDaysISO(today, 7);

  const flags = [];
  if (overdue) flags.push('OVERDUE');
  if (dueSoon) flags.push('DUE_SOON');
  if (!row.responsible_name && !row.assignee_user_id) flags.push('MISSING_ASSIGNEE');
  if (!plannedTotal) flags.push('MISSING_PLANNED_HOURS');
  if (variance < 0) flags.push('NEGATIVE_VARIANCE');
  if (row.status === 'CONCLUÍDO' && !row.completion_date) flags.push('MISSING_COMPLETION_DATE');
  if (row.status === 'CANCELADO' && !row.cancellation_reason) flags.push('MISSING_CANCELLATION_REASON');

  return {
    uuid: row.uuid,
    id: row.business_id,
    project: { id: row.project_id, name: row.project_name },
    area: { id: row.area_id, name: row.area_name },
    refMonth: row.ref_month,
    refMonthRaw: row.ref_month_raw,
    description: row.description,
    responsibleName: row.responsible_name,
    assignee: row.assignee_user_id ? { id: row.assignee_user_id, name: row.assignee_name } : null,
    plannedHours: plannedTotal,
    actualHours: actualTotal,
    actualHoursLegacy: row.actual_hours_legacy,
    legacyHoursConfirmed: !!row.legacy_hours_confirmed,
    varianceHours: variance,
    utilizationPct,
    startDate: row.start_date,
    dueDate: row.due_date,
    completionDate: row.completion_date,
    status: row.status,
    observations: row.observations,
    cancellationReason: row.cancellation_reason,
    importExceptions: parseExceptions(row.import_exceptions),
    source: row.source,
    flags,
    overdue,
    dueSoon,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

const SINGLE_ACTION_SELECT = `
  SELECT a.*, p.name AS project_name, ar.name AS area_name, au.name AS assignee_name,
         ah.planned_hours_total, ah.actual_hours_total
  FROM actions a
  JOIN projects p ON p.id = a.project_id
  JOIN areas ar ON ar.id = a.area_id
  LEFT JOIN users au ON au.id = a.assignee_user_id
  LEFT JOIN action_hours ah ON ah.action_uuid = a.uuid
`;

module.exports = { nextBusinessId, shapeAction, SINGLE_ACTION_SELECT, round2, addDaysISO };

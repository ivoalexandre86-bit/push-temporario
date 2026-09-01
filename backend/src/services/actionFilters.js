const { todayISODate, addDaysISO } = require('../utils/dates');
const { allowedProjectIds, allowedAreaIds } = require('../middleware/rbac');

function toArray(v) {
  if (v === undefined || v === null || v === '') return [];
  return Array.isArray(v) ? v : String(v).split(',').filter(Boolean);
}

/**
 * Builds a parameterized WHERE clause for the `actions a` query (expects the
 * caller's FROM clause to alias the table `a`, join `action_hours ah` on
 * ah.action_uuid = a.uuid, `projects p` on p.id = a.project_id, and
 * `areas ar` on ar.id = a.area_id).
 *
 * Combines categories with AND; multiple values within one category with OR.
 * Also enforces the requesting user's project/area access scope.
 *
 * @returns {Promise<{ where: string, params: any[], filtersEcho: object }>}
 */
async function buildActionFilters(query, user) {
  const clauses = ['a.deleted_at IS NULL'];
  const params = [];
  const echo = {};

  if (!query.includeDeleted || !['ADMIN', 'AUDITOR'].includes(user?.role_key)) {
    // deleted rows always excluded unless explicitly requested by admin/auditor
  } else {
    clauses[0] = '1=1';
    echo.includeDeleted = true;
  }

  // --- access scope (not user-toggleable) ---
  const scopedProjectIds = await allowedProjectIds(user);
  if (scopedProjectIds !== null) {
    if (scopedProjectIds.length === 0) {
      clauses.push('1=0'); // user has no project scope at all -> sees nothing
    } else {
      clauses.push(`a.project_id IN (${scopedProjectIds.map(() => '?').join(',')})`);
      params.push(...scopedProjectIds);
    }
  }
  const scopedAreaIds = await allowedAreaIds(user);
  if (scopedAreaIds !== null) {
    clauses.push(`a.area_id IN (${scopedAreaIds.map(() => '?').join(',')})`);
    params.push(...scopedAreaIds);
  }

  // --- project filter ---
  const projectIds = toArray(query.projectId).map(Number).filter(Number.isFinite);
  if (projectIds.length) {
    clauses.push(`a.project_id IN (${projectIds.map(() => '?').join(',')})`);
    params.push(...projectIds);
    echo.projectId = projectIds;
  }

  // --- area filter ---
  const areaIds = toArray(query.areaId).map(Number).filter(Number.isFinite);
  if (areaIds.length) {
    clauses.push(`a.area_id IN (${areaIds.map(() => '?').join(',')})`);
    params.push(...areaIds);
    echo.areaId = areaIds;
  }

  // --- action business id filter ---
  const businessIds = toArray(query.businessId).map(Number).filter(Number.isFinite);
  if (businessIds.length) {
    clauses.push(`a.business_id IN (${businessIds.map(() => '?').join(',')})`);
    params.push(...businessIds);
    echo.businessId = businessIds;
  }

  // --- status filter ---
  const statuses = toArray(query.status);
  if (statuses.length) {
    clauses.push(`a.status IN (${statuses.map(() => '?').join(',')})`);
    params.push(...statuses);
    echo.status = statuses;
  }

  // --- reference month filter (YYYY-MM or YYYY-MM-01) ---
  const refMonths = toArray(query.refMonth).map((m) => (m.length === 7 ? `${m}-01` : m));
  if (refMonths.length) {
    clauses.push(`a.ref_month IN (${refMonths.map(() => '?').join(',')})`);
    params.push(...refMonths);
    echo.refMonth = refMonths;
  }

  // --- year filter ---
  const years = toArray(query.year);
  if (years.length) {
    clauses.push(`(${years.map(() => "substr(a.ref_month,1,4) = ?").join(' OR ')})`);
    params.push(...years);
    echo.year = years;
  }

  // --- responsible person filter (matches free-text name or linked user name) ---
  const responsibles = toArray(query.responsible);
  if (responsibles.length) {
    clauses.push(
      `(${responsibles.map(() => '(a.responsible_name = ? OR au.name = ?)').join(' OR ')})`
    );
    for (const r of responsibles) params.push(r, r);
    echo.responsible = responsibles;
  }
  if (query.unassigned === 'true' || query.unassigned === true) {
    clauses.push("(a.responsible_name IS NULL OR TRIM(a.responsible_name) = '')");
    echo.unassigned = true;
  }

  // --- date ranges ---
  if (query.startFrom) { clauses.push('a.start_date >= ?'); params.push(query.startFrom); echo.startFrom = query.startFrom; }
  if (query.startTo) { clauses.push('a.start_date <= ?'); params.push(query.startTo); echo.startTo = query.startTo; }
  if (query.endFrom) { clauses.push('COALESCE(a.due_date, a.completion_date) >= ?'); params.push(query.endFrom); echo.endFrom = query.endFrom; }
  if (query.endTo) { clauses.push('COALESCE(a.due_date, a.completion_date) <= ?'); params.push(query.endTo); echo.endTo = query.endTo; }

  // --- overdue toggle ---
  if (query.overdue === 'true' || query.overdue === true) {
    clauses.push("a.status NOT IN ('CONCLUÍDO','CANCELADO') AND COALESCE(a.due_date, a.completion_date) IS NOT NULL AND COALESCE(a.due_date, a.completion_date) < ?");
    params.push(todayISODate());
    echo.overdue = true;
  }
  if (query.dueSoonDays) {
    const days = Number(query.dueSoonDays);
    if (Number.isFinite(days)) {
      const today = todayISODate();
      const until = addDaysISO(today, days);
      clauses.push(
        "a.status NOT IN ('CONCLUÍDO','CANCELADO') AND COALESCE(a.due_date, a.completion_date) IS NOT NULL AND COALESCE(a.due_date, a.completion_date) BETWEEN ? AND ?"
      );
      params.push(today, until);
      echo.dueSoonDays = days;
    }
  }

  // --- hours ranges (against computed totals) ---
  if (query.plannedMin) { clauses.push('ah.planned_hours_total >= ?'); params.push(Number(query.plannedMin)); echo.plannedMin = query.plannedMin; }
  if (query.plannedMax) { clauses.push('ah.planned_hours_total <= ?'); params.push(Number(query.plannedMax)); echo.plannedMax = query.plannedMax; }
  if (query.actualMin) { clauses.push('ah.actual_hours_total >= ?'); params.push(Number(query.actualMin)); echo.actualMin = query.actualMin; }
  if (query.actualMax) { clauses.push('ah.actual_hours_total <= ?'); params.push(Number(query.actualMax)); echo.actualMax = query.actualMax; }

  // --- keyword search (description / observations) ---
  if (query.q) {
    clauses.push('(a.description LIKE ? OR a.observations LIKE ?)');
    const like = `%${query.q}%`;
    params.push(like, like);
    echo.q = query.q;
  }

  return { where: clauses.join(' AND '), params, filtersEcho: echo };
}

const BASE_FROM = `
  FROM actions a
  JOIN projects p ON p.id = a.project_id
  JOIN areas ar ON ar.id = a.area_id
  LEFT JOIN users au ON au.id = a.assignee_user_id
  LEFT JOIN action_hours ah ON ah.action_uuid = a.uuid
`;

module.exports = { buildActionFilters, BASE_FROM, toArray };

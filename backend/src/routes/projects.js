const express = require('express');
const { z } = require('zod');
const db = require('../db/connection');
const { authenticate } = require('../middleware/auth');
const { requirePermission, allowedProjectIds, allowedAreaIds, canAccessProject } = require('../middleware/rbac');
const { PERMISSIONS } = require('../permissions');
const auditService = require('../services/auditService');
const { AppError } = require('../middleware/errorHandler');
const { todayISODate } = require('../utils/dates');
const { round2, addDaysISO } = require('../services/actionsService');

const router = express.Router();
router.use(authenticate);

// Open = not finished/cancelled; overdue = open with an effective end date
// (due_date, falling back to completion_date) before today — the same rule
// used by actionFilters (?overdue=true) and the dashboard.
const OPEN_SQL = "a.status NOT IN ('CONCLUÍDO','CANCELADO')";
const END_DATE_SQL = 'COALESCE(a.due_date, a.completion_date)';

router.get('/', async (req, res, next) => {
  try {
    const scoped = await allowedProjectIds(req.user);
    if (scoped !== null && scoped.length === 0) return res.json({ items: [] });
    const areaScope = await allowedAreaIds(req.user);
    const today = todayISODate();

    const params = [today, today, addDaysISO(today, 7)];
    let areaClause = '';
    if (areaScope) {
      areaClause = `AND a.area_id IN (${areaScope.map(() => '?').join(',')})`;
      params.push(...areaScope);
    }
    let projectClause = '';
    if (scoped !== null) {
      projectClause = `WHERE p.id IN (${scoped.map(() => '?').join(',')})`;
      params.push(...scoped);
    }

    const rows = await db.all(`
      SELECT p.*, u.name AS manager_name,
        COALESCE(s.total, 0) AS action_count,
        COALESCE(s.open_count, 0) AS open_count,
        COALESCE(s.overdue_count, 0) AS overdue_count,
        COALESCE(s.due_soon_count, 0) AS due_soon_count,
        COALESCE(s.completed_count, 0) AS completed_count,
        s.next_due_date
      FROM projects p
      LEFT JOIN users u ON u.id = p.manager_user_id
      LEFT JOIN (
        SELECT a.project_id,
          COUNT(*)::int AS total,
          SUM(CASE WHEN ${OPEN_SQL} THEN 1 ELSE 0 END)::int AS open_count,
          SUM(CASE WHEN ${OPEN_SQL} AND ${END_DATE_SQL} IS NOT NULL AND ${END_DATE_SQL} < ? THEN 1 ELSE 0 END)::int AS overdue_count,
          SUM(CASE WHEN ${OPEN_SQL} AND ${END_DATE_SQL} >= ? AND ${END_DATE_SQL} <= ? THEN 1 ELSE 0 END)::int AS due_soon_count,
          SUM(CASE WHEN a.status = 'CONCLUÍDO' THEN 1 ELSE 0 END)::int AS completed_count,
          MIN(CASE WHEN ${OPEN_SQL} THEN ${END_DATE_SQL} END) AS next_due_date
        FROM actions a
        WHERE a.deleted_at IS NULL ${areaClause}
        GROUP BY a.project_id
      ) s ON s.project_id = p.id
      ${projectClause}
      ORDER BY p.name
    `, ...params);

    const items = rows.map((r) => ({
      ...r,
      completion_pct: r.action_count ? round2((r.completed_count / r.action_count) * 100) : 0,
    }));
    res.json({ items });
  } catch (err) { next(err); }
});

// ------------------------------------------------------------------------
// Project manager ("gerente do projeto") - stored in projects.manager_user_id
// (FK to users). Eligible: active users whose role is Administrador or
// Gerente de Projeto. Same field used by the Projetos grid filter "Gerente".
// ------------------------------------------------------------------------
const MANAGER_ROLES = ['ADMIN', 'PROJECT_MANAGER'];
const MANAGER_REQUIRED_MESSAGE = 'Selecione o gerente do projeto.';

async function loadEligibleManager(userId) {
  const user = await db.get(`
    SELECT u.id, u.name, u.active, r.key AS role_key
    FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?
  `, userId);
  if (!user || !user.active || !MANAGER_ROLES.includes(user.role_key)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'O gerente selecionado deve ser um usuário ativo com papel de Administrador ou Gerente de Projeto.', [{ path: 'managerUserId', message: 'Gerente inválido.' }]);
  }
  return user;
}

/** A Project Manager assigned as manager also gets access scope to the project. */
async function grantManagerScope(manager, projectId) {
  if (manager.role_key !== 'PROJECT_MANAGER') return;
  await db.run('INSERT INTO user_project_scope (user_id, project_id) VALUES (?, ?) ON CONFLICT (user_id, project_id) DO NOTHING', manager.id, projectId);
}

router.get('/manager-options', requirePermission(PERMISSIONS.PROJECTS_MANAGE), async (req, res, next) => {
  try {
    const items = await db.all(`
      SELECT u.id, u.name, r.key AS role, r.name AS role_name
      FROM users u JOIN roles r ON r.id = u.role_id
      WHERE u.active = 1 AND r.key IN (${MANAGER_ROLES.map(() => '?').join(',')})
      ORDER BY u.name
    `, ...MANAGER_ROLES);
    res.json({ items });
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!(await canAccessProject(req.user, id))) throw new AppError(403, 'FORBIDDEN', 'Você não tem acesso a este projeto.');
    const project = await db.get(`
      SELECT p.*, u.name AS manager_name FROM projects p LEFT JOIN users u ON u.id = p.manager_user_id WHERE p.id = ?
    `, id);
    if (!project) throw new AppError(404, 'NOT_FOUND', 'Projeto não encontrado.');
    res.json(project);
  } catch (err) { next(err); }
});

const PROJECT_STATUSES = ['ANDAMENTO', 'CONCLUÍDO', 'CANCELADO', 'PARADO'];
const PROJECT_PRIORITIES = ['ALTA', 'MEDIA', 'BAIXA'];

const managerIdSchema = z.number({ required_error: MANAGER_REQUIRED_MESSAGE, invalid_type_error: MANAGER_REQUIRED_MESSAGE })
  .int(MANAGER_REQUIRED_MESSAGE).positive(MANAGER_REQUIRED_MESSAGE);

// Creating a project requires a manager; on updates the manager is optional
// (inline grid edits send only priority/notes), but once sent it can't be
// cleared - it must be replaced by another eligible user.
const upsertSchema = z.object({
  name: z.string().trim().min(1, 'Informe o nome do projeto.'),
  description: z.string().optional().nullable(),
  managerUserId: managerIdSchema,
  active: z.boolean().optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
  priority: z.enum(PROJECT_PRIORITIES).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

async function requireActiveProjectManager(userId) {
  if (!userId) throw new AppError(400, 'VALIDATION_ERROR', 'Selecione um gerente para o projeto.');
  const manager = await db.get(`
    SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id
    WHERE u.id = ? AND u.active = 1 AND r.key IN ('ADMIN','PROJECT_MANAGER')
  `, userId);
  if (!manager) throw new AppError(400, 'INVALID_PROJECT_MANAGER', 'Selecione um usuário ativo com papel de administrador ou gerente de projeto.');
}

router.post('/', requirePermission(PERMISSIONS.PROJECTS_MANAGE), async (req, res, next) => {
  try {
    const body = upsertSchema.parse(req.body);
    await requireActiveProjectManager(body.managerUserId);
    const existing = await db.get('SELECT id FROM projects WHERE lower(name) = lower(?)', body.name);
    if (existing) throw new AppError(409, 'DUPLICATE', 'Já existe um projeto com este nome.');
    const manager = await loadEligibleManager(body.managerUserId);
    const info = await db.run(
      'INSERT INTO projects (name, description, manager_user_id, active, status, priority, notes) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id',
      body.name, body.description || null, manager.id, body.active === false ? 0 : 1, body.status || 'ANDAMENTO',
      body.priority || null, body.notes?.trim() || null
    );
    await grantManagerScope(manager, info.lastInsertRowid);
    await auditService.record({
      entityType: 'PROJECT', entityId: info.lastInsertRowid, actionType: 'CREATE', actor: req.user, req, projectId: info.lastInsertRowid,
      newValue: { name: body.name, managerUserId: `${manager.name} (#${manager.id})`, status: body.status || 'ANDAMENTO' },
    });
    res.status(201).json({ id: info.lastInsertRowid });
  } catch (err) { next(err); }
});

router.patch('/:id', requirePermission(PERMISSIONS.PROJECTS_MANAGE), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const before = await db.get('SELECT * FROM projects WHERE id = ?', id);
    if (!before) throw new AppError(404, 'NOT_FOUND', 'Projeto não encontrado.');
    const body = upsertSchema.partial().parse(req.body);
    if ('managerUserId' in (req.body || {}) && body.managerUserId == null) {
      throw new AppError(400, 'VALIDATION_ERROR', MANAGER_REQUIRED_MESSAGE, [{ path: 'managerUserId', message: MANAGER_REQUIRED_MESSAGE }]);
    }
    const manager = body.managerUserId !== undefined && body.managerUserId !== before.manager_user_id
      ? await loadEligibleManager(body.managerUserId)
      : null;
    if (body.name !== undefined && body.name.toLowerCase() !== before.name.toLowerCase()) {
      const dup = await db.get('SELECT id FROM projects WHERE lower(name) = lower(?) AND id <> ?', body.name, id);
      if (dup) throw new AppError(409, 'DUPLICATE', 'Já existe um projeto com este nome.');
    }
    const merged = {
      ...before, ...body,
      manager_user_id: body.managerUserId !== undefined ? body.managerUserId : before.manager_user_id,
      status: body.status !== undefined ? body.status : before.status,
      notes: body.notes !== undefined ? (body.notes?.trim() || null) : before.notes,
    };
    await db.run('UPDATE projects SET name = ?, description = ?, manager_user_id = ?, active = ?, status = ?, priority = ?, notes = ?, updated_at = ? WHERE id = ?',
      merged.name, merged.description, merged.manager_user_id, merged.active === false || merged.active === 0 ? 0 : 1, merged.status,
      merged.priority, merged.notes, new Date().toISOString(), id);
    await auditService.recordDiff({
      entityType: 'PROJECT', entityId: id, projectId: id,
      before, after: { ...before, ...body, notes: merged.notes },
      fieldsToTrack: ['name', 'description', 'active', 'status', 'priority', 'notes'],
      actor: req.user, req,
    });
    if (manager) {
      await grantManagerScope(manager, id);
      const previous = before.manager_user_id
        ? await db.get('SELECT id, name FROM users WHERE id = ?', before.manager_user_id)
        : null;
      // Names (with ids) instead of bare ids, so the audit log is readable.
      await auditService.record({
        entityType: 'PROJECT', entityId: id, projectId: id, actionType: 'UPDATE', fieldName: 'manager_user_id',
        oldValue: previous ? `${previous.name} (#${previous.id})` : null,
        newValue: `${manager.name} (#${manager.id})`,
        actor: req.user, req,
      });
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;

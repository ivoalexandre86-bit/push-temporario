const express = require('express');
const { z } = require('zod');
const db = require('../db/connection');
const { authenticate } = require('../middleware/auth');
const { requirePermission, allowedProjectIds, canAccessProject } = require('../middleware/rbac');
const { PERMISSIONS } = require('../permissions');
const auditService = require('../services/auditService');
const { AppError } = require('../middleware/errorHandler');

const router = express.Router();
router.use(authenticate);

router.get('/', async (req, res, next) => {
  try {
    const scoped = await allowedProjectIds(req.user);
    let rows;
    if (scoped === null) {
      rows = await db.all(`
        SELECT p.*, u.name AS manager_name,
          (SELECT COUNT(*) FROM actions a WHERE a.project_id = p.id AND a.deleted_at IS NULL) AS action_count
        FROM projects p LEFT JOIN users u ON u.id = p.manager_user_id
        ORDER BY p.name
      `);
    } else if (scoped.length === 0) {
      rows = [];
    } else {
      rows = await db.all(`
        SELECT p.*, u.name AS manager_name,
          (SELECT COUNT(*) FROM actions a WHERE a.project_id = p.id AND a.deleted_at IS NULL) AS action_count
        FROM projects p LEFT JOIN users u ON u.id = p.manager_user_id
        WHERE p.id IN (${scoped.map(() => '?').join(',')})
        ORDER BY p.name
      `, ...scoped);
    }
    res.json({ items: rows });
  } catch (err) { next(err); }
});

router.get('/managers', requirePermission(PERMISSIONS.PROJECTS_MANAGE), async (req, res, next) => {
  try {
    const items = await db.all(`
      SELECT u.id, u.name, r.key AS role
      FROM users u JOIN roles r ON r.id = u.role_id
      WHERE u.active = 1 AND r.key IN ('ADMIN','PROJECT_MANAGER')
      ORDER BY u.name
    `);
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

const upsertSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  managerUserId: z.number().int().positive().optional().nullable(),
  active: z.boolean().optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
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
    const info = await db.run(
      'INSERT INTO projects (name, description, manager_user_id, active, status) VALUES (?, ?, ?, ?, ?) RETURNING id',
      body.name, body.description || null, body.managerUserId || null, body.active === false ? 0 : 1, body.status || 'ANDAMENTO'
    );
    await auditService.record({ entityType: 'PROJECT', entityId: info.lastInsertRowid, actionType: 'CREATE', newValue: body.name, actor: req.user, req, projectId: info.lastInsertRowid });
    res.status(201).json({ id: info.lastInsertRowid });
  } catch (err) { next(err); }
});

router.patch('/:id', requirePermission(PERMISSIONS.PROJECTS_MANAGE), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const before = await db.get('SELECT * FROM projects WHERE id = ?', id);
    if (!before) throw new AppError(404, 'NOT_FOUND', 'Projeto não encontrado.');
    const body = upsertSchema.partial().parse(req.body);
    if (body.managerUserId !== undefined) await requireActiveProjectManager(body.managerUserId);
    const merged = {
      ...before, ...body,
      manager_user_id: body.managerUserId !== undefined ? body.managerUserId : before.manager_user_id,
      status: body.status !== undefined ? body.status : before.status,
    };
    await db.run('UPDATE projects SET name = ?, description = ?, manager_user_id = ?, active = ?, status = ?, updated_at = ? WHERE id = ?',
      merged.name, merged.description, merged.manager_user_id, merged.active === false || merged.active === 0 ? 0 : 1, merged.status, new Date().toISOString(), id);
    await auditService.recordDiff({
      entityType: 'PROJECT', entityId: id, projectId: id,
      before, after: { ...before, ...body, manager_user_id: merged.manager_user_id },
      fieldsToTrack: ['name', 'description', 'active', 'manager_user_id', 'status'],
      actor: req.user, req,
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;

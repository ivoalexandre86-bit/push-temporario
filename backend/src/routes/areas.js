const express = require('express');
const { z } = require('zod');
const db = require('../db/connection');
const { authenticate } = require('../middleware/auth');
const { requirePermission, allowedAreaIds } = require('../middleware/rbac');
const { PERMISSIONS } = require('../permissions');
const auditService = require('../services/auditService');
const { AppError } = require('../middleware/errorHandler');

const router = express.Router();
router.use(authenticate);

router.get('/', async (req, res, next) => {
  try {
    const scoped = await allowedAreaIds(req.user);
    let rows;
    if (scoped === null) {
      rows = await db.all('SELECT * FROM areas ORDER BY name');
    } else {
      rows = await db.all(`SELECT * FROM areas WHERE id IN (${scoped.map(() => '?').join(',')}) ORDER BY name`, ...scoped);
    }
    res.json({ items: rows });
  } catch (err) { next(err); }
});

const upsertSchema = z.object({
  name: z.string().min(1),
  projectId: z.number().optional().nullable(),
  active: z.boolean().optional(),
});

router.post('/', requirePermission(PERMISSIONS.AREAS_MANAGE), async (req, res, next) => {
  try {
    const body = upsertSchema.parse(req.body);
    const existing = await db.get('SELECT id FROM areas WHERE lower(name) = lower(?)', body.name);
    if (existing) throw new AppError(409, 'DUPLICATE', 'Já existe uma área/processo com este nome.');
    const info = await db.run('INSERT INTO areas (name, project_id, active) VALUES (?, ?, ?) RETURNING id', body.name, body.projectId || null, body.active === false ? 0 : 1);
    await auditService.record({ entityType: 'AREA', entityId: info.lastInsertRowid, actionType: 'CREATE', newValue: body.name, actor: req.user, req });
    res.status(201).json({ id: info.lastInsertRowid });
  } catch (err) { next(err); }
});

router.patch('/:id', requirePermission(PERMISSIONS.AREAS_MANAGE), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const before = await db.get('SELECT * FROM areas WHERE id = ?', id);
    if (!before) throw new AppError(404, 'NOT_FOUND', 'Área/processo não encontrado.');
    const body = upsertSchema.partial().parse(req.body);
    const merged = { ...before, ...body, project_id: body.projectId !== undefined ? body.projectId : before.project_id };
    await db.run('UPDATE areas SET name = ?, project_id = ?, active = ?, updated_at = ? WHERE id = ?',
      merged.name, merged.project_id, merged.active === false || merged.active === 0 ? 0 : 1, new Date().toISOString(), id);
    await auditService.recordDiff({
      entityType: 'AREA', entityId: id, before, after: { ...before, ...body },
      fieldsToTrack: ['name', 'active'], actor: req.user, req,
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;

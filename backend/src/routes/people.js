const express = require('express');
const { z } = require('zod');
const db = require('../db/connection');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { PERMISSIONS } = require('../permissions');
const auditService = require('../services/auditService');
const { AppError } = require('../middleware/errorHandler');

const router = express.Router();
router.use(authenticate);

// Distinct list of responsible-person names (imported "QUEM" catalog + any
// added since). Used to populate filter/assignee dropdowns.
router.get('/', async (req, res, next) => {
  try {
    const rows = await db.all('SELECT id, name, active FROM people ORDER BY name');
    res.json({ items: rows });
  } catch (err) { next(err); }
});

// The responsible list is edited by the same roles that manage the
// área/processo list (admins and project managers).
const upsertSchema = z.object({
  name: z.string().trim().min(1, 'Informe o nome do responsável.'),
  active: z.boolean().optional(),
});

router.post('/', requirePermission(PERMISSIONS.AREAS_MANAGE), async (req, res, next) => {
  try {
    const body = upsertSchema.parse(req.body);
    const existing = await db.get('SELECT id FROM people WHERE lower(name) = lower(?)', body.name);
    if (existing) throw new AppError(409, 'DUPLICATE', 'Já existe um responsável com este nome.');
    const info = await db.run('INSERT INTO people (name, active) VALUES (?, ?) RETURNING id', body.name, body.active === false ? 0 : 1);
    await auditService.record({ entityType: 'PERSON', entityId: info.lastInsertRowid, actionType: 'CREATE', newValue: body.name, actor: req.user, req });
    res.status(201).json({ id: info.lastInsertRowid });
  } catch (err) { next(err); }
});

router.patch('/:id', requirePermission(PERMISSIONS.AREAS_MANAGE), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const before = await db.get('SELECT * FROM people WHERE id = ?', id);
    if (!before) throw new AppError(404, 'NOT_FOUND', 'Responsável não encontrado.');
    const body = upsertSchema.partial().parse(req.body);
    if (body.name !== undefined && body.name.toLowerCase() !== before.name.toLowerCase()) {
      const clash = await db.get('SELECT id FROM people WHERE lower(name) = lower(?) AND id <> ?', body.name, id);
      if (clash) throw new AppError(409, 'DUPLICATE', 'Já existe um responsável com este nome.');
    }
    const name = body.name !== undefined ? body.name : before.name;
    const active = body.active !== undefined ? (body.active ? 1 : 0) : before.active;
    await db.run('UPDATE people SET name = ?, active = ? WHERE id = ?', name, active, id);
    // Actions keep the responsible's name as text too; keep it in step with a rename.
    if (name !== before.name) {
      await db.run('UPDATE actions SET responsible_name = ? WHERE person_id = ?', name, id);
    }
    await auditService.recordDiff({
      entityType: 'PERSON', entityId: id, before, after: { ...before, name, active },
      fieldsToTrack: ['name', 'active'], actor: req.user, req,
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;

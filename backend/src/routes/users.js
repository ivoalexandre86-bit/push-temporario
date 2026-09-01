const express = require('express');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const db = require('../db/connection');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { PERMISSIONS } = require('../permissions');
const auditService = require('../services/auditService');
const { AppError } = require('../middleware/errorHandler');

const router = express.Router();
router.use(authenticate);
router.use(requirePermission(PERMISSIONS.USERS_MANAGE));

router.get('/', async (req, res, next) => {
  try {
    const users = await db.all(`
      SELECT u.id, u.name, u.email, u.active, u.must_change_password, u.last_login_at,
             u.created_at, r.key AS role, r.name AS role_name
      FROM users u JOIN roles r ON r.id = u.role_id
      ORDER BY u.name
    `);
    for (const u of users) {
      u.projectScope = (await db.all('SELECT project_id FROM user_project_scope WHERE user_id = ?', u.id)).map((r) => r.project_id);
      u.areaScope = (await db.all('SELECT area_id FROM user_area_scope WHERE user_id = ?', u.id)).map((r) => r.area_id);
    }
    res.json({ items: users });
  } catch (err) { next(err); }
});

router.get('/roles', async (req, res, next) => {
  try {
    res.json({ items: await db.all('SELECT id, key, name, description FROM roles ORDER BY id') });
  } catch (err) { next(err); }
});

const createSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  role: z.string(),
  password: z.string().min(8).optional(),
  projectScope: z.array(z.number()).optional(),
  areaScope: z.array(z.number()).optional(),
});

router.post('/', async (req, res, next) => {
  try {
    const body = createSchema.parse(req.body);
    const role = await db.get('SELECT id FROM roles WHERE key = ?', body.role);
    if (!role) throw new AppError(400, 'INVALID_ROLE', 'Papel inválido.');
    const existing = await db.get('SELECT id FROM users WHERE lower(email) = lower(?)', body.email);
    if (existing) throw new AppError(409, 'EMAIL_TAKEN', 'Já existe um usuário com este e-mail.');

    const tempPassword = body.password || Math.random().toString(36).slice(2, 10) + 'Aa1!';
    const hash = bcrypt.hashSync(tempPassword, 10);

    const info = await db.run(`
      INSERT INTO users (name, email, password_hash, role_id, active, must_change_password)
      VALUES (?, ?, ?, ?, 1, 1) RETURNING id
    `, body.name, body.email, hash, role.id);

    const userId = info.lastInsertRowid;
    if (body.projectScope) {
      for (const pid of body.projectScope) {
        await db.run('INSERT INTO user_project_scope (user_id, project_id) VALUES (?, ?) ON CONFLICT (user_id, project_id) DO NOTHING', userId, pid);
      }
    }
    if (body.areaScope) {
      for (const aid of body.areaScope) {
        await db.run('INSERT INTO user_area_scope (user_id, area_id) VALUES (?, ?) ON CONFLICT (user_id, area_id) DO NOTHING', userId, aid);
      }
    }

    await auditService.record({ entityType: 'USER', entityId: userId, actionType: 'CREATE', actor: req.user, req, newValue: { name: body.name, email: body.email, role: body.role } });

    res.status(201).json({ id: userId, temporaryPassword: body.password ? undefined : tempPassword });
  } catch (err) {
    next(err);
  }
});

const updateSchema = z.object({
  name: z.string().min(2).optional(),
  role: z.string().optional(),
  active: z.boolean().optional(),
  projectScope: z.array(z.number()).optional(),
  areaScope: z.array(z.number()).optional(),
});

router.patch('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const before = await db.get(`
      SELECT u.*, r.key AS role_key FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?
    `, id);
    if (!before) throw new AppError(404, 'NOT_FOUND', 'Usuário não encontrado.');
    const body = updateSchema.parse(req.body);

    if (body.name !== undefined) {
      await db.run('UPDATE users SET name = ?, updated_at = ? WHERE id = ?', body.name, new Date().toISOString(), id);
      await auditService.record({ entityType: 'USER', entityId: id, actionType: 'UPDATE', fieldName: 'name', oldValue: before.name, newValue: body.name, actor: req.user, req });
    }
    if (body.role !== undefined && body.role !== before.role_key) {
      const role = await db.get('SELECT id FROM roles WHERE key = ?', body.role);
      if (!role) throw new AppError(400, 'INVALID_ROLE', 'Papel inválido.');
      await db.run('UPDATE users SET role_id = ?, updated_at = ? WHERE id = ?', role.id, new Date().toISOString(), id);
      await auditService.record({ entityType: 'USER', entityId: id, actionType: 'UPDATE', fieldName: 'role', oldValue: before.role_key, newValue: body.role, actor: req.user, req });
    }
    if (body.active !== undefined && !!body.active !== !!before.active) {
      await db.run('UPDATE users SET active = ?, updated_at = ? WHERE id = ?', body.active ? 1 : 0, new Date().toISOString(), id);
      await auditService.record({ entityType: 'USER', entityId: id, actionType: 'UPDATE', fieldName: 'active', oldValue: !!before.active, newValue: !!body.active, actor: req.user, req });
    }
    if (body.projectScope !== undefined) {
      await db.run('DELETE FROM user_project_scope WHERE user_id = ?', id);
      for (const pid of body.projectScope) {
        await db.run('INSERT INTO user_project_scope (user_id, project_id) VALUES (?, ?) ON CONFLICT (user_id, project_id) DO NOTHING', id, pid);
      }
      await auditService.record({ entityType: 'USER', entityId: id, actionType: 'UPDATE', fieldName: 'projectScope', newValue: body.projectScope, actor: req.user, req });
    }
    if (body.areaScope !== undefined) {
      await db.run('DELETE FROM user_area_scope WHERE user_id = ?', id);
      for (const aid of body.areaScope) {
        await db.run('INSERT INTO user_area_scope (user_id, area_id) VALUES (?, ?) ON CONFLICT (user_id, area_id) DO NOTHING', id, aid);
      }
      await auditService.record({ entityType: 'USER', entityId: id, actionType: 'UPDATE', fieldName: 'areaScope', newValue: body.areaScope, actor: req.user, req });
    }

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/reset-password', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const user = await db.get('SELECT id, name FROM users WHERE id = ?', id);
    if (!user) throw new AppError(404, 'NOT_FOUND', 'Usuário não encontrado.');
    const tempPassword = Math.random().toString(36).slice(2, 10) + 'Aa1!';
    const hash = bcrypt.hashSync(tempPassword, 10);
    await db.run('UPDATE users SET password_hash = ?, must_change_password = 1, failed_login_count = 0, locked_until = NULL WHERE id = ?', hash, id);
    await auditService.record({ entityType: 'USER', entityId: id, actionType: 'PASSWORD_RESET_BY_ADMIN', actor: req.user, req });
    res.json({ temporaryPassword: tempPassword });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

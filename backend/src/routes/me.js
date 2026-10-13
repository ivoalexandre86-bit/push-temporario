const express = require('express');
const { z } = require('zod');
const db = require('../db/connection');
const { authenticate, signAccessToken, setAuthCookie } = require('../middleware/auth');
const { allowedProjectIds } = require('../middleware/rbac');
const { ROLE_PERMISSIONS } = require('../permissions');
const auditService = require('../services/auditService');
const { AppError } = require('../middleware/errorHandler');
const { newPasswordSchema, hashPassword, verifyPassword } = require('../services/passwordPolicy');
const { isDemoEmail } = require('../config');

const router = express.Router();
router.use(authenticate);

router.get('/', async (req, res, next) => {
  try {
    const projectIds = await allowedProjectIds(req.user);
    res.json({
      id: req.user.id,
      name: req.user.name,
      email: req.user.email,
      role: req.user.role_key,
      roleName: req.user.role_name,
      permissions: ROLE_PERMISSIONS[req.user.role_key] || [],
      scopedProjectIds: projectIds, // null = all projects
    });
  } catch (err) { next(err); }
});

const profileSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome (ao menos 2 caracteres).').max(120, 'O nome deve ter no máximo 120 caracteres.').optional(),
  email: z.string().trim().toLowerCase().email('Informe um e-mail válido.').max(254).optional(),
  currentPassword: z.string().optional(),
}).refine((b) => b.name !== undefined || b.email !== undefined, { message: 'Nada para atualizar.' });

/** Lets the signed-in user edit their own name and e-mail (role/status stay with admins). */
router.patch('/', async (req, res, next) => {
  try {
    const body = profileSchema.parse(req.body);
    const user = await db.get('SELECT id, name, email, password_hash FROM users WHERE id = ?', req.user.id);
    const changes = {};
    if (body.name !== undefined && body.name !== user.name) changes.name = body.name;
    if (body.email !== undefined && body.email !== user.email.toLowerCase()) changes.email = body.email;

    if (changes.email) {
      // The e-mail is the login and where reset links go: confirm it is really the owner.
      if (!verifyPassword(body.currentPassword || '', user.password_hash)) {
        throw new AppError(400, 'INVALID_PASSWORD', 'Para alterar o e-mail, informe sua senha atual correta.');
      }
      if (isDemoEmail(user.email) || isDemoEmail(changes.email)) {
        throw new AppError(400, 'DEMO_ACCOUNT', 'Contas de demonstração não podem alterar o e-mail.');
      }
      const taken = await db.get('SELECT id FROM users WHERE lower(email) = lower(?) AND id <> ?', changes.email, user.id);
      if (taken) throw new AppError(409, 'EMAIL_TAKEN', 'Já existe um usuário com este e-mail.');
    }

    if (Object.keys(changes).length) {
      const nowIso = new Date().toISOString();
      await db.run('UPDATE users SET name = ?, email = ?, updated_at = ? WHERE id = ?',
        changes.name ?? user.name, changes.email ?? user.email, nowIso, user.id);
      // Pending reset links were addressed to the old e-mail.
      if (changes.email) await db.run('UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL', nowIso, user.id);
      for (const [field, value] of Object.entries(changes)) {
        await auditService.record({ entityType: 'USER', entityId: user.id, actionType: 'UPDATE', fieldName: field, oldValue: user[field], newValue: value, actor: req.user, req });
      }
    }

    res.json({ ok: true, message: Object.keys(changes).length ? 'Perfil atualizado com sucesso.' : 'Nenhuma alteração.', name: changes.name ?? user.name, email: changes.email ?? user.email });
  } catch (err) {
    next(err);
  }
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Informe a senha atual.'),
  newPassword: newPasswordSchema,
  confirmPassword: z.string().optional(),
}).refine((b) => b.confirmPassword === undefined || b.confirmPassword === b.newPassword, {
  message: 'A confirmação não corresponde à nova senha.',
  path: ['confirmPassword'],
});

router.post('/change-password', async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
    const user = await db.get(
      `SELECT u.*, r.key AS role_key FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`,
      req.user.id
    );
    if (!verifyPassword(currentPassword, user.password_hash)) {
      throw new AppError(400, 'INVALID_PASSWORD', 'Senha atual incorreta.');
    }
    if (currentPassword === newPassword) {
      throw new AppError(400, 'SAME_PASSWORD', 'A nova senha deve ser diferente da senha atual.');
    }
    const nowIso = new Date().toISOString();
    await db.run('UPDATE users SET password_hash = ?, password_changed_at = ?, must_change_password = 0, updated_at = ? WHERE id = ?',
      hashPassword(newPassword), nowIso, nowIso, user.id);
    await db.run('UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL', nowIso, user.id);
    await auditService.record({ entityType: 'USER', entityId: user.id, actionType: 'PASSWORD_CHANGE', actor: req.user, req });

    // Sessions opened before the change stop working (other devices); this
    // one continues with a fresh token.
    const token = signAccessToken({ ...user, password_changed_at: nowIso });
    setAuthCookie(res, token);
    res.json({ ok: true, message: 'Senha alterada com sucesso.', token });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

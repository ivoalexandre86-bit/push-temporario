const express = require('express');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const db = require('../db/connection');
const { authenticate } = require('../middleware/auth');
const { allowedProjectIds } = require('../middleware/rbac');
const { ROLE_PERMISSIONS } = require('../permissions');
const auditService = require('../services/auditService');
const { AppError } = require('../middleware/errorHandler');

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

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, 'A senha deve ter ao menos 8 caracteres.'),
});

router.post('/change-password', async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
    const user = await db.get('SELECT * FROM users WHERE id = ?', req.user.id);
    if (!user.password_hash || !bcrypt.compareSync(currentPassword, user.password_hash)) {
      throw new AppError(400, 'INVALID_PASSWORD', 'Senha atual incorreta.');
    }
    const hash = bcrypt.hashSync(newPassword, 10);
    await db.run('UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?',
      hash, new Date().toISOString(), user.id);
    await auditService.record({ entityType: 'USER', entityId: user.id, actionType: 'PASSWORD_CHANGE', actor: req.user, req });
    res.json({ ok: true, message: 'Senha alterada com sucesso.' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

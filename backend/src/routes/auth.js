const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { z } = require('zod');
const db = require('../db/connection');
const { signAccessToken, setAuthCookie, clearAuthCookie, authenticate } = require('../middleware/auth');
const { loginLimiter } = require('../middleware/rateLimiters');
const auditService = require('../services/auditService');
const { AppError } = require('../middleware/errorHandler');

const router = express.Router();

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

async function getUserByEmail(email) {
  return db.get(
    `SELECT u.*, r.key AS role_key, r.name AS role_name
     FROM users u JOIN roles r ON r.id = u.role_id
     WHERE lower(u.email) = lower(?)`,
    email
  );
}

router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { email, password } = loginSchema.parse(req.body);
    const user = await getUserByEmail(email);

    if (!user) {
      await auditService.record({ entityType: 'AUTH', entityId: email, actionType: 'LOGIN_FAILED', actor: null, req, newValue: 'user not found' });
      return res.status(401).json({ error: 'INVALID_CREDENTIALS', message: 'E-mail ou senha inválidos.' });
    }
    if (!user.active) {
      return res.status(403).json({ error: 'ACCOUNT_INACTIVE', message: 'Esta conta está inativa. Contate o administrador.' });
    }
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      return res.status(423).json({ error: 'ACCOUNT_LOCKED', message: `Conta bloqueada temporariamente por excesso de tentativas. Tente novamente após ${new Date(user.locked_until).toLocaleTimeString('pt-BR')}.` });
    }

    const valid = user.password_hash && bcrypt.compareSync(password, user.password_hash);
    if (!valid) {
      const failedCount = (user.failed_login_count || 0) + 1;
      const lockUntil = failedCount >= MAX_FAILED_ATTEMPTS
        ? new Date(Date.now() + LOCK_MINUTES * 60 * 1000).toISOString()
        : null;
      await db.run('UPDATE users SET failed_login_count = ?, locked_until = ? WHERE id = ?', failedCount, lockUntil, user.id);
      await auditService.record({ entityType: 'AUTH', entityId: user.id, actionType: 'LOGIN_FAILED', actor: { id: user.id, name: user.name }, req });
      return res.status(401).json({ error: 'INVALID_CREDENTIALS', message: 'E-mail ou senha inválidos.' });
    }

    await db.run('UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login_at = ? WHERE id = ?', new Date().toISOString(), user.id);

    const token = signAccessToken(user);
    setAuthCookie(res, token);
    await auditService.record({ entityType: 'AUTH', entityId: user.id, actionType: 'LOGIN', actor: { id: user.id, name: user.name }, req });

    res.json({
      token, // also returned in body so non-cookie/API clients can use Bearer auth
      user: {
        id: user.id, name: user.name, email: user.email,
        role: user.role_key, roleName: user.role_name,
        mustChangePassword: !!user.must_change_password,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', authenticate, async (req, res) => {
  await auditService.record({ entityType: 'AUTH', entityId: req.user.id, actionType: 'LOGOUT', actor: req.user, req });
  clearAuthCookie(res);
  res.json({ ok: true });
});

const forgotSchema = z.object({ email: z.string().email() });

router.post('/forgot-password', loginLimiter, async (req, res, next) => {
  try {
    const { email } = forgotSchema.parse(req.body);
    const user = await getUserByEmail(email);
    // Always respond the same way to avoid leaking which emails exist.
    const genericResponse = { ok: true, message: 'Se o e-mail existir em nossa base, um link de redefinição foi enviado.' };
    if (!user) return res.json(genericResponse);

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    await db.run('INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)', user.id, tokenHash, expiresAt);

    await auditService.record({ entityType: 'AUTH', entityId: user.id, actionType: 'PASSWORD_RESET_REQUESTED', actor: { id: user.id, name: user.name }, req });

    // No email transport is configured in this environment. In non-production
    // deployments we surface the raw token so the flow can be exercised
    // end-to-end; wire an email provider (SES/SendGrid/etc.) and drop this
    // field in production.
    if (process.env.NODE_ENV !== 'production') {
      return res.json({ ...genericResponse, devToken: rawToken });
    }
    res.json(genericResponse);
  } catch (err) {
    next(err);
  }
});

const resetSchema = z.object({
  token: z.string().min(10),
  newPassword: z.string().min(8, 'A senha deve ter ao menos 8 caracteres.'),
});

router.post('/reset-password', loginLimiter, async (req, res, next) => {
  try {
    const { token, newPassword } = resetSchema.parse(req.body);
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const row = await db.get('SELECT * FROM password_reset_tokens WHERE token_hash = ?', tokenHash);
    if (!row || row.used_at || new Date(row.expires_at) < new Date()) {
      throw new AppError(400, 'INVALID_TOKEN', 'Link de redefinição inválido ou expirado.');
    }
    const passwordHash = bcrypt.hashSync(newPassword, 10);
    await db.run('UPDATE users SET password_hash = ?, must_change_password = 0, failed_login_count = 0, locked_until = NULL WHERE id = ?', passwordHash, row.user_id);
    await db.run('UPDATE password_reset_tokens SET used_at = ? WHERE id = ?', new Date().toISOString(), row.id);
    const user = await db.get('SELECT id, name FROM users WHERE id = ?', row.user_id);
    await auditService.record({ entityType: 'AUTH', entityId: row.user_id, actionType: 'PASSWORD_RESET', actor: user, req });
    res.json({ ok: true, message: 'Senha redefinida com sucesso. Você já pode fazer login.' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

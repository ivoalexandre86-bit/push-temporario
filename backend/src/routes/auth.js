const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { z } = require('zod');
const db = require('../db/connection');
const { signAccessToken, setAuthCookie, clearAuthCookie, authenticate } = require('../middleware/auth');
const { loginLimiter, passwordResetLimiter } = require('../middleware/rateLimiters');
const auditService = require('../services/auditService');
const mailService = require('../services/mailService');
const { newPasswordSchema, hashPassword } = require('../services/passwordPolicy');
const { AppError } = require('../middleware/errorHandler');
const { DEMO_ACCOUNTS, isDemoEmail, demoLoginAllowed, demoPassword, isProduction } = require('../config');

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

// Public hints for the login screen. Lists the demo accounts only outside
// production (local development/test), so the production bundle and API
// never advertise demo credentials. The password is only shown while the
// development default is in use (SEED_DEMO_PASSWORD not set).
router.get('/login-hints', (req, res) => {
  if (isProduction() || !demoLoginAllowed()) return res.json({ demoAccounts: [] });
  res.json({
    demoAccounts: DEMO_ACCOUNTS.map((a) => a.email),
    demoPassword: process.env.SEED_DEMO_PASSWORD ? null : demoPassword(),
  });
});

router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { email, password } = loginSchema.parse(req.body);

    // Seeded demo accounts are disabled in production unless explicitly
    // re-enabled (ALLOW_DEMO_LOGIN=true). Same generic response as a wrong
    // password, so the endpoint does not reveal which accounts exist.
    if (isDemoEmail(email) && !demoLoginAllowed()) {
      await auditService.record({ entityType: 'AUTH', entityId: email, actionType: 'LOGIN_BLOCKED_DEMO', actor: null, req });
      return res.status(401).json({ error: 'INVALID_CREDENTIALS', message: 'E-mail ou senha inválidos.' });
    }

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

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hora

function hashResetToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

const forgotSchema = z.object({ email: z.string().trim().email('Informe um e-mail válido.') });

router.post('/forgot-password', passwordResetLimiter, async (req, res, next) => {
  try {
    const { email } = forgotSchema.parse(req.body);
    // Always the same answer (and no token in the body), so the endpoint
    // never reveals whether an e-mail is registered.
    const genericResponse = { ok: true, message: 'Se o e-mail estiver cadastrado, você receberá em instantes um link para redefinir a senha.' };

    const user = await getUserByEmail(email);
    const eligible = user && user.active && user.password_hash && !(isDemoEmail(user.email) && !demoLoginAllowed());
    if (!eligible) {
      await auditService.record({ entityType: 'AUTH', entityId: email, actionType: 'PASSWORD_RESET_REQUESTED', actor: null, req, newValue: 'ignored: no eligible account' });
      return res.json(genericResponse);
    }

    // Only the SHA-256 hash is stored; the raw token exists only in the e-mail.
    const rawToken = crypto.randomBytes(32).toString('hex');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + RESET_TOKEN_TTL_MS).toISOString();
    await db.transaction(async (tx) => {
      // A new request supersedes any earlier link still pending, and expired rows are cleaned up.
      await tx.run('UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL', now.toISOString(), user.id);
      await tx.run('DELETE FROM password_reset_tokens WHERE expires_at < ?', new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString());
      await tx.run('INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)', user.id, hashResetToken(rawToken), expiresAt);
    });

    await auditService.record({ entityType: 'AUTH', entityId: user.id, actionType: 'PASSWORD_RESET_REQUESTED', actor: { id: user.id, name: user.name }, req });

    // Sent in the background: waiting for the SMTP server would make the
    // response time differ between registered and unknown e-mails.
    mailService.sendPasswordResetEmail({ to: user.email, name: user.name, rawToken })
      .catch((err) => console.error('[mail] falha ao enviar e-mail de redefinição de senha:', err.message));

    res.json(genericResponse);
  } catch (err) {
    next(err);
  }
});

const INVALID_RESET_LINK = 'Link de redefinição inválido ou expirado. Solicite um novo.';

const resetSchema = z.object({
  token: z.string().trim().regex(/^[0-9a-f]{64}$/i, INVALID_RESET_LINK),
  newPassword: newPasswordSchema,
  confirmPassword: z.string().optional(),
}).refine((b) => b.confirmPassword === undefined || b.confirmPassword === b.newPassword, {
  message: 'A confirmação não corresponde à nova senha.',
  path: ['confirmPassword'],
});

/** Lets the reset screen tell the user up front that a link is no longer valid. */
router.get('/reset-password/validate', loginLimiter, async (req, res, next) => {
  try {
    const token = String(req.query.token || '').trim();
    const row = /^[0-9a-f]{64}$/i.test(token)
      ? await db.get('SELECT id FROM password_reset_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?', hashResetToken(token), new Date().toISOString())
      : null;
    res.json({ valid: !!row });
  } catch (err) {
    next(err);
  }
});

router.post('/reset-password', loginLimiter, async (req, res, next) => {
  try {
    const { token, newPassword } = resetSchema.parse(req.body);
    const nowIso = new Date().toISOString();
    const passwordHash = hashPassword(newPassword);

    const userId = await db.transaction(async (tx) => {
      // Claim the token atomically: a second use (or a concurrent one) finds nothing.
      const claimed = await tx.run(
        'UPDATE password_reset_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ? RETURNING user_id',
        nowIso, hashResetToken(token), nowIso
      );
      const id = claimed.rows[0]?.user_id;
      if (!id) throw new AppError(400, 'INVALID_TOKEN', INVALID_RESET_LINK);
      await tx.run(
        'UPDATE users SET password_hash = ?, password_changed_at = ?, must_change_password = 0, failed_login_count = 0, locked_until = NULL, updated_at = ? WHERE id = ?',
        passwordHash, nowIso, nowIso, id
      );
      await tx.run('UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL', nowIso, id);
      return id;
    });

    const user = await db.get('SELECT id, name FROM users WHERE id = ?', userId);
    await auditService.record({ entityType: 'AUTH', entityId: userId, actionType: 'PASSWORD_RESET', actor: user, req });
    res.json({ ok: true, message: 'Senha redefinida com sucesso. Você já pode entrar com a nova senha.' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

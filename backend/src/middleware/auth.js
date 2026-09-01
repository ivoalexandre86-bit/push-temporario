const jwt = require('jsonwebtoken');
const db = require('../db/connection');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-insecure-secret-change-me';
const ACCESS_TOKEN_TTL = process.env.ACCESS_TOKEN_TTL || '30m'; // session timeout window
const ACCESS_COOKIE = 'projetos_at';

function signAccessToken(user) {
  return jwt.sign(
    { sub: user.id, roleKey: user.role_key, name: user.name, email: user.email },
    JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_TTL }
  );
}

function setAuthCookie(res, token) {
  res.cookie(ACCESS_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 30 * 60 * 1000,
    path: '/',
  });
}

function clearAuthCookie(res) {
  res.clearCookie(ACCESS_COOKIE, { path: '/' });
}

async function getUserWithRole(id) {
  return db.get(
    `SELECT u.id, u.name, u.email, u.active, r.key AS role_key, r.name AS role_name
     FROM users u JOIN roles r ON r.id = u.role_id
     WHERE u.id = ?`,
    id
  );
}

/** Populates req.user from the access-token cookie (or Bearer header, for API clients). */
async function authenticate(req, res, next) {
  const token = req.cookies?.[ACCESS_COOKIE] || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) {
    return res.status(401).json({ error: 'NOT_AUTHENTICATED', message: 'Sessão não encontrada. Faça login novamente.' });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await getUserWithRole(payload.sub);
    if (!user || !user.active) {
      return res.status(401).json({ error: 'NOT_AUTHENTICATED', message: 'Usuário inativo ou não encontrado.' });
    }
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'SESSION_EXPIRED', message: 'Sessão expirada. Faça login novamente.' });
  }
}

/** Like authenticate(), but does not fail the request when no/invalid token is present. */
async function optionalAuthenticate(req, res, next) {
  const token = req.cookies?.[ACCESS_COOKIE] || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return next();
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await getUserWithRole(payload.sub);
    if (user && user.active) req.user = user;
  } catch (_) {
    /* ignore */
  }
  next();
}

module.exports = {
  signAccessToken,
  setAuthCookie,
  clearAuthCookie,
  authenticate,
  optionalAuthenticate,
  ACCESS_COOKIE,
  JWT_SECRET,
};

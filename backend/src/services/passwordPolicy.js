// Single password policy for every place a user sets their own password
// (troca no perfil, redefinição por e-mail). Same rules/hash as the rest of
// the backend: at least 8 characters, bcrypt with cost 10. bcrypt only uses
// the first 72 bytes, so longer inputs are rejected instead of truncated.
const bcrypt = require('bcryptjs');
const { z } = require('zod');

const BCRYPT_ROUNDS = 10;

const newPasswordSchema = z.string()
  .min(8, 'A senha deve ter ao menos 8 caracteres.')
  .refine((p) => Buffer.byteLength(p, 'utf8') <= 72, 'A senha deve ter no máximo 72 caracteres.');

function hashPassword(password) {
  return bcrypt.hashSync(password, BCRYPT_ROUNDS);
}

function verifyPassword(password, hash) {
  return !!hash && bcrypt.compareSync(password, hash);
}

module.exports = { BCRYPT_ROUNDS, newPasswordSchema, hashPassword, verifyPassword };

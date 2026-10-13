// Outgoing e-mail (SMTP via nodemailer), configured only through environment
// variables: SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS,
// MAIL_FROM and APP_URL (public URL of the frontend, used to build links).
//
// Without SMTP_HOST the message is not sent: outside production the reset
// link is only written to the server log, so the flow can be exercised
// locally. Credentials are never logged.
const nodemailer = require('nodemailer');
const { isProduction } = require('../config');

let cachedTransport = null;
let cachedKey = null;

function smtpConfigured(env = process.env) {
  return !!env.SMTP_HOST;
}

function getTransport(env = process.env) {
  const port = Number(env.SMTP_PORT) || 587;
  const secure = env.SMTP_SECURE ? env.SMTP_SECURE === 'true' : port === 465;
  const key = [env.SMTP_HOST, port, secure, env.SMTP_USER, env.SMTP_PASS].join('|');
  if (!cachedTransport || cachedKey !== key) {
    cachedTransport = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port,
      secure,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    });
    cachedKey = key;
  }
  return cachedTransport;
}

/** Public base URL of the frontend (no trailing slash). */
function appUrl(env = process.env) {
  const url = env.APP_URL || (isProduction() ? '' : 'http://localhost:5173');
  return url.replace(/\/+$/, '');
}

function passwordResetLink(rawToken, env = process.env) {
  return `${appUrl(env)}/redefinir-senha?token=${encodeURIComponent(rawToken)}`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * Sends the password-reset e-mail. Resolves to { sent: true } when handed
 * to the SMTP server, or { sent: false } when SMTP is not configured.
 */
async function sendPasswordResetEmail({ to, name, rawToken }) {
  const link = passwordResetLink(rawToken);

  if (!smtpConfigured()) {
    if (isProduction()) {
      console.warn('[mail] SMTP não configurado: e-mail de redefinição de senha não enviado.');
    } else {
      console.log(`[mail] SMTP não configurado. Link de redefinição para ${to}: ${link}`);
    }
    return { sent: false };
  }
  if (!appUrl()) {
    console.warn('[mail] APP_URL não definido: o link de redefinição ficaria incompleto; e-mail não enviado.');
    return { sent: false };
  }

  const greeting = name ? `Olá, ${name}.` : 'Olá.';
  const text = [
    greeting,
    '',
    'Recebemos um pedido para redefinir a senha da sua conta no Sistema de Gestão de Projetos.',
    'Para criar uma nova senha, acesse o link abaixo (válido por 1 hora e de uso único):',
    '',
    link,
    '',
    'Se você não fez este pedido, ignore este e-mail: sua senha atual continua valendo.',
  ].join('\n');
  const html = `<p>${escapeHtml(greeting)}</p>
<p>Recebemos um pedido para redefinir a senha da sua conta no Sistema de Gestão de Projetos.</p>
<p>Para criar uma nova senha, clique no link abaixo (válido por 1 hora e de uso único):</p>
<p><a href="${escapeHtml(link)}">Redefinir minha senha</a></p>
<p>Se você não fez este pedido, ignore este e-mail: sua senha atual continua valendo.</p>`;

  await getTransport().sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to,
    subject: 'Redefinição de senha - Sistema de Gestão de Projetos',
    text,
    html,
  });
  return { sent: true };
}

module.exports = { smtpConfigured, appUrl, passwordResetLink, sendPasswordResetEmail };

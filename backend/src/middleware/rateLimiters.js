const rateLimit = require('express-rate-limit');

// Tight limiter for authentication endpoints to slow down credential stuffing / brute force.
// (Relaxed automatically under NODE_ENV=test so functional test suites that legitimately
// log in as many different demo accounts aren't tripped up by IP-based throttling; the
// mechanism itself can still be exercised with a dedicated low-limit override if needed.)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: process.env.NODE_ENV === 'test' ? 100000 : (Number(process.env.RATE_LIMIT_LOGIN_MAX) || 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'RATE_LIMITED', message: 'Muitas tentativas de login. Tente novamente em alguns minutos.' },
});

// Looser general-purpose limiter for the whole API.
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'RATE_LIMITED', message: 'Muitas requisições. Tente novamente em instantes.' },
});

module.exports = { loginLimiter, apiLimiter };

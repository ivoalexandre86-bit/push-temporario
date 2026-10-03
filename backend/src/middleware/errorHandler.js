const { ZodError } = require('zod');

class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// Start of zod's built-in (English) messages - anything else was written by us.
const ZOD_DEFAULT_MESSAGE = /^(Required|Expected|Invalid|String must|Number must|Array must|Too (small|big)|Unrecognized|Should be)/;

function notFoundHandler(req, res) {
  res.status(404).json({ error: 'NOT_FOUND', message: 'Recurso não encontrado.' });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof ZodError) {
    // Surface the messages written in pt-BR by the schemas (custom refines
    // and explicit messages); zod's built-in English defaults stay in details.
    const localized = [...new Set(err.issues
      .map((i) => i.message)
      .filter((m) => !ZOD_DEFAULT_MESSAGE.test(m)))];
    return res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: localized.length ? `Dados inválidos: ${localized.join(' ')}` : 'Dados inválidos.',
      details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: err.code, message: err.message, details: err.details });
  }
  console.error('[error]', err);
  const status = err.status || 500;
  res.status(status).json({
    error: 'INTERNAL_ERROR',
    message: 'Ocorreu um erro inesperado. Tente novamente ou contate o administrador.',
  });
}

module.exports = { AppError, notFoundHandler, errorHandler };

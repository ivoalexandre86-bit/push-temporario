const { ZodError } = require('zod');

class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function notFoundHandler(req, res) {
  res.status(404).json({ error: 'NOT_FOUND', message: 'Recurso não encontrado.' });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: 'Dados inválidos.',
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

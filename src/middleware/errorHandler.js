const { adminPath } = require('../config/adminPanel');

const PRISMA_DB_CODES = new Set(['P2024', 'P1001', 'P1017', 'P1008', 'P1002']);

function isPrismaDbError(err) {
  return PRISMA_DB_CODES.has(err?.code) || PRISMA_DB_CODES.has(err?.errorCode);
}

function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  const dbDown = isPrismaDbError(err);
  const status = dbDown ? 503 : (err.status || 500);
  const message = dbDown
    ? 'No se pudo conectar a la base de datos. Espera un momento e inténtalo de nuevo.'
    : (err.message || 'Error interno del servidor');

  if (status >= 500) {
    console.error(err);
  }

  const path = String(req.originalUrl || req.path || '').split('?')[0];

  if (path.startsWith('/api')) {
    const payload = { success: false, message };
    if (err.code) payload.code = err.code;
    return res.status(status).json(payload);
  }

  const adminRedirects = [
    ['/usuarios', '/usuarios'],
    ['/companies', '/companies'],
    ['/catalogo', '/catalogo'],
    ['/comprobantes', '/comprobantes'],
    ['/clientes', '/clientes'],
    ['/almacenes', '/almacenes'],
  ];

  for (const [suffix, dest] of adminRedirects) {
    if (path === adminPath(suffix) || path.startsWith(`${adminPath(suffix)}/`)) {
      const q = new URLSearchParams({ msg: message, tipo: 'error' });
      return res.redirect(`${adminPath(dest)}?${q.toString()}`);
    }
  }

  res.status(status).send(`<p style="font-family:sans-serif;padding:2rem;">${message}</p>`);
}

module.exports = errorHandler;

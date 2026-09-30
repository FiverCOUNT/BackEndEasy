const { enterWithEntorno } = require('../config/prisma');

function normalizeAdminEntorno(raw) {
  return String(raw || '').trim().toLowerCase() === 'beta' ? 'beta' : 'prod';
}

/** Filtro del panel: query/body, si no la sesión. Toda la petición usa esa base. */
function bindAdminEntorno(req, res, next) {
  const raw = req.query?.entorno || req.session?.adminEntorno || 'prod';
  const entorno = normalizeAdminEntorno(raw);
  if (req.session) req.session.adminEntorno = entorno;
  enterWithEntorno(entorno);

  res.locals.adminEntorno = entorno;
  res.locals.adminEntornoLabel = entorno === 'beta' ? 'beta' : 'producción';

  const params = new URLSearchParams();
  Object.entries(req.query || {}).forEach(([key, value]) => {
    if (key === 'entorno' || value == null || value === '') return;
    params.set(key, String(value));
  });
  const base = res.locals.adminBase || '';
  const path = req.path || '/';
  const href = (dest) => {
    const next = new URLSearchParams(params);
    next.set('entorno', dest);
    return `${base}${path}?${next.toString()}`;
  };
  res.locals.entornoHrefProd = href('prod');
  res.locals.entornoHrefBeta = href('beta');
  next();
}

module.exports = {
  normalizeAdminEntorno,
  bindAdminEntorno,
};

/**
 * Prefijo del panel de plataforma (empresas, usuarios globales, etc.).
 * Solo SUPER_ADMIN puede entrar.
 */
const ADMIN_BASE = '/admin';

function adminPath(path = '/') {
  const p = String(path || '/');
  if (p === '/' || p === '') return ADMIN_BASE;
  return `${ADMIN_BASE}${p.startsWith('/') ? p : `/${p}`}`;
}

module.exports = { ADMIN_BASE, adminPath };

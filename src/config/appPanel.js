/**
 * Prefijo del panel web de empresa (ADMIN de app).
 * Misma sesión cookie; rutas separadas de /admin (SUPER_ADMIN).
 */
const APP_BASE = '/app';

function appPath(path = '/') {
  const p = String(path || '/');
  if (p === '/' || p === '') return APP_BASE;
  return `${APP_BASE}${p.startsWith('/') ? p : `/${p}`}`;
}

/** Menú lateral / grid: opciones alineadas a la app móvil. */
const APP_NAV_ITEMS = [
  { id: 'inicio', href: '/', label: 'Inicio', icon: '⌂', group: 'main' },
  { id: 'emitir', href: '/emitir', label: 'Emitir', icon: '⇄', group: 'main' },
  { id: 'ordenes', href: '/ordenes', label: 'Órdenes', icon: '📋', group: 'main' },
  { id: 'comprobantes', href: '/comprobantes', label: 'Comprobantes', icon: '☰', group: 'main' },
  { id: 'clientes', href: '/clientes', label: 'Clientes', icon: '👤', group: 'modulos' },
  { id: 'catalogo', href: '/catalogo', label: 'Catálogo', icon: '▦', group: 'modulos' },
  { id: 'lotes', href: '/lotes', label: 'Lotes', icon: '▣', group: 'modulos', adminOnly: true },
  { id: 'compras', href: '/compras', label: 'Compras', icon: '🛒', group: 'modulos', adminOnly: true },
  { id: 'salidas', href: '/salidas', label: 'Salidas', icon: '↗', group: 'modulos' },
  { id: 'ingresos', href: '/ingresos', label: 'Ingresos', icon: '↘', group: 'modulos', adminOnly: true },
  { id: 'historial', href: '/historial', label: 'Historial', icon: '◷', group: 'modulos' },
  { id: 'almacenes', href: '/almacenes', label: 'Almacenes', icon: '▣', group: 'modulos', adminOnly: true },
  { id: 'ajustes', href: '/ajustes', label: 'Ajustes', icon: '⚙', group: 'main' },
];

module.exports = { APP_BASE, appPath, APP_NAV_ITEMS };

const { APP_NAV_ITEMS, appPath } = require('../config/appPanel');

function renderSection(req, res, { title, active, subtitle }) {
  res.render('app/section', {
    title,
    active,
    subtitle: subtitle || 'Vista web · próximamente conectada a la API',
    webUser: res.locals.webUser,
    appBase: res.locals.appBase,
    companyNombre: res.locals.companyNombre,
    companyRuc: res.locals.companyRuc,
    navItems: APP_NAV_ITEMS,
  });
}

function dashboard(req, res) {
  res.render('app/dashboard', {
    title: 'Inicio',
    active: 'inicio',
    webUser: res.locals.webUser,
    appBase: res.locals.appBase,
    companyNombre: res.locals.companyNombre,
    companyRuc: res.locals.companyRuc,
    navItems: APP_NAV_ITEMS,
  });
}

function emitir(req, res) {
  renderSection(req, res, {
    title: 'Emitir',
    active: 'emitir',
    subtitle: 'Factura, boleta, notas y guías (como en la app)',
  });
}

function comprobantes(req, res) {
  renderSection(req, res, {
    title: 'Comprobantes',
    active: 'comprobantes',
    subtitle: 'Emitidos de tu empresa',
  });
}

function clientes(req, res) {
  renderSection(req, res, { title: 'Clientes', active: 'clientes' });
}

function catalogo(req, res) {
  renderSection(req, res, { title: 'Catálogo', active: 'catalogo' });
}

function compras(req, res) {
  renderSection(req, res, {
    title: 'Compras',
    active: 'compras',
    subtitle: 'Compras / CPE que te emitieron',
  });
}

function salidas(req, res) {
  renderSection(req, res, { title: 'Salidas', active: 'salidas' });
}

function ingresos(req, res) {
  renderSection(req, res, { title: 'Ingresos', active: 'ingresos' });
}

function historial(req, res) {
  renderSection(req, res, { title: 'Historial', active: 'historial' });
}

function almacenes(req, res) {
  renderSection(req, res, { title: 'Almacenes', active: 'almacenes' });
}

function ajustes(req, res) {
  renderSection(req, res, {
    title: 'Ajustes',
    active: 'ajustes',
    subtitle: 'Cuenta, empresa y preferencias',
  });
}

module.exports = {
  dashboard,
  emitir,
  comprobantes,
  clientes,
  catalogo,
  compras,
  salidas,
  ingresos,
  historial,
  almacenes,
  ajustes,
  appPath,
};

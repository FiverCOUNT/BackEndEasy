const { ADMIN_BASE, adminPath } = require('../config/adminPanel');
const { APP_BASE, appPath } = require('../config/appPanel');

function sessionUser(req) {
  return req.session?.webUser || req.session?.admin || null;
}

function isSuperAdmin(user) {
  return Boolean(user?.id && user.rol === 'SUPER_ADMIN');
}

function isCompanyAppUser(user) {
  return Boolean(user?.id && (user.rol === 'ADMIN' || user.rol === 'USUARIO'));
}

function homeForRole(rol) {
  if (rol === 'SUPER_ADMIN') return ADMIN_BASE;
  if (rol === 'ADMIN' || rol === 'USUARIO') return APP_BASE;
  return '/login';
}

/** Solo SUPER_ADMIN → rutas /admin (DB prod por defecto; CRUD de empresas elige DB por entorno). */
function requireWebAdmin(req, res, next) {
  if (req.path.startsWith('/api') || req.originalUrl.startsWith('/api')) {
    return next('route');
  }

  const user = sessionUser(req);
  if (!isSuperAdmin(user)) {
    const loginPath = '/login';
    const nextUrl = req.originalUrl && !req.originalUrl.startsWith('/login')
      ? `?next=${encodeURIComponent(req.originalUrl)}`
      : '';
    return res.redirect(`${loginPath}${nextUrl}`);
  }

  const { enterWithEntorno } = require('../config/prisma');
  enterWithEntorno('prod');
  res.locals.adminUser = user;
  res.locals.webUser = user;
  res.locals.adminBase = ADMIN_BASE;
  return next();
}

/** ADMIN o USUARIO de empresa → rutas /app (privilegios finos en middleware/controladores). */
async function requireWebApp(req, res, next) {
  if (req.path.startsWith('/api') || req.originalUrl.startsWith('/api')) {
    return next('route');
  }

  const user = sessionUser(req);
  if (isSuperAdmin(user)) {
    return res.redirect(ADMIN_BASE);
  }
  if (!isCompanyAppUser(user)) {
    const nextUrl = req.originalUrl && !req.originalUrl.startsWith('/login')
      ? `?next=${encodeURIComponent(req.originalUrl)}`
      : '';
    return res.redirect(`/login${nextUrl}`);
  }

  if (!user.companyRuc) {
    return res.redirect(`/login?msg=${encodeURIComponent('Usuario sin empresa asignada')}&tipo=error`);
  }

  const { enterWithEntorno, isProdEntorno } = require('../config/prisma');
  const companyModel = require('../models/companyModel');

  // Resolver empresa en ambas DBs y refrescar entorno de sesión.
  const companyLive = await companyModel.findByRucAcrossDbs(user.companyRuc).catch(() => null);
  const dbEntorno = companyLive
    ? (isProdEntorno(companyLive.entorno) ? 'prod' : 'beta')
    : (isProdEntorno(user.companyEntorno) ? 'prod' : 'beta');
  enterWithEntorno(dbEntorno);
  if (req.session?.webUser) {
    req.session.webUser.companyEntorno = dbEntorno;
  }
  if (req.session?.admin) {
    req.session.admin.companyEntorno = dbEntorno;
  }

  const { navItemsForUser, isWebCompanyAdmin } = require('../utils/appWebHelpers');
  const ordenModel = require('../models/ordenModel');

  res.locals.webUser = req.session.webUser || user;
  res.locals.appBase = APP_BASE;
  res.locals.companyRuc = user.companyRuc || '';
  res.locals.isWebAdmin = isWebCompanyAdmin(user);
  res.locals.userAlmacenId = user.almacenId || null;
  res.locals.navItems = navItemsForUser(user);
  res.locals.dbEntorno = dbEntorno;

  try {
    const company = companyLive || await companyModel.findByRuc(user.companyRuc);
    const display = companyModel.displayName(company) || user.companyNombre || 'Empresa';
    const entorno = companyModel.entornoLabel(company?.entorno || dbEntorno);
    res.locals.companyNombre = display;
    res.locals.companyRazonSocial = company?.nombre || display;
    res.locals.companyNombreComercial = company?.nombreComercial || null;
    res.locals.companyLogoUrl = companyModel.resolveLogoUrl(company);
    res.locals.companyInitials = companyModel.initialsFromName(display);
    res.locals.companyEntorno = entorno.key;
    res.locals.companyEntornoLabel = entorno.label;
    res.locals.companyEsProd = entorno.isProd;
  } catch {
    res.locals.companyNombre = user.companyNombre || 'Empresa';
    res.locals.companyRazonSocial = user.companyNombre || 'Empresa';
    res.locals.companyNombreComercial = null;
    res.locals.companyLogoUrl = null;
    res.locals.companyInitials = 'E';
    res.locals.companyEntorno = dbEntorno;
    res.locals.companyEntornoLabel = dbEntorno === 'prod' ? 'Producción' : 'Beta';
    res.locals.companyEsProd = dbEntorno === 'prod';
  }

  try {
    const configuracionModel = require('../models/configuracionModel');
    const configRow = await configuracionModel.getSingleton();
    res.locals.easyLogoUrl = '/img/easy-logo.png';
    res.locals.easyNombreApp = configRow?.nombreApp || 'Easy';
  } catch {
    res.locals.easyLogoUrl = '/img/easy-logo.png';
    res.locals.easyNombreApp = 'Easy';
  }

  try {
    res.locals.ordenesNoVistas = await ordenModel.countNoVistas(user.companyRuc);
  } catch {
    res.locals.ordenesNoVistas = 0;
  }
  // Badge "por vencer" solo para ADMIN (no rol usuario / otro almacén).
  try {
    if (isWebCompanyAdmin(user)) {
      const productoLoteModel = require('../models/productoLoteModel');
      res.locals.catalogoPorVencer = await productoLoteModel.countAlertasVencimiento(user.companyRuc);
    } else {
      res.locals.catalogoPorVencer = 0;
    }
  } catch {
    res.locals.catalogoPorVencer = 0;
  }
  return next();
}

/** Si ya hay sesión, no mostrar login. */
function redirectIfWebLoggedIn(req, res, next) {
  const user = sessionUser(req);
  if (isSuperAdmin(user) || isCompanyAppUser(user)) {
    return res.redirect(homeForRole(user.rol));
  }
  res.locals.adminBase = ADMIN_BASE;
  res.locals.appBase = APP_BASE;
  return next();
}

function isCompanyAdmin(user) {
  return Boolean(user?.id && user.rol === 'ADMIN');
}

/** Compat: nombre antiguo */
const redirectIfWebAdmin = redirectIfWebLoggedIn;

module.exports = {
  requireWebAdmin,
  requireWebApp,
  redirectIfWebLoggedIn,
  redirectIfWebAdmin,
  sessionUser,
  homeForRole,
  isSuperAdmin,
  isCompanyAppUser,
  isCompanyAdmin,
  adminPath,
  appPath,
};

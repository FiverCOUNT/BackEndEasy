const { appPath } = require('../config/appPanel');
const { isWebCompanyAdmin } = require('../utils/appWebHelpers');

const { layoutLocals } = require('../utils/appWebHelpers');

/** Solo ADMIN de empresa (equivalente a esAdmin() en la app móvil). */
function requireWebAppAdmin(req, res, next) {
  const user = res.locals.webUser || req.session?.webUser;
  if (!isWebCompanyAdmin(user)) {
    const wantsJson = String(req.headers.accept || '').includes('application/json')
      || String(req.query.format || '') === 'json'
      || req.xhr;
    if (wantsJson) {
      return res.status(403).json({
        success: false,
        message: 'Solo administradores pueden realizar esta acción.',
      });
    }
    return res.status(403).render('app/forbidden', layoutLocals(res, {
      title: 'Acceso restringido',
      active: '',
      message: 'Esta sección solo está disponible para administradores de la empresa.',
    }));
  }
  return next();
}

function blockIfNotAdmin(req, res) {
  const user = res.locals.webUser;
  if (!isWebCompanyAdmin(user)) {
    res.redirect(`${appPath('/')}?msg=${encodeURIComponent('Acceso solo para administradores')}&tipo=error`);
    return true;
  }
  return false;
}

module.exports = { requireWebAppAdmin, blockIfNotAdmin };

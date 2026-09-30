const { ADMIN_BASE } = require('../config/adminPanel');
const { APP_BASE } = require('../config/appPanel');
const { loginWebUser } = require('../services/webAuthService');
const { homeForRole } = require('../middleware/webAuth');

const SESSION_MAX_AGE_DEFAULT = 1000 * 60 * 60 * 12; // 12 horas
const SESSION_MAX_AGE_REMEMBER = 1000 * 60 * 60 * 24 * 30; // 30 días

function showLogin(req, res) {
  res.render('auth/login', {
    title: 'Iniciar sesión',
    error: null,
    email: '',
    recordarme: false,
    next: String(req.query.next || '').trim(),
    adminBase: ADMIN_BASE,
    appBase: APP_BASE,
  });
}

async function login(req, res, next) {
  try {
    const email = String(req.body.email || '').trim();
    const contrasena = String(req.body.contrasena || '');
    const nextUrl = String(req.body.next || '').trim();
    const recordarme = req.body.recordarme === '1'
      || req.body.recordarme === 'on'
      || req.body.recordarme === true
      || req.body.recordarme === 'true';

    const renderError = (error, status = 401) =>
      res.status(status).render('auth/login', {
        title: 'Iniciar sesión',
        error,
        email,
        recordarme,
        next: nextUrl,
        adminBase: ADMIN_BASE,
        appBase: APP_BASE,
      });

    if (!email || !contrasena) {
      return renderError('Email y contraseña son obligatorios.');
    }

    const user = await loginWebUser({ email, contrasena });

    const finishLogin = () => {
      req.session.webUser = user;
      req.session.admin = user;
      req.session.cookie.maxAge = recordarme ? SESSION_MAX_AGE_REMEMBER : SESSION_MAX_AGE_DEFAULT;

      const home = homeForRole(user.rol);
      const allowedPrefixes = [ADMIN_BASE, APP_BASE];
      const safeNext = nextUrl.startsWith('/')
        && !nextUrl.startsWith('//')
        && allowedPrefixes.some((p) => nextUrl === p || nextUrl.startsWith(`${p}/`))
        ? nextUrl
        : home;

      if (user.rol === 'SUPER_ADMIN' && safeNext.startsWith(APP_BASE)) {
        return res.redirect(ADMIN_BASE);
      }
      if ((user.rol === 'ADMIN' || user.rol === 'USUARIO') && safeNext.startsWith(ADMIN_BASE)) {
        return res.redirect(APP_BASE);
      }
      return res.redirect(safeNext);
    };

    // Regenerar sid para evitar session fixation.
    if (typeof req.session.regenerate === 'function') {
      return req.session.regenerate((err) => {
        if (err) return next(err);
        return finishLogin();
      });
    }
    return finishLogin();
  } catch (err) {
    if (err.status === 401 || err.status === 403) {
      return res.status(err.status).render('auth/login', {
        title: 'Iniciar sesión',
        error: err.message,
        email: String(req.body.email || '').trim(),
        recordarme: req.body.recordarme === '1' || req.body.recordarme === 'on',
        next: String(req.body.next || '').trim(),
        adminBase: ADMIN_BASE,
        appBase: APP_BASE,
      });
    }
    if (err.code === 'P2024' || err.code === 'P1001' || err.code === 'P1017' || err.code === 'P1008') {
      return res.status(503).render('auth/login', {
        title: 'Iniciar sesión',
        error: 'No se pudo conectar a la base de datos. Espera un momento e inténtalo de nuevo.',
        email: String(req.body.email || '').trim(),
        recordarme: req.body.recordarme === '1' || req.body.recordarme === 'on',
        next: String(req.body.next || '').trim(),
        adminBase: ADMIN_BASE,
        appBase: APP_BASE,
      });
    }
    return next(err);
  }
}

function logout(req, res, next) {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('be.sid');
    return res.redirect('/login');
  });
}

module.exports = {
  showLogin,
  login,
  logout,
};

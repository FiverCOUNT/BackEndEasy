const { loginWebAdmin } = require('../services/webAuthService');

function showLogin(req, res) {
  res.render('auth/login', {
    title: 'Iniciar sesión',
    error: null,
    email: '',
    next: String(req.query.next || '').trim(),
  });
}

async function login(req, res, next) {
  try {
    const email = String(req.body.email || '').trim();
    const contrasena = String(req.body.contrasena || '');
    const nextUrl = String(req.body.next || '').trim();

    const renderError = (error) =>
      res.status(401).render('auth/login', {
        title: 'Iniciar sesión',
        error,
        email,
        next: nextUrl,
      });

    if (!email || !contrasena) {
      return renderError('Email y contraseña son obligatorios.');
    }

    const admin = await loginWebAdmin({ email, contrasena });
    req.session.admin = admin;

    const safeNext = nextUrl.startsWith('/') && !nextUrl.startsWith('//')
      ? nextUrl
      : '/';
    return res.redirect(safeNext);
  } catch (err) {
    if (err.status === 401 || err.status === 403) {
      return res.status(err.status).render('auth/login', {
        title: 'Iniciar sesión',
        error: err.message,
        email: String(req.body.email || '').trim(),
        next: String(req.body.next || '').trim(),
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

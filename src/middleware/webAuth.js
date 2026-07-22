/**
 * Sesión del panel web (cookie). Distinto del JWT de la API móvil.
 */

function requireWebAdmin(req, res, next) {
  // La API móvil usa JWT; no aplicar sesión del panel.
  if (req.path.startsWith('/api') || req.originalUrl.startsWith('/api')) {
    return next('route');
  }

  const sessionUser = req.session?.admin;
  if (!sessionUser?.id || sessionUser.rol !== 'ADMIN') {
    const nextUrl = req.originalUrl && req.originalUrl !== '/login'
      ? `?next=${encodeURIComponent(req.originalUrl)}`
      : '';
    return res.redirect(`/login${nextUrl}`);
  }

  res.locals.adminUser = sessionUser;
  return next();
}

/** Si ya hay sesión admin, no mostrar login otra vez. */
function redirectIfWebAdmin(req, res, next) {
  if (req.session?.admin?.id && req.session.admin.rol === 'ADMIN') {
    return res.redirect('/');
  }
  return next();
}

module.exports = {
  requireWebAdmin,
  redirectIfWebAdmin,
};

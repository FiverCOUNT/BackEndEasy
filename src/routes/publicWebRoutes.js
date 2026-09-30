const express = require('express');
const terminosWebController = require('../controllers/terminosWebController');
const privacidadWebController = require('../controllers/privacidadWebController');
const webAuthController = require('../controllers/webAuthController');
const { redirectIfWebLoggedIn } = require('../middleware/webAuth');
const { ADMIN_BASE } = require('../config/adminPanel');
const { APP_BASE } = require('../config/appPanel');

const router = express.Router();

/** Páginas públicas (apps / Play Store): no requieren sesión. */
router.get('/terminosycondiciones', terminosWebController.index);
router.get('/terminosycondiciones/', terminosWebController.index);
router.get('/terminosycondiciones/:app', terminosWebController.show);

router.get('/politicadeprivacidad', privacidadWebController.index);
router.get('/politicadeprivacidad/', privacidadWebController.index);
router.get('/politicadeprivacidad/:app', privacidadWebController.show);

/** Login unificado: SUPER_ADMIN → /admin · ADMIN → /app */
router.get('/login', redirectIfWebLoggedIn, webAuthController.showLogin);
router.post('/login', redirectIfWebLoggedIn, webAuthController.login);

/** Compat: URLs antiguas del panel */
router.get('/admin/login', (req, res) => {
  const q = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  return res.redirect(302, `/login${q}`);
});

router.get('/', (req, res) => {
  const user = req.session?.webUser || req.session?.admin;
  if (user?.rol === 'SUPER_ADMIN') return res.redirect(ADMIN_BASE);
  if (user?.rol === 'ADMIN' || user?.rol === 'USUARIO') return res.redirect(APP_BASE);
  return res.redirect('/login');
});

module.exports = router;

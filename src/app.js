const path = require('path');
const express = require('express');
const cors = require('cors');
const session = require('express-session');
require('./config/env');
const { ADMIN_BASE } = require('./config/adminPanel');
const { APP_BASE } = require('./config/appPanel');
const publicWebRoutes = require('./routes/publicWebRoutes');
const webRoutes = require('./routes/webRoutes');
const appWebRoutes = require('./routes/appWebRoutes');
const apiRoutes = require('./routes/api');

const app = express();

// Detrás de nginx/HTTPS: sin esto la cookie secure de sesión no se envía
// y el login en producción (esy.lat) parece fallar (redirige pero no queda logueado).
app.set('trust proxy', 1);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../public')));
app.use(
  '/storage/comprobantes',
  express.static(path.join(__dirname, '../storage/comprobantes')),
);
app.use(
  '/storage/adjuntos',
  express.static(path.join(__dirname, '../storage/adjuntos')),
);
app.use(
  '/storage/configuracion',
  express.static(path.join(__dirname, '../storage/configuracion')),
);
app.use(
  '/storage/logos',
  express.static(path.join(__dirname, '../storage/logos')),
);

const sessionSecret =
  process.env.SESSION_SECRET
  || process.env.JWT_SECRET
  || 'backend-easy-web-session-change-me';

const isProd = process.env.NODE_ENV === 'production';

app.use(
  session({
    name: 'be.sid',
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    proxy: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProd,
      maxAge: 1000 * 60 * 60 * 12, // 12 horas
    },
  }),
);

app.use('/api', apiRoutes);
app.use(ADMIN_BASE, webRoutes);
app.use(APP_BASE, appWebRoutes);
app.use('/', publicWebRoutes);

app.use((req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ success: false, message: 'Ruta no encontrada' });
  }
  const sessionUser = req.session?.webUser || req.session?.admin || null;
  if (sessionUser?.rol === 'SUPER_ADMIN') {
    return res.redirect(`${ADMIN_BASE}?msg=${encodeURIComponent('Página no encontrada')}&tipo=error`);
  }
  if (sessionUser?.rol === 'ADMIN' || sessionUser?.rol === 'USUARIO') {
    return res.redirect(`${APP_BASE}?msg=${encodeURIComponent('Página no encontrada')}&tipo=error`);
  }
  return res.status(404).render('auth/login', {
    title: 'No encontrado',
    error: 'Página no encontrada. Inicia sesión para continuar.',
    email: '',
    next: '/login',
    adminBase: ADMIN_BASE,
    appBase: APP_BASE,
  });
});

const errorHandler = require('./middleware/errorHandler');
app.use(errorHandler);

module.exports = app;

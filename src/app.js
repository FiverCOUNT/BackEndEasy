const path = require('path');
const express = require('express');
const cors = require('cors');
const session = require('express-session');
require('./config/env');
const webRoutes = require('./routes/webRoutes');
const apiRoutes = require('./routes/api');

const app = express();

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

const sessionSecret =
  process.env.SESSION_SECRET
  || process.env.JWT_SECRET
  || 'backend-easy-web-session-change-me';

app.use(
  session({
    name: 'be.sid',
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 12, // 12 horas
    },
  }),
);

app.use('/api', apiRoutes);
app.use('/', webRoutes);

app.use((req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ success: false, message: 'Ruta no encontrada' });
  }
  return res.status(404).render('auth/login', {
    title: 'No encontrado',
    error: 'Página no encontrada. Inicia sesión para continuar.',
    email: '',
    next: '/',
  });
});

const errorHandler = require('./middleware/errorHandler');
app.use(errorHandler);

module.exports = app;

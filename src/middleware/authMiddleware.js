const { verifyAccessToken } = require('../utils/tokens');
const usuarioModel = require('../models/usuarioModel');
const { enterWithEntorno, isProdEntorno } = require('../config/prisma');

async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');

    if (scheme !== 'Bearer' || !token) {
      return res.status(401).json({
        success: false,
        message: 'Token de acceso requerido (Authorization: Bearer)',
      });
    }

    let payload;
    try {
      payload = verifyAccessToken(token);
    } catch {
      return res.status(401).json({
        success: false,
        message: 'Token inválido o expirado',
      });
    }

    const userId = parseInt(payload.sub, 10);
    if (!Number.isFinite(userId)) {
      return res.status(401).json({ success: false, message: 'Token inválido' });
    }

    const entornoHint = payload.entorno
      ? (isProdEntorno(payload.entorno) ? 'prod' : 'beta')
      : null;

    if (entornoHint) enterWithEntorno(entornoHint);

    const user = await usuarioModel.findById(userId, entornoHint);
    if (!user) {
      return res.status(401).json({ success: false, message: 'Usuario no encontrado' });
    }

    if (user.estado !== 'ACTIVO') {
      return res.status(403).json({
        success: false,
        message: 'Tu acceso está deshabilitado. Contacta a soporte para reactivarlo.',
        code: 'CUENTA_DESHABILITADA',
      });
    }

    const company = user.company;
    if (company && company.activo === false) {
      return res.status(403).json({
        success: false,
        message: 'Tu acceso está deshabilitado. Contacta a soporte para reactivarlo.',
        code: 'CUENTA_DESHABILITADA',
      });
    }

    if (!user.token) {
      return res.status(401).json({
        success: false,
        message: 'Sesión cerrada. Vuelve a iniciar sesión.',
      });
    }

    const dbEntorno = user._dbEntorno
      || (isProdEntorno(company?.entorno) ? 'prod' : 'beta');
    enterWithEntorno(dbEntorno);

    req.user = usuarioModel.toPublicUser(user);
    req.user.companyEntorno = dbEntorno;
    req.userId = user.id;
    req.userRol = user.rol;
    req.userAlmacenId = user.almacenId != null ? String(user.almacenId) : null;
    req.userAlmacenNombre = user.almacen?.nombre ?? null;
    req.userAlmacenCodigo = user.almacen?.codigo ?? null;
    req.dbEntorno = dbEntorno;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requireAuth };

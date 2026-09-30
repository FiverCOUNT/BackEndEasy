const bcrypt = require('bcryptjs');
const usuarioModel = require('../models/usuarioModel');
const {
  signAccessToken,
  generateRefreshToken,
} = require('../utils/tokens');
const {
  loadCompanyForSession,
  buildConfiguracion,
} = require('./sessionConfigService');

function resolveUserEntorno(user) {
  const raw = user?._dbEntorno || user?.company?.entorno || 'beta';
  const v = String(raw).toLowerCase();
  return v === 'prod' || v === 'production' ? 'prod' : 'beta';
}

function buildAccessToken(user) {
  return signAccessToken({
    sub: user.id,
    email: user.email,
    companyId: user.companyId ? Number(user.companyId) : null,
    companyRuc: user.company?.ruc ?? null,
    rol: user.rol || 'USUARIO',
    almacenId: user.almacenId != null ? String(user.almacenId) : null,
    entorno: resolveUserEntorno(user),
  });
}

const CUENTA_DESHABILITADA =
  'Tu acceso está deshabilitado. Contacta a soporte para reactivarlo.';

function assertAccesoActivo(user) {
  if (!user || user.estado !== 'ACTIVO') {
    const err = new Error(CUENTA_DESHABILITADA);
    err.status = 403;
    err.code = 'CUENTA_DESHABILITADA';
    throw err;
  }

  const company = user.company;
  if (company && company.activo === false) {
    const err = new Error(CUENTA_DESHABILITADA);
    err.status = 403;
    err.code = 'CUENTA_DESHABILITADA';
    throw err;
  }
}

async function login({ email, contrasena }) {
  const normalizedEmail = (email || '').trim().toLowerCase();
  const user = await usuarioModel.findByEmail(normalizedEmail);
  if (!user) {
    const err = new Error('Credenciales inválidas');
    err.status = 401;
    throw err;
  }

  assertAccesoActivo(user);

  const valid = await bcrypt.compare(contrasena, user.contrasena);
  if (!valid) {
    const err = new Error('Credenciales inválidas');
    err.status = 401;
    throw err;
  }

  const { runWithEntorno } = require('../config/prisma');
  return runWithEntorno(resolveUserEntorno(user), () => issueTokens(user));
}

async function refresh(refreshToken) {
  if (!refreshToken) {
    const err = new Error('refresh_token es obligatorio');
    err.status = 400;
    throw err;
  }

  const user = await usuarioModel.findByRefreshToken(refreshToken);
  if (!user || user.refreshToken !== refreshToken) {
    const err = new Error('Refresh token inválido');
    err.status = 401;
    throw err;
  }

  assertAccesoActivo(user);

  const { runWithEntorno } = require('../config/prisma');
  return runWithEntorno(resolveUserEntorno(user), () => issueTokens(user));
}

async function issueTokens(user) {
  const accessToken = buildAccessToken(user);
  const refreshToken = generateRefreshToken();

  await usuarioModel.saveTokens(user.id, {
    token: accessToken,
    refreshToken,
  });

  return sessionPayload(await usuarioModel.findById(user.id, resolveUserEntorno(user)));
}

async function sessionPayload(updated) {
  if (!updated) {
    const err = new Error('Usuario no encontrado');
    err.status = 404;
    throw err;
  }

  const companyFull = await loadCompanyForSession(updated.companyId);
  const configuracion = await buildConfiguracion(companyFull);

  const almacenId =
    updated.almacenId != null ? String(updated.almacenId) : null;
  const almacenNombre = updated.almacen?.nombre ?? null;
  const almacenCodigo = updated.almacen?.codigo ?? null;

  const empresaPublica = configuracion?.empresa
    ?? (updated.company
      ? {
          ruc: updated.company.ruc,
          nombre: updated.company.nombre || 'Empresa',
        }
      : null);

  return {
    accessToken: updated.token,
    refreshToken: updated.refreshToken,
    tokenType: 'Bearer',
    almacenId,
    almacenNombre,
    almacenCodigo,
    configuracion,
    user: {
      ...usuarioModel.toPublicUser(updated),
      company: empresaPublica,
      companyRuc: empresaPublica?.ruc ?? updated.company?.ruc ?? null,
      companyNombre: empresaPublica?.nombre ?? updated.company?.nombre ?? null,
      rol: updated.rol,
      almacenId,
      almacenNombre,
      almacenCodigo,
    },
  };
}

async function sessionFromUserId(userId, entornoHint) {
  const user = await usuarioModel.findById(userId, entornoHint);
  const { runWithEntorno } = require('../config/prisma');
  return runWithEntorno(resolveUserEntorno(user), () => sessionPayload(user));
}

module.exports = {
  login,
  refresh,
  sessionFromUserId,
};

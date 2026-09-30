const bcrypt = require('bcryptjs');
const usuarioModel = require('../models/usuarioModel');

const ROLES_WEB = new Set(['SUPER_ADMIN', 'ADMIN', 'USUARIO']);

/**
 * Login web compartido (/login):
 * - SUPER_ADMIN → panel /admin
 * - ADMIN / USUARIO (empresa) → dashboard /app
 */
async function loginWebUser({ email, contrasena }) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const user = await usuarioModel.findByEmail(normalizedEmail);

  if (!user) {
    const err = new Error('Credenciales inválidas');
    err.status = 401;
    throw err;
  }

  if (user.estado !== 'ACTIVO') {
    const err = new Error('Usuario inactivo o no autorizado');
    err.status = 403;
    throw err;
  }

  if (!ROLES_WEB.has(user.rol)) {
    const err = new Error('Tu rol no tiene acceso al panel web');
    err.status = 403;
    throw err;
  }

  if (user.rol === 'ADMIN' && !user.company?.ruc) {
    const err = new Error('Tu usuario ADMIN no tiene empresa asignada');
    err.status = 403;
    throw err;
  }

  if (user.rol === 'USUARIO' && !user.company?.ruc) {
    const err = new Error('Tu usuario no tiene empresa asignada');
    err.status = 403;
    throw err;
  }

  const valid = await bcrypt.compare(String(contrasena || ''), user.contrasena);
  if (!valid) {
    const err = new Error('Credenciales inválidas');
    err.status = 401;
    throw err;
  }

  const entornoRaw = user._dbEntorno || user.company?.entorno || 'beta';
  const companyEntorno = (String(entornoRaw).toLowerCase() === 'prod'
    || String(entornoRaw).toLowerCase() === 'production')
    ? 'prod'
    : 'beta';

  return {
    id: user.id,
    email: user.email,
    rol: user.rol,
    estado: user.estado,
    companyId: user.companyId ? String(user.companyId) : null,
    companyRuc: user.company?.ruc || null,
    companyNombre: user.company?.nombreComercial || user.company?.nombre || null,
    companyEntorno,
    almacenId: user.almacenId != null ? String(user.almacenId) : null,
    almacenNombre: user.almacen?.nombre || null,
  };
}

/** @deprecated alias */
async function loginWebAdmin(opts) {
  return loginWebUser(opts);
}

module.exports = { loginWebUser, loginWebAdmin, ROLES_WEB };

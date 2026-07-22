const bcrypt = require('bcryptjs');
const usuarioModel = require('../models/usuarioModel');

/**
 * Login del panel web: misma tabla usuarios, solo rol ADMIN activo.
 * No usa JWT (eso es la app móvil); usa sesión cookie.
 */
async function loginWebAdmin({ email, contrasena }) {
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

  if (user.rol !== 'ADMIN') {
    const err = new Error('Solo administradores pueden acceder al panel web');
    err.status = 403;
    throw err;
  }

  const valid = await bcrypt.compare(String(contrasena || ''), user.contrasena);
  if (!valid) {
    const err = new Error('Credenciales inválidas');
    err.status = 401;
    throw err;
  }

  return {
    id: user.id,
    email: user.email,
    rol: user.rol,
    estado: user.estado,
  };
}

module.exports = { loginWebAdmin };

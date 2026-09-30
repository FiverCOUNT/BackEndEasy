const bcrypt = require('bcryptjs');
const usuarioModel = require('../models/usuarioModel');
const companyModel = require('../models/companyModel');
const almacenModel = require('../models/almacenModel');

const ROLES_EMPRESA = ['ADMIN', 'USUARIO'];
const ESTADOS = ['ACTIVO', 'INACTIVO', 'PENDIENTE', 'BLOQUEADO'];

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function parseId(param) {
  const id = Number(param);
  if (!Number.isInteger(id) || id < 1) return null;
  return id;
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function pickAlmacenId(body) {
  const raw = body?.almacen_id ?? body?.almacenId ?? '';
  return String(raw || '').trim();
}

async function requireCompany(companyRuc) {
  const company = await companyModel.findByRuc(companyRuc);
  if (!company) throw httpError(404, 'Empresa no encontrada');
  return company;
}

async function loadAlmacenes(companyRuc) {
  const rows = await almacenModel.findByCompanyRuc(companyRuc, { soloActivos: false });
  return (rows || []).map((a) => ({
    id: a.id,
    nombre: a.nombre,
    codigo: a.codigo,
    activo: a.activo !== false,
  }));
}

async function getUsuarioDeEmpresa(companyRuc, userId) {
  const company = await requireCompany(companyRuc);
  const user = await usuarioModel.findById(userId);
  if (!user) throw httpError(404, 'Usuario no encontrado');
  if (user.rol === 'SUPER_ADMIN') {
    throw httpError(403, 'No puedes gestionar este usuario');
  }
  if (!user.companyId || String(user.companyId) !== String(company.id)) {
    throw httpError(404, 'Usuario no encontrado');
  }
  return { company, user };
}

function validateDatos({ email, rol, estado, almacenId }, { isCreate, password } = {}) {
  const emailNorm = normalizeEmail(email);
  if (!emailNorm || !emailNorm.includes('@')) {
    throw httpError(400, 'El email es obligatorio y debe ser válido.');
  }
  if (!ROLES_EMPRESA.includes(rol)) {
    throw httpError(400, 'El rol debe ser ADMIN o USUARIO.');
  }
  if (!ESTADOS.includes(estado)) {
    throw httpError(400, 'Estado no válido.');
  }
  if (rol === 'USUARIO' && !almacenId) {
    throw httpError(400, 'El almacén es obligatorio para usuarios.');
  }
  if (isCreate) {
    if (!password) throw httpError(400, 'La contraseña es obligatoria.');
    if (String(password).length < 6) {
      throw httpError(400, 'La contraseña debe tener al menos 6 caracteres.');
    }
  } else if (password && String(password).length < 6) {
    throw httpError(400, 'La contraseña debe tener al menos 6 caracteres.');
  }
  return emailNorm;
}

async function assertAlmacenDeEmpresa(companyRuc, almacenId) {
  if (!almacenId) return null;
  const almacenes = await loadAlmacenes(companyRuc);
  const found = almacenes.find((a) => String(a.id) === String(almacenId));
  if (!found) throw httpError(400, 'El almacén debe pertenecer a la empresa.');
  return found;
}

async function assertPuedeQuitarAdmin({ companyId, userId, nextRol, nextEstado }) {
  const sigueAdminActivo = nextRol === 'ADMIN' && nextEstado === 'ACTIVO';
  if (sigueAdminActivo) return;
  const restantes = await usuarioModel.countAdminsActivos(companyId, userId);
  if (restantes < 1) {
    throw httpError(400, 'Debe quedar al menos un administrador activo en la empresa.');
  }
}

async function listar(companyRuc, { q = '' } = {}) {
  let items = await usuarioModel.findGestionByCompanyRuc(companyRuc);
  const term = String(q || '').trim().toLowerCase();
  if (term) {
    items = items.filter((u) =>
      String(u.email || '').toLowerCase().includes(term)
      || String(u.nombre || '').toLowerCase().includes(term)
      || String(u.rol || '').toLowerCase().includes(term)
      || String(u.almacen_nombre || u.almacenNombre || '').toLowerCase().includes(term)
      || String(u.estado || '').toLowerCase().includes(term));
  }
  return items;
}

async function crear(companyRuc, body) {
  const company = await requireCompany(companyRuc);
  const rol = String(body.rol || 'USUARIO').toUpperCase();
  const estado = String(body.estado || 'ACTIVO').toUpperCase();
  const almacenId = pickAlmacenId(body);
  const password = body.contrasena || body.password || '';
  const email = validateDatos(
    { email: body.email, rol, estado, almacenId },
    { isCreate: true, password },
  );
  await assertAlmacenDeEmpresa(companyRuc, almacenId);

  if (await usuarioModel.findByEmail(email)) {
    throw httpError(409, 'Ese email ya está registrado.');
  }

  const hash = await bcrypt.hash(String(password), 10);
  const row = await usuarioModel.create({
    email,
    contrasenaHash: hash,
    companyId: company.id,
    estado,
    rol,
    almacenId: almacenId || null,
  });
  const created = await usuarioModel.findById(row.id);
  return usuarioModel.toGestionApi(created);
}

async function actualizar(companyRuc, userId, body) {
  const { company, user } = await getUsuarioDeEmpresa(companyRuc, userId);
  const rol = String(body.rol || user.rol).toUpperCase();
  const estado = String(body.estado || user.estado).toUpperCase();
  const almacenId = pickAlmacenId(body);
  const password = String(body.contrasena || body.password || '').trim();
  const email = validateDatos(
    { email: body.email != null ? body.email : user.email, rol, estado, almacenId },
    { isCreate: false, password },
  );
  await assertAlmacenDeEmpresa(companyRuc, almacenId);

  const other = await usuarioModel.findByEmailExceptId(email, user.id);
  if (other) throw httpError(409, 'Ese email ya está registrado.');

  await assertPuedeQuitarAdmin({
    companyId: company.id,
    userId: user.id,
    nextRol: rol,
    nextEstado: estado,
  });

  await usuarioModel.update(user.id, {
    email,
    estado,
    rol,
    almacenId: almacenId || null,
    ...(password ? { contrasenaHash: await bcrypt.hash(password, 10) } : {}),
  });
  if (estado !== 'ACTIVO') {
    await usuarioModel.clearTokens(user.id);
  }

  const updated = await usuarioModel.findById(user.id);
  return usuarioModel.toGestionApi(updated);
}

async function cambiarEstado(companyRuc, userId, estado) {
  const next = String(estado || '').toUpperCase();
  if (!ESTADOS.includes(next)) throw httpError(400, 'Estado no válido.');
  const { company, user } = await getUsuarioDeEmpresa(companyRuc, userId);
  await assertPuedeQuitarAdmin({
    companyId: company.id,
    userId: user.id,
    nextRol: user.rol,
    nextEstado: next,
  });
  await usuarioModel.setEstado(user.id, next);
  const updated = await usuarioModel.findById(user.id);
  return usuarioModel.toGestionApi(updated);
}

async function eliminar(companyRuc, userId, actorUserId) {
  const { company, user } = await getUsuarioDeEmpresa(companyRuc, userId);
  if (Number(actorUserId) === Number(user.id)) {
    throw httpError(400, 'No puedes eliminar tu propia cuenta.');
  }
  await assertPuedeQuitarAdmin({
    companyId: company.id,
    userId: user.id,
    nextRol: 'USUARIO',
    nextEstado: 'INACTIVO',
  });
  await usuarioModel.remove(user.id);
}

module.exports = {
  ROLES_EMPRESA,
  ESTADOS,
  parseId,
  loadAlmacenes,
  getUsuarioDeEmpresa,
  listar,
  crear,
  actualizar,
  cambiarEstado,
  eliminar,
};

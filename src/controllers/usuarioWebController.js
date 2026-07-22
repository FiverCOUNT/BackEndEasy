const bcrypt = require('bcryptjs');
const prisma = require('../config/prisma');
const usuarioModel = require('../models/usuarioModel');
const { parseListQuery, buildPageMeta } = require('../utils/pagination');

const ESTADOS = ['ACTIVO', 'INACTIVO', 'PENDIENTE', 'BLOQUEADO'];
const ROLES = usuarioModel.ROLES;

async function loadCompanies() {
  return prisma.company.findMany({
    select: { id: true, nombre: true, ruc: true },
    orderBy: { id: 'asc' },
  });
}

async function loadAlmacenes() {
  return prisma.almacen.findMany({
    select: { id: true, nombre: true, codigo: true, companyRuc: true, activo: true },
    orderBy: [{ companyRuc: 'asc' }, { nombre: 'asc' }],
  });
}

function parseFlash(req) {
  const { msg, tipo } = req.query;
  if (!msg) return null;
  return { text: msg, type: tipo === 'error' ? 'error' : 'success' };
}

function parseId(param) {
  const id = Number(param);
  if (!Number.isInteger(id) || id < 1) return null;
  return id;
}

function redirectList(res, message, type = 'success') {
  const q = new URLSearchParams({ msg: message, tipo: type });
  return res.redirect(`/usuarios?${q.toString()}`);
}

function normalizeForm(body) {
  const rol = (body.rol || 'USUARIO').toUpperCase();
  return {
    email: (body.email || '').trim(),
    companyId: body.companyId || '',
    almacenId: body.almacenId || '',
    estado: body.estado || 'ACTIVO',
    rol: ROLES.includes(rol) ? rol : 'USUARIO',
  };
}

async function validateUsuarioForm(form) {
  const companies = await loadCompanies();
  const almacenes = await loadAlmacenes();

  if (!form.email) return 'El email es obligatorio.';
  if (!ESTADOS.includes(form.estado)) return 'Estado no válido.';

  const companyId =
    form.companyId && form.companyId !== '' ? Number(form.companyId) : null;
  const company = companyId
    ? companies.find((c) => Number(c.id) === companyId)
    : null;

  // Admin de plataforma: puede no tener empresa ni almacén (solo panel web).
  if (form.rol === 'ADMIN' && !companyId) {
    if (form.almacenId) {
      return 'Un admin sin empresa no puede tener almacén asignado.';
    }
    return null;
  }

  if (!companyId || !company) {
    return 'La empresa es obligatoria (salvo admin de plataforma sin empresa).';
  }

  if (!form.almacenId) {
    return 'El almacén es obligatorio.';
  }

  const almacen = almacenes.find((a) => a.id === form.almacenId);
  if (!almacen || almacen.companyRuc !== company.ruc) {
    return 'El almacén debe pertenecer a la empresa seleccionada.';
  }

  return null;
}

async function list(req, res, next) {
  try {
    const { q, page, pageSize, skip } = parseListQuery(req.query);
    const { total, items } = await usuarioModel.findPaginated({
      q,
      page,
      pageSize,
      skip,
    });

    const pagination = buildPageMeta({
      total,
      page,
      pageSize,
      basePath: '/usuarios',
      query: { q, msg: req.query.msg, tipo: req.query.tipo },
    });

    res.render('usuarios/listar', {
      title: 'Usuarios',
      usuarios: items,
      total,
      q,
      pageSize,
      pagination,
      flash: parseFlash(req),
      searchAction: '/usuarios',
      searchPlaceholder: 'Buscar por email, empresa, almacén o rol…',
    });
  } catch (err) {
    next(err);
  }
}

async function showCreateForm(req, res, next) {
  try {
    const [companies, almacenes] = await Promise.all([loadCompanies(), loadAlmacenes()]);
    res.render('usuarios/crear', {
      title: 'Crear usuario',
      error: null,
      companies,
      almacenes,
      estados: ESTADOS,
      roles: ROLES,
      form: { estado: 'ACTIVO', rol: 'USUARIO' },
      isEdit: false,
    });
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const [companies, almacenes] = await Promise.all([loadCompanies(), loadAlmacenes()]);
    const form = normalizeForm(req.body);
    const contrasena = req.body.contrasena || '';

    const renderError = (error) =>
      res.render('usuarios/crear', {
        title: 'Crear usuario',
        error,
        companies,
        almacenes,
        estados: ESTADOS,
        roles: ROLES,
        form,
        isEdit: false,
      });

    const validationError = await validateUsuarioForm(form);
    if (validationError) return renderError(validationError);

    if (!contrasena) return renderError('Email y contraseña son obligatorios.');
    if (contrasena.length < 6) {
      return renderError('La contraseña debe tener al menos 6 caracteres.');
    }
    if (await usuarioModel.findByEmail(form.email)) {
      return renderError('Ese email ya está registrado.');
    }

    const companyId =
      form.companyId && form.companyId !== '' ? Number(form.companyId) : null;
    const contrasenaHash = await bcrypt.hash(contrasena, 10);

    await usuarioModel.create({
      email: form.email,
      contrasenaHash,
      companyId,
      estado: form.estado,
      rol: form.rol,
      almacenId: form.almacenId || null,
    });

    return redirectList(res, `Usuario ${form.email} creado correctamente.`);
  } catch (err) {
    next(err);
  }
}

async function showEditForm(req, res, next) {
  try {
    const id = parseId(req.params.id);
    if (!id) return redirectList(res, 'Usuario no válido', 'error');

    const user = await usuarioModel.findById(id);
    if (!user) return redirectList(res, 'Usuario no encontrado', 'error');

    const [companies, almacenes] = await Promise.all([loadCompanies(), loadAlmacenes()]);
    res.render('usuarios/editar', {
      title: 'Editar usuario',
      error: null,
      companies,
      almacenes,
      estados: ESTADOS,
      roles: ROLES,
      isEdit: true,
      usuario: usuarioModel.toPublicUser(user),
      form: {
        email: user.email,
        estado: user.estado,
        rol: user.rol,
        companyId: user.companyId ? String(user.companyId) : '',
        almacenId: user.almacenId || '',
      },
    });
  } catch (err) {
    next(err);
  }
}

async function update(req, res, next) {
  try {
    const id = parseId(req.params.id);
    if (!id) return redirectList(res, 'Usuario no válido', 'error');

    const user = await usuarioModel.findById(id);
    if (!user) return redirectList(res, 'Usuario no encontrado', 'error');

    const [companies, almacenes] = await Promise.all([loadCompanies(), loadAlmacenes()]);
    const form = normalizeForm(req.body);
    const nuevaContrasena = (req.body.nuevaContrasena || '').trim();

    const renderError = (error) =>
      res.render('usuarios/editar', {
        title: 'Editar usuario',
        error,
        companies,
        almacenes,
        estados: ESTADOS,
        roles: ROLES,
        isEdit: true,
        usuario: usuarioModel.toPublicUser(user),
        form,
      });

    const validationError = await validateUsuarioForm(form);
    if (validationError) return renderError(validationError);

    if (nuevaContrasena.length > 0 && nuevaContrasena.length < 6) {
      return renderError('La contraseña debe tener al menos 6 caracteres.');
    }

    const duplicate = await usuarioModel.findByEmailExceptId(form.email, id);
    if (duplicate) return renderError('Ese email ya está en uso.');

    const companyId =
      form.companyId && form.companyId !== '' ? Number(form.companyId) : null;
    const updateData = {
      email: form.email,
      companyId,
      estado: form.estado,
      rol: form.rol,
      almacenId: form.almacenId || null,
    };

    if (nuevaContrasena.length >= 6) {
      updateData.contrasenaHash = await bcrypt.hash(nuevaContrasena, 10);
    }

    if (estadoChangedToInactive(form.estado, user.estado)) {
      await usuarioModel.clearTokens(id);
    }

    await usuarioModel.update(id, updateData);
    return redirectList(res, `Usuario ${form.email} actualizado.`);
  } catch (err) {
    next(err);
  }
}

function estadoChangedToInactive(estado, prev) {
  return estado !== 'ACTIVO' && prev === 'ACTIVO';
}

async function activate(req, res, next) {
  try {
    const id = parseId(req.params.id);
    if (!id) return redirectList(res, 'Usuario no válido', 'error');

    const user = await usuarioModel.findById(id);
    if (!user) return redirectList(res, 'Usuario no encontrado', 'error');

    await usuarioModel.setEstado(id, 'ACTIVO');
    return redirectList(res, `Usuario ${user.email} activado.`);
  } catch (err) {
    next(err);
  }
}

async function deactivate(req, res, next) {
  try {
    const id = parseId(req.params.id);
    if (!id) return redirectList(res, 'Usuario no válido', 'error');

    const user = await usuarioModel.findById(id);
    if (!user) return redirectList(res, 'Usuario no encontrado', 'error');

    await usuarioModel.setEstado(id, 'INACTIVO');
    return redirectList(res, `Usuario ${user.email} desactivado. Sesión cerrada.`);
  } catch (err) {
    next(err);
  }
}

async function destroy(req, res, next) {
  try {
    const id = parseId(req.params.id);
    if (!id) return redirectList(res, 'Usuario no válido', 'error');

    const user = await usuarioModel.findById(id);
    if (!user) return redirectList(res, 'Usuario no encontrado', 'error');

    await usuarioModel.remove(id);
    return redirectList(res, `Usuario ${user.email} eliminado.`);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  list,
  showCreateForm,
  create,
  showEditForm,
  update,
  activate,
  deactivate,
  destroy,
};

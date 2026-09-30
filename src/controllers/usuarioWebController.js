const bcrypt = require('bcryptjs');
const usuarioModel = require('../models/usuarioModel');
const { parseListQuery, buildPageMeta } = require('../utils/pagination');
const { adminPath } = require('../config/adminPanel');
const {
  loadCompaniesMerged,
  loadAlmacenesMerged,
  runWithCompanyId,
} = require('../utils/adminDualDb');
const { runWithEntorno } = require('../config/prisma');
const prisma = require('../config/prisma');

const ESTADOS = ['ACTIVO', 'INACTIVO', 'PENDIENTE', 'BLOQUEADO'];
const ROLES = usuarioModel.ROLES;

async function loadCompanies() {
  return loadCompaniesMerged();
}

async function loadEntornoCatalog(entorno) {
  const db = entorno === 'beta' ? 'beta' : 'prod';
  const [companies, almacenes] = await runWithEntorno(db, () => Promise.all([
    prisma.company.findMany({
      select: { id: true, nombre: true, ruc: true },
      orderBy: { nombre: 'asc' },
    }),
    prisma.almacen.findMany({
      select: { id: true, nombre: true, codigo: true, companyRuc: true, activo: true },
      orderBy: [{ companyRuc: 'asc' }, { nombre: 'asc' }],
    }),
  ]));
  return {
    companies: companies.map((c) => ({ ...c, id: c.id.toString() })),
    almacenes,
  };
}

async function loadAlmacenes() {
  return loadAlmacenesMerged();
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

function redirectList(res, message, type = 'success', entorno) {
  const q = new URLSearchParams({ msg: message, tipo: type });
  const db = entorno === 'beta' || entorno === 'prod'
    ? entorno
    : (res.locals.adminEntorno === 'beta' ? 'beta' : 'prod');
  q.set('entorno', db);
  return res.redirect(`${adminPath('/usuarios')}?${q.toString()}`);
}

function parseEntorno(req) {
  const raw = String(
    req.query.entorno || req.body?.entorno || req.session?.adminEntorno || 'prod',
  ).trim().toLowerCase();
  return raw === 'beta' ? 'beta' : 'prod';
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

async function validateUsuarioForm(form, companies, almacenes) {
  const companyList = companies || await loadCompanies();
  const almacenList = almacenes || await loadAlmacenes();

  if (!form.email) return 'El email es obligatorio.';
  if (!ESTADOS.includes(form.estado)) return 'Estado no válido.';

  const companyId =
    form.companyId && form.companyId !== '' ? Number(form.companyId) : null;
  const company = companyId
    ? companyList.find((c) => Number(c.id) === companyId)
    : null;

  // Super admin de plataforma: panel /admin, sin empresa ni almacén.
  if (form.rol === 'SUPER_ADMIN') {
    if (companyId) {
      return 'SUPER_ADMIN no debe tener empresa (solo panel de plataforma).';
    }
    if (form.almacenId) {
      return 'SUPER_ADMIN no puede tener almacén asignado.';
    }
    return null;
  }

  if (!companyId || !company) {
    return 'La empresa es obligatoria (salvo SUPER_ADMIN de plataforma).';
  }

  if (!form.almacenId) {
    const hayEnEstaBase = almacenList.some((a) => a.companyRuc === company.ruc);
    if (hayEnEstaBase) return 'El almacén es obligatorio.';
    return null;
  }

  const almacen = almacenList.find((a) => a.id === form.almacenId);
  if (!almacen || almacen.companyRuc !== company.ruc) {
    return 'El almacén debe pertenecer a la empresa seleccionada.';
  }

  return null;
}

async function list(req, res, next) {
  try {
    const { q, page, pageSize, skip } = parseListQuery(req.query);
    const companyRaw = String(req.query.company || '').trim();
    const companyId =
      companyRaw === 'none'
        ? 'none'
        : Number.isInteger(Number(companyRaw)) && Number(companyRaw) > 0
          ? Number(companyRaw)
          : null;

    const entorno = parseEntorno(req);
    const [{ total, items }, companies] = await Promise.all([
      runWithEntorno(entorno, () =>
        usuarioModel.findPaginated({ q, companyId, page, pageSize, skip })),
      runWithEntorno(entorno, () =>
        prisma.company.findMany({
          select: { id: true, nombre: true, ruc: true },
          orderBy: { nombre: 'asc' },
        })),
    ]);

    const listPath = adminPath('/usuarios');
    const pagination = buildPageMeta({
      total,
      page,
      pageSize,
      basePath: listPath,
      query: {
        q,
        company: companyRaw || undefined,
        entorno,
        msg: req.query.msg,
        tipo: req.query.tipo,
      },
    });

    res.render('usuarios/listar', {
      title: 'Usuarios',
      usuarios: items,
      total,
      q,
      entorno,
      companyId: companyRaw || '',
      companies,
      pageSize,
      pagination,
      flash: parseFlash(req),
      searchAction: listPath,
      searchPlaceholder: 'Buscar por email, rol, almacén…',
    });
  } catch (err) {
    next(err);
  }
}

async function showCreateForm(req, res, next) {
  try {
    const entorno = parseEntorno(req);
    const { companies, almacenes } = await loadEntornoCatalog(entorno);
    res.render('usuarios/crear', {
      title: 'Crear usuario',
      error: null,
      companies,
      almacenes,
      estados: ESTADOS,
      roles: ROLES,
      entorno,
      form: { estado: 'ACTIVO', rol: 'USUARIO' },
      isEdit: false,
    });
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const entorno = parseEntorno(req);
    const { companies, almacenes } = await loadEntornoCatalog(entorno);
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
        entorno,
        form,
        isEdit: false,
      });

    const validationError = await validateUsuarioForm(form, companies, almacenes);
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

    const createUser = () => usuarioModel.create({
      email: form.email,
      contrasenaHash,
      companyId,
      estado: form.estado,
      rol: form.rol,
      almacenId: form.almacenId || null,
    });

    if (form.rol === 'SUPER_ADMIN' || !companyId) {
      await runWithEntorno('prod', createUser);
      return redirectList(res, `Usuario ${form.email} creado en producción.`, 'success', 'prod');
    }
    await runWithEntorno(entorno, createUser);
    return redirectList(res, `Usuario ${form.email} creado correctamente.`, 'success', entorno);
  } catch (err) {
    next(err);
  }
}

async function showEditForm(req, res, next) {
  try {
    const entorno = parseEntorno(req);
    const id = parseId(req.params.id);
    if (!id) return redirectList(res, 'Usuario no válido', 'error', entorno);

    const user = await usuarioModel.findById(id, entorno);
    if (!user) return redirectList(res, 'Usuario no encontrado', 'error', entorno);

    const catalog = await loadEntornoCatalog(entorno);
    const { companies, almacenes } = catalog;
    const almacenOk = almacenes.some((a) => a.id === user.almacenId);
    res.render('usuarios/editar', {
      title: 'Editar usuario',
      error: null,
      companies,
      almacenes,
      estados: ESTADOS,
      roles: ROLES,
      isEdit: true,
      entorno,
      usuario: usuarioModel.toPublicUser(user),
      form: {
        email: user.email,
        estado: user.estado,
        rol: user.rol,
        companyId: user.companyId ? String(user.companyId) : '',
        almacenId: almacenOk ? (user.almacenId || '') : '',
      },
    });
  } catch (err) {
    next(err);
  }
}

async function update(req, res, next) {
  try {
    const entorno = parseEntorno(req);
    const id = parseId(req.params.id);
    if (!id) return redirectList(res, 'Usuario no válido', 'error', entorno);

    const user = await usuarioModel.findById(id, entorno);
    if (!user) return redirectList(res, 'Usuario no encontrado', 'error', entorno);

    const { companies, almacenes } = await loadEntornoCatalog(entorno);
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
      entorno,
        usuario: usuarioModel.toPublicUser(user),
        form,
      });

    const validationError = await validateUsuarioForm(form, companies, almacenes);
    if (validationError) return renderError(validationError);

    if (nuevaContrasena.length > 0 && nuevaContrasena.length < 6) {
      return renderError('La contraseña debe tener al menos 6 caracteres.');
    }

    const duplicate = await runWithEntorno(entorno, () => usuarioModel.findByEmailExceptId(form.email, id));
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
      await runWithEntorno(user._dbEntorno || 'prod', () => usuarioModel.clearTokens(id));
    }

    const doUpdate = () => usuarioModel.update(id, updateData);
    try {
      await runWithEntorno(entorno, doUpdate);
    } catch (err) {
      if (err?.code === 'P2003') {
        return renderError('El almacén o la empresa no existen en esta base. Elige un almacén de este entorno.');
      }
      throw err;
    }
    return redirectList(res, `Usuario ${form.email} actualizado.`, 'success', entorno);
  } catch (err) {
    next(err);
  }
}

function estadoChangedToInactive(estado, prev) {
  return estado !== 'ACTIVO' && prev === 'ACTIVO';
}

async function activate(req, res, next) {
  try {
    const entorno = parseEntorno(req);
    const id = parseId(req.params.id);
    if (!id) return redirectList(res, 'Usuario no válido', 'error', entorno);

    const user = await usuarioModel.findById(id, entorno);
    if (!user) return redirectList(res, 'Usuario no encontrado', 'error', entorno);

    await runWithEntorno(user._dbEntorno || 'prod', () => usuarioModel.setEstado(id, 'ACTIVO'));
    return redirectList(res, `Usuario ${user.email} activado.`, 'success', entorno);
  } catch (err) {
    next(err);
  }
}

async function deactivate(req, res, next) {
  try {
    const entorno = parseEntorno(req);
    const id = parseId(req.params.id);
    if (!id) return redirectList(res, 'Usuario no válido', 'error', entorno);

    const user = await usuarioModel.findById(id, entorno);
    if (!user) return redirectList(res, 'Usuario no encontrado', 'error', entorno);

    await runWithEntorno(user._dbEntorno || 'prod', () => usuarioModel.setEstado(id, 'INACTIVO'));
    return redirectList(res, `Usuario ${user.email} desactivado. Sesión cerrada.`, 'success', entorno);
  } catch (err) {
    next(err);
  }
}

async function destroy(req, res, next) {
  try {
    const entorno = parseEntorno(req);
    const id = parseId(req.params.id);
    if (!id) return redirectList(res, 'Usuario no válido', 'error', entorno);

    const user = await usuarioModel.findById(id, entorno);
    if (!user) return redirectList(res, 'Usuario no encontrado', 'error', entorno);

    await runWithEntorno(entorno, () => usuarioModel.remove(id));
    return redirectList(res, `Usuario ${user.email} eliminado.`, 'success', entorno);
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

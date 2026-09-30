const usuarioEmpresaService = require('../services/usuarioEmpresaService');
const { layoutLocals, redirectWithFlash, companyRucOf, parseFlash } = require('../utils/appWebHelpers');
const { appPath } = require('../config/appPanel');

function emptyForm() {
  return {
    email: '',
    rol: 'USUARIO',
    estado: 'ACTIVO',
    almacenId: '',
  };
}

function formFromBody(body, fallback = emptyForm()) {
  return {
    email: body?.email != null ? String(body.email) : fallback.email,
    rol: String(body?.rol || fallback.rol || 'USUARIO').toUpperCase(),
    estado: String(body?.estado || fallback.estado || 'ACTIVO').toUpperCase(),
    almacenId: String(body?.almacen_id ?? body?.almacenId ?? fallback.almacenId ?? ''),
  };
}

function actorId(res) {
  return res.locals.webUser?.id || null;
}

async function listar(req, res, next) {
  try {
    const companyRuc = companyRucOf(res);
    const q = String(req.query.q || '').trim();
    const items = await usuarioEmpresaService.listar(companyRuc, { q });
    res.render('app/usuarios/listar', layoutLocals(res, {
      title: 'Gestión de usuarios',
      active: 'ajustes',
      items,
      q,
      flash: parseFlash(req),
    }));
  } catch (err) {
    next(err);
  }
}

async function crearForm(req, res, next) {
  try {
    const almacenes = await usuarioEmpresaService.loadAlmacenes(companyRucOf(res));
    res.render('app/usuarios/form', layoutLocals(res, {
      title: 'Nuevo usuario',
      active: 'ajustes',
      mode: 'crear',
      form: emptyForm(),
      almacenes,
      roles: usuarioEmpresaService.ROLES_EMPRESA,
      estados: usuarioEmpresaService.ESTADOS,
      error: null,
      flash: null,
    }));
  } catch (err) {
    next(err);
  }
}

async function crear(req, res, next) {
  try {
    await usuarioEmpresaService.crear(companyRucOf(res), req.body || {});
    return redirectWithFlash(res, appPath('/usuarios'), 'Usuario creado.');
  } catch (err) {
    if (err.status === 400 || err.status === 409) {
      const almacenes = await usuarioEmpresaService.loadAlmacenes(companyRucOf(res));
      return res.status(err.status).render('app/usuarios/form', layoutLocals(res, {
        title: 'Nuevo usuario',
        active: 'ajustes',
        mode: 'crear',
        form: formFromBody(req.body),
        almacenes,
        roles: usuarioEmpresaService.ROLES_EMPRESA,
        estados: usuarioEmpresaService.ESTADOS,
        error: err.message,
        flash: null,
      }));
    }
    next(err);
  }
}

async function editarForm(req, res, next) {
  try {
    const id = usuarioEmpresaService.parseId(req.params.id);
    if (!id) return redirectWithFlash(res, appPath('/usuarios'), 'Usuario no válido', 'error');
    const { user } = await usuarioEmpresaService.getUsuarioDeEmpresa(companyRucOf(res), id);
    const almacenes = await usuarioEmpresaService.loadAlmacenes(companyRucOf(res));
    res.render('app/usuarios/form', layoutLocals(res, {
      title: 'Editar usuario',
      active: 'ajustes',
      mode: 'editar',
      form: {
        id: user.id,
        email: user.email,
        rol: user.rol,
        estado: user.estado,
        almacenId: user.almacenId || '',
      },
      almacenes,
      roles: usuarioEmpresaService.ROLES_EMPRESA,
      estados: usuarioEmpresaService.ESTADOS,
      error: null,
      flash: parseFlash(req),
    }));
  } catch (err) {
    if (err.status === 404 || err.status === 403) {
      return redirectWithFlash(res, appPath('/usuarios'), err.message, 'error');
    }
    next(err);
  }
}

async function editar(req, res, next) {
  try {
    const id = usuarioEmpresaService.parseId(req.params.id);
    if (!id) return redirectWithFlash(res, appPath('/usuarios'), 'Usuario no válido', 'error');
    await usuarioEmpresaService.actualizar(companyRucOf(res), id, req.body || {});
    return redirectWithFlash(res, appPath('/usuarios'), 'Usuario actualizado.');
  } catch (err) {
    if (err.status === 400 || err.status === 409) {
      const almacenes = await usuarioEmpresaService.loadAlmacenes(companyRucOf(res));
      return res.status(err.status).render('app/usuarios/form', layoutLocals(res, {
        title: 'Editar usuario',
        active: 'ajustes',
        mode: 'editar',
        form: { id: req.params.id, ...formFromBody(req.body) },
        almacenes,
        roles: usuarioEmpresaService.ROLES_EMPRESA,
        estados: usuarioEmpresaService.ESTADOS,
        error: err.message,
        flash: null,
      }));
    }
    if (err.status === 404 || err.status === 403) {
      return redirectWithFlash(res, appPath('/usuarios'), err.message, 'error');
    }
    next(err);
  }
}

async function activar(req, res, next) {
  try {
    const id = usuarioEmpresaService.parseId(req.params.id);
    if (!id) return redirectWithFlash(res, appPath('/usuarios'), 'Usuario no válido', 'error');
    await usuarioEmpresaService.cambiarEstado(companyRucOf(res), id, 'ACTIVO');
    return redirectWithFlash(res, appPath('/usuarios'), 'Usuario activado.');
  } catch (err) {
    if (err.status >= 400 && err.status < 500) {
      return redirectWithFlash(res, appPath('/usuarios'), err.message, 'error');
    }
    next(err);
  }
}

async function desactivar(req, res, next) {
  try {
    const id = usuarioEmpresaService.parseId(req.params.id);
    if (!id) return redirectWithFlash(res, appPath('/usuarios'), 'Usuario no válido', 'error');
    await usuarioEmpresaService.cambiarEstado(companyRucOf(res), id, 'INACTIVO');
    return redirectWithFlash(res, appPath('/usuarios'), 'Usuario desactivado.');
  } catch (err) {
    if (err.status >= 400 && err.status < 500) {
      return redirectWithFlash(res, appPath('/usuarios'), err.message, 'error');
    }
    next(err);
  }
}

async function destroy(req, res, next) {
  try {
    const id = usuarioEmpresaService.parseId(req.params.id);
    if (!id) return redirectWithFlash(res, appPath('/usuarios'), 'Usuario no válido', 'error');
    await usuarioEmpresaService.eliminar(companyRucOf(res), id, actorId(res));
    return redirectWithFlash(res, appPath('/usuarios'), 'Usuario eliminado.');
  } catch (err) {
    if (err.status >= 400 && err.status < 500) {
      return redirectWithFlash(res, appPath('/usuarios'), err.message, 'error');
    }
    next(err);
  }
}

module.exports = {
  listar,
  crearForm,
  crear,
  editarForm,
  editar,
  activar,
  desactivar,
  destroy,
};

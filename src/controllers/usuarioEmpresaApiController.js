const usuarioEmpresaService = require('../services/usuarioEmpresaService');

async function list(req, res, next) {
  try {
    const items = await usuarioEmpresaService.listar(req.companyRuc, {
      q: req.query.q || '',
    });
    res.json(items);
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const created = await usuarioEmpresaService.crear(req.companyRuc, req.body || {});
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
}

async function update(req, res, next) {
  try {
    const id = usuarioEmpresaService.parseId(req.params.id);
    if (!id) {
      return res.status(400).json({ success: false, message: 'Usuario no válido' });
    }
    const updated = await usuarioEmpresaService.actualizar(req.companyRuc, id, req.body || {});
    res.json(updated);
  } catch (err) {
    next(err);
  }
}

async function activar(req, res, next) {
  try {
    const id = usuarioEmpresaService.parseId(req.params.id);
    if (!id) {
      return res.status(400).json({ success: false, message: 'Usuario no válido' });
    }
    const updated = await usuarioEmpresaService.cambiarEstado(req.companyRuc, id, 'ACTIVO');
    res.json(updated);
  } catch (err) {
    next(err);
  }
}

async function desactivar(req, res, next) {
  try {
    const id = usuarioEmpresaService.parseId(req.params.id);
    if (!id) {
      return res.status(400).json({ success: false, message: 'Usuario no válido' });
    }
    const updated = await usuarioEmpresaService.cambiarEstado(req.companyRuc, id, 'INACTIVO');
    res.json(updated);
  } catch (err) {
    next(err);
  }
}

async function destroy(req, res, next) {
  try {
    const id = usuarioEmpresaService.parseId(req.params.id);
    if (!id) {
      return res.status(400).json({ success: false, message: 'Usuario no válido' });
    }
    await usuarioEmpresaService.eliminar(req.companyRuc, id, req.userId);
    res.json({ success: true, message: 'Usuario eliminado' });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  list,
  create,
  update,
  activar,
  desactivar,
  destroy,
};

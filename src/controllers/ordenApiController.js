const ordenModel = require('../models/ordenModel');
const { parseMobileListQuery, sendMobilePage } = require('../utils/pagination');

async function list(req, res, next) {
  try {
    const { q, page, pageSize, skip } = parseMobileListQuery(req.query);
    const estado = req.query.estado || null;
    const { items, total } = await ordenModel.findByCompanyPaginated(req.companyRuc, {
      q,
      estado,
      skip,
      take: pageSize,
    });
    const noVistas = await ordenModel.countNoVistas(req.companyRuc);
    return sendMobilePage(res, { items, total, page, pageSize, extra: { no_vistas: noVistas } });
  } catch (err) {
    next(err);
  }
}

async function countNoVistas(req, res, next) {
  try {
    const count = await ordenModel.countNoVistas(req.companyRuc);
    return res.json({ count, no_vistas: count });
  } catch (err) {
    next(err);
  }
}

async function marcarVista(req, res, next) {
  try {
    const row = await ordenModel.marcarVista(req.companyRuc, req.params.id);
    return res.json(row);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    next(err);
  }
}

async function getById(req, res, next) {
  try {
    const row = await ordenModel.findById(req.companyRuc, req.params.id, { marcarVisto: true });
    if (!row) {
      return res.status(404).json({ success: false, message: 'Orden no encontrada' });
    }
    return res.json(row);
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const row = await ordenModel.create(req.companyRuc, req.body || {});
    return res.status(201).json(row);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    next(err);
  }
}

async function update(req, res, next) {
  try {
    const row = await ordenModel.update(req.companyRuc, req.params.id, req.body || {});
    return res.json(row);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    next(err);
  }
}

async function anular(req, res, next) {
  try {
    const row = await ordenModel.anular(req.companyRuc, req.params.id);
    return res.json(row);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    next(err);
  }
}

async function destroy(req, res, next) {
  try {
    await ordenModel.destroy(req.companyRuc, req.params.id);
    return res.json({ success: true });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    next(err);
  }
}

async function direccionesEnvioRecientes(req, res, next) {
  try {
    const limit = req.query.limit || 10;
    const items = await ordenModel.listDireccionesEnvioRecientes(req.companyRuc, { limit });
    return res.json({ items, total: items.length });
  } catch (err) {
    next(err);
  }
}

async function crearDireccionEnvio(req, res, next) {
  try {
    const row = await ordenModel.crearDireccionEnvio(req.companyRuc, req.body || {});
    return res.status(201).json(row);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    next(err);
  }
}

async function actualizarDireccionEnvio(req, res, next) {
  try {
    const row = await ordenModel.actualizarDireccionEnvio(
      req.companyRuc,
      req.params.id,
      req.body || {},
    );
    return res.json(row);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    next(err);
  }
}

module.exports = {
  list,
  countNoVistas,
  marcarVista,
  getById,
  create,
  update,
  anular,
  destroy,
  direccionesEnvioRecientes,
  crearDireccionEnvio,
  actualizarDireccionEnvio,
};

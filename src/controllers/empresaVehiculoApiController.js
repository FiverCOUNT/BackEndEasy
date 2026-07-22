const empresaVehiculoModel = require('../models/empresaVehiculoModel');

async function list(req, res, next) {
  try {
    const q = req.query.q || req.query.placa || null;
    const rows = await empresaVehiculoModel.listAll({ q });
    res.json(rows.map(empresaVehiculoModel.toApi));
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const row = await empresaVehiculoModel.create(req.body);
    res.status(201).json(empresaVehiculoModel.toApi(row));
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    next(err);
  }
}

async function update(req, res, next) {
  try {
    const row = await empresaVehiculoModel.update(req.params.id, req.body);
    res.json(empresaVehiculoModel.toApi(row));
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    next(err);
  }
}

async function destroy(req, res, next) {
  try {
    const result = await empresaVehiculoModel.remove(req.params.id);
    res.json({ success: true, id: result.id });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    next(err);
  }
}

module.exports = {
  list,
  create,
  update,
  destroy,
};

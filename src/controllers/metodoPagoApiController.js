const metodoPagoModel = require('../models/metodoPagoModel');

async function list(req, res, next) {
  try {
    const soloActivos = req.query.solo_activos === '1'
      || req.query.solo_activos === 'true'
      || req.query.activos === '1';
    const q = req.query.q || req.query.buscar || '';
    const rows = await metodoPagoModel.listByCompany(req.companyRuc, { soloActivos, q });
    res.json(rows);
  } catch (err) {
    next(err);
  }
}

async function getById(req, res, next) {
  try {
    const row = await metodoPagoModel.findById(req.companyRuc, req.params.id);
    if (!row) {
      return res.status(404).json({ success: false, message: 'Método de pago no encontrado' });
    }
    res.json(row);
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const row = await metodoPagoModel.create(req.companyRuc, req.body || {});
    res.status(201).json(row);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    next(err);
  }
}

async function update(req, res, next) {
  try {
    const row = await metodoPagoModel.update(req.companyRuc, req.params.id, req.body || {});
    res.json(row);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    next(err);
  }
}

async function destroy(req, res, next) {
  try {
    const row = await metodoPagoModel.remove(req.companyRuc, req.params.id);
    res.json({ success: true, id: row?.id || req.params.id });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    next(err);
  }
}

module.exports = {
  list,
  getById,
  create,
  update,
  destroy,
};

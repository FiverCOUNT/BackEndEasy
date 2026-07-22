const companyModel = require('../models/companyModel');

async function list(req, res, next) {
  try {
    const q = req.query.q || req.query.buscar || null;
    const soloConMtc = req.query.solo_mtc === '1' || req.query.solo_mtc === 'true';
    const rows = await companyModel.listForTransporte({ q, soloConMtc });
    res.json(rows.map(companyModel.toPublic));
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const row = await companyModel.upsertTransporte(req.body);
    res.status(201).json(companyModel.toPublic(row));
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    next(err);
  }
}

async function update(req, res, next) {
  try {
    const row = await companyModel.updateTransporte(req.params.id, req.body);
    res.json(companyModel.toPublic(row));
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    next(err);
  }
}

async function destroy(req, res, next) {
  try {
    const result = await companyModel.removeTransporteIfSafe(req.params.id);
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

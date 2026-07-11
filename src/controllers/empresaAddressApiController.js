const empresaAddressModel = require('../models/empresaAddressModel');

async function list(req, res, next) {
  try {
    const rows = await empresaAddressModel.listByCompany(req.companyRuc);
    res.json(rows.map(empresaAddressModel.toApi));
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const row = await empresaAddressModel.create(req.companyRuc, req.body);
    res.status(201).json(empresaAddressModel.toApi(row));
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    next(err);
  }
}

async function update(req, res, next) {
  try {
    const row = await empresaAddressModel.update(req.companyRuc, req.params.id, req.body);
    res.json(empresaAddressModel.toApi(row));
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    next(err);
  }
}

async function destroy(req, res, next) {
  try {
    const result = await empresaAddressModel.remove(req.companyRuc, req.params.id);
    res.json({ success: true, id: result.id });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    next(err);
  }
}

module.exports = { list, create, update, destroy };

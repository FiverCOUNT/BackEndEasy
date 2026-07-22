const companyModel = require('../models/companyModel');

async function patchMtc(req, res, next) {
  try {
    const nroMtc = req.body?.nro_mtc ?? req.body?.nroMtc ?? '';
    const row = await companyModel.updateNroMtcByRuc(req.companyRuc, nroMtc);
    res.json({
      success: true,
      company_ruc: row.ruc,
      nro_mtc: row.nroMtc,
      nroMtc: row.nroMtc,
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    next(err);
  }
}

async function getPerfil(req, res, next) {
  try {
    const company = await companyModel.findByRuc(req.companyRuc);
    if (!company) {
      return res.status(404).json({ success: false, message: 'Empresa no encontrada' });
    }
    res.json(companyModel.toPublic(company));
  } catch (err) {
    next(err);
  }
}

module.exports = {
  patchMtc,
  getPerfil,
};

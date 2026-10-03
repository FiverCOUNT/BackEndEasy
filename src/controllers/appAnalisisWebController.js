const analisisModel = require('../models/analisisModel');
const { layoutLocals, companyRucOf } = require('../utils/appWebHelpers');

async function show(req, res, next) {
  try {
    const companyRuc = companyRucOf(res);
    const data = await analisisModel.resumenProductos(companyRuc, req.query);
    res.render('app/analisis/index', layoutLocals(res, {
      title: 'Análisis',
      active: 'analisis',
      ...data,
    }));
  } catch (err) {
    next(err);
  }
}

module.exports = { show };

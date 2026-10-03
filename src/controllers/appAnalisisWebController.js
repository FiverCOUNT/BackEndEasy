const analisisModel = require('../models/analisisModel');
const almacenModel = require('../models/almacenModel');
const { layoutLocals, companyRucOf } = require('../utils/appWebHelpers');

async function show(req, res, next) {
  try {
    const companyRuc = companyRucOf(res);
    const vista = String(req.query.vista || '').trim();
    const orden = vista === 'ingresos'
      ? 'venta'
      : (vista === 'vendidos' ? 'unidades' : String(req.query.orden || 'unidades'));
    const almacenes = await almacenModel.findByCompanyRuc(companyRuc, { soloActivos: true });
    const almacenNombres = {};
    for (const a of almacenes) {
      almacenNombres[a.id] = a.nombre || a.codigo || a.id;
    }
    const data = await analisisModel.resumenProductos(companyRuc, {
      ...req.query,
      // Siempre todos los vendidos; el margen solo aparece si hay precio de compra.
      solo_costo: '0',
      orden,
      top: req.query.top || 10,
      vista: vista || (orden === 'venta' ? 'ingresos' : 'vendidos'),
      almacenNombres,
    });
    data.filtros.vista = data.filtros.vista || (orden === 'venta' ? 'ingresos' : 'vendidos');
    res.render('app/analisis/index', layoutLocals(res, {
      title: 'Análisis',
      active: 'analisis',
      almacenes,
      ...data,
    }));
  } catch (err) {
    next(err);
  }
}

module.exports = { show };

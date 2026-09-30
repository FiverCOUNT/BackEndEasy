const comprobanteModel = require('../models/comprobanteModel');
const { formatFechaHora } = require('../utils/appWebHelpers');

function parseFlash(req) {
  const { msg, tipo } = req.query;
  if (!msg) return null;
  return { text: msg, type: tipo === 'error' ? 'error' : 'success' };
}

async function list(req, res, next) {
  try {
    const rows = await comprobanteModel.findAll();
    const comprobantes = rows.map((c) => ({
      ...c,
      fechaEmision: formatFechaHora(c.fechaEmision),
    }));
    res.render('comprobantes/listar', {
      title: 'Comprobantes',
      comprobantes,
      total: comprobantes.length,
      flash: parseFlash(req),
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { list };

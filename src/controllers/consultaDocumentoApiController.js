const consultaDocumentoService = require('../services/consultaDocumentoService');

async function consultarRuc(req, res, next) {
  try {
    const numero = req.query.numero || req.params.numero || req.body?.numero;
    const result = await consultaDocumentoService.consultarRuc(req.companyRuc, numero);
    res.json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    next(err);
  }
}

module.exports = {
  consultarRuc,
};

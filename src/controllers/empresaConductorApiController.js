const empresaConductorModel = require('../models/empresaConductorModel');

async function list(req, res, next) {
  try {
    const q = req.query.q || req.query.buscar || null;
    const rows = await empresaConductorModel.listAll(req.companyRuc, { q });
    res.json(rows.map(empresaConductorModel.toApi));
  } catch (err) {
    next(err);
  }
}

async function lookup(req, res, next) {
  try {
    const numero = req.query.numero || req.query.numero_doc || req.query.num_doc;
    const tipoDoc = req.query.tipo_doc || req.query.tipoDoc || '1';
    if (!numero) {
      return res.status(400).json({
        success: false,
        message: 'Indica el número de documento (?numero=)',
      });
    }
    const row = await empresaConductorModel.findByDocumento(req.companyRuc, tipoDoc, numero);
    if (!row) {
      return res.json({
        encontrado: false,
        conductor: null,
        mensaje: 'Conductor no registrado. Puedes escribir los datos o guardarlo.',
      });
    }
    return res.json({
      encontrado: true,
      conductor: empresaConductorModel.toApi(row),
      mensaje: 'Conductor encontrado',
    });
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const row = await empresaConductorModel.create(req.companyRuc, req.body);
    res.status(201).json(empresaConductorModel.toApi(row));
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    next(err);
  }
}

async function update(req, res, next) {
  try {
    const row = await empresaConductorModel.update(req.params.id, req.companyRuc, req.body);
    res.json(empresaConductorModel.toApi(row));
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    next(err);
  }
}

async function destroy(req, res, next) {
  try {
    const result = await empresaConductorModel.remove(req.params.id, req.companyRuc);
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
  lookup,
  create,
  update,
  destroy,
};

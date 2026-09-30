const ubigeoModel = require('../models/ubigeoModel');
const ordenModel = require('../models/ordenModel');
const { parseOffsetLimit, buildOffsetPage } = require('../utils/pagination');
const { companyRucOf } = require('../utils/appWebHelpers');

async function regionesJson(req, res, next) {
  try {
    const items = await ubigeoModel.listRegiones();
    res.json({ success: true, items });
  } catch (err) {
    next(err);
  }
}

async function provinciasJson(req, res, next) {
  try {
    const region = String(req.params.regionCodigo || req.query.region || '').trim();
    if (!region) {
      return res.status(400).json({ success: false, message: 'Indica la región.' });
    }
    const items = await ubigeoModel.listProvinciasByRegion(region);
    res.json({ success: true, items });
  } catch (err) {
    next(err);
  }
}

async function distritosJson(req, res, next) {
  try {
    const provincia = String(req.params.provinciaCodigo || req.query.provincia || '').trim();
    if (!provincia) {
      return res.status(400).json({ success: false, message: 'Indica la provincia.' });
    }
    const items = await ubigeoModel.listDistritosByProvincia(provincia);
    res.json({ success: true, items });
  } catch (err) {
    next(err);
  }
}

async function lookupUbigeoJson(req, res, next) {
  try {
    const item = await ubigeoModel.findDistritoByUbigeo(req.params.ubigeo || req.query.ubigeo);
    if (!item) {
      return res.status(404).json({ success: false, message: 'Ubigeo no encontrado.' });
    }
    res.json({ success: true, item });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ success: false, message: err.message });
    next(err);
  }
}

/** Recientes / catálogo de addresses de la empresa (mismo menú del picker). */
async function ubicacionesRecientesJson(req, res, next) {
  try {
    const { q, offset, limit } = parseOffsetLimit(req.query);
    const page = await ordenModel.listDireccionesEnvioCatalogo(companyRucOf(res), {
      q,
      offset,
      limit,
    });
    res.json(buildOffsetPage({
      items: page.items,
      total: page.total,
      offset,
      limit,
    }));
  } catch (err) {
    next(err);
  }
}

async function crearUbicacionJson(req, res, next) {
  try {
    const row = await ordenModel.crearDireccionEnvio(companyRucOf(res), req.body || {});
    res.status(201).json(row);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ success: false, message: err.message });
    next(err);
  }
}

async function actualizarUbicacionJson(req, res, next) {
  try {
    const row = await ordenModel.actualizarDireccionEnvio(
      companyRucOf(res),
      req.params.id,
      req.body || {},
    );
    res.json(row);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ success: false, message: err.message });
    next(err);
  }
}

async function tocarUbicacionJson(req, res, next) {
  try {
    const row = await ordenModel.tocarDireccionEnvio(companyRucOf(res), req.params.id);
    res.json(row);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ success: false, message: err.message });
    next(err);
  }
}

async function eliminarUbicacionJson(req, res, next) {
  try {
    const row = await ordenModel.eliminarDireccionEnvio(companyRucOf(res), req.params.id);
    res.json(row);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ success: false, message: err.message });
    next(err);
  }
}

module.exports = {
  regionesJson,
  provinciasJson,
  distritosJson,
  lookupUbigeoJson,
  ubicacionesRecientesJson,
  crearUbicacionJson,
  actualizarUbicacionJson,
  tocarUbicacionJson,
  eliminarUbicacionJson,
};

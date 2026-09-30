const configuracionModel = require('../models/configuracionModel');
const { adminPath } = require('../config/adminPanel');

function parseFlash(req) {
  const { msg, tipo } = req.query;
  if (!msg) return null;
  return { text: msg, type: tipo === 'error' ? 'error' : 'success' };
}

function redirectEdit(res, message, type = 'success') {
  const q = new URLSearchParams({ msg: message, tipo: type });
  return res.redirect(`${adminPath('/configuracion')}?${q.toString()}`);
}

async function showEditForm(req, res, next) {
  try {
    const entorno = res.locals.adminEntorno === 'beta' ? 'beta' : 'prod';
    const row = await configuracionModel.getSingleton(entorno);
    res.render('configuracion/editar', {
      title: 'Configuración de la app',
      form: configuracionModel.formFromRecord(row),
      flash: parseFlash(req),
      actualizadoEn: row.actualizadoEn,
    });
  } catch (err) {
    next(err);
  }
}

async function update(req, res, next) {
  try {
    const entorno = res.locals.adminEntorno === 'beta' ? 'beta' : 'prod';
    await configuracionModel.updateFromBody(req.body, {
      logoFile: req.file || null,
      entorno,
    });
    return redirectEdit(res, 'Configuración de Easy guardada correctamente.');
  } catch (err) {
    if (err.message && !err.code) {
      const entorno = res.locals.adminEntorno === 'beta' ? 'beta' : 'prod';
      const row = await configuracionModel.getSingleton(entorno).catch(() => null);
      const fallback = configuracionModel.formFromRecord(row);
      return res.status(400).render('configuracion/editar', {
        title: 'Configuración de la app',
        form: {
          ...fallback,
          ...req.body,
          urlLogo: req.body.urlLogo || fallback.urlLogo,
          mantenimientoActivo: req.body.mantenimientoActivo === 'on',
          actualizar: req.body.actualizar === 'on',
        },
        error: err.message,
        actualizadoEn: row?.actualizadoEn,
      });
    }
    return next(err);
  }
}

module.exports = {
  showEditForm,
  update,
};

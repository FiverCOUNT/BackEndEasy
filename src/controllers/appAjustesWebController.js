const usuarioModel = require('../models/usuarioModel');
const companyModel = require('../models/companyModel');
const configuracionModel = require('../models/configuracionModel');
const companyLogoService = require('../services/companyLogoService');
const { layoutLocals, redirectWithFlash, isWebCompanyAdmin } = require('../utils/appWebHelpers');
const { appPath } = require('../config/appPanel');

function layoutLocalsAjustes(res, extra = {}) {
  return layoutLocals(res, extra);
}

async function show(req, res, next) {
  try {
    const session = res.locals.webUser || {};
    const user = await usuarioModel.findById(session.id);
    const companyRuc = res.locals.companyRuc || user?.company?.ruc || '';
    const company = companyRuc
      ? await companyModel.findByRuc(companyRuc)
      : null;
    const companyPublic = company ? companyModel.toPublic(company) : null;

    const configRow = await configuracionModel.getSingleton();
    const configApp = configuracionModel.toApiMobile(configRow);

    const almacenNombre = user?.almacen?.nombre || session.almacenNombre || null;
    const almacenId = user?.almacenId != null ? String(user.almacenId) : (session.almacenId || null);
    let almacenAsignado = 'Sin almacén asignado';
    if (almacenNombre) {
      almacenAsignado = almacenNombre;
    } else if (almacenId) {
      const almacenModel = require('../models/almacenModel');
      const alm = await almacenModel.findById(almacenId).catch(() => null);
      if (alm?.nombre) {
        almacenAsignado = alm.nombre;
      } else if (alm?.codigo) {
        almacenAsignado = alm.codigo;
      } else if (session.rol === 'ADMIN') {
        almacenAsignado = 'Sin asignar (administrador)';
      } else {
        almacenAsignado = 'Almacén no encontrado';
      }
    } else if (session.rol === 'ADMIN') {
      almacenAsignado = 'Sin asignar (administrador)';
    }

    const soporte = configApp.soporte || {};
    const tieneSoporte = Boolean(
      (Array.isArray(soporte.telefonos) && soporte.telefonos.length)
      || soporte.whatsapp
      || soporte.email
      || soporte.horario
      || soporte.desarrollador,
    );

    const actualizaciones = configApp.actualizaciones || {};
    const tieneActualizaciones = Boolean(
      actualizaciones.url
      || actualizaciones.url_apk
      || actualizaciones.version_actual
      || actualizaciones.version_minima,
    );

    const flash = (() => {
      const { msg, tipo } = req.query;
      if (!msg) return null;
      return { text: msg, type: tipo === 'error' ? 'error' : 'success' };
    })();

    res.render('app/ajustes', layoutLocalsAjustes(res, {
      title: 'Ajustes',
      active: 'ajustes',
      flash,
      canEditLogo: isWebCompanyAdmin(session),
      canEditMtc: isWebCompanyAdmin(session),
      canManageMetodosPago: isWebCompanyAdmin(session),
      canManageUsuarios: isWebCompanyAdmin(session),
      usuario: {
        email: user?.email || session.email,
        rol: user?.rol || session.rol,
        estado: user?.estado || session.estado,
      },
      empresa: {
        nombre: companyPublic?.nombre || res.locals.companyRazonSocial || res.locals.companyNombre || 'Empresa',
        displayName: companyPublic
          ? (companyModel.displayName(companyPublic) || companyPublic.nombre)
          : (res.locals.companyNombre || 'Empresa'),
        ruc: companyPublic?.ruc || companyRuc || '—',
        nombreComercial: companyPublic?.nombreComercial || null,
        email: companyPublic?.email || null,
        telefono: companyPublic?.telefono || null,
        nroMtc: companyPublic?.nroMtc || null,
        logoUrl: companyPublic?.logoUrl || res.locals.companyLogoUrl || null,
        initials: companyModel.initialsFromName(
          companyPublic ? companyModel.displayName(companyPublic) : res.locals.companyNombre,
        ),
        entorno: (companyModel.entornoLabel(companyPublic?.entorno)).key,
        entornoLabel: (companyModel.entornoLabel(companyPublic?.entorno)).label,
        esProd: (companyModel.entornoLabel(companyPublic?.entorno)).isProd,
      },
      almacenAsignado,
      soporte,
      tieneSoporte,
      actualizaciones,
      tieneActualizaciones,
    }));
  } catch (err) {
    next(err);
  }
}

async function uploadLogo(req, res, next) {
  try {
    const companyRuc = res.locals.companyRuc || '';
    if (!companyRuc) {
      return redirectWithFlash(res, `${appPath('/ajustes')}`, 'Empresa no encontrada', 'error');
    }
    if (!req.file) {
      return redirectWithFlash(res, `${appPath('/ajustes')}`, 'Selecciona una foto o logo', 'error');
    }

    const uploaded = await companyLogoService.uploadCompanyLogo(companyRuc, req.file);
    await companyModel.updateLogoByRuc(companyRuc, {
      // Preferir URL pública para mostrar al instante; si no hay, guardar key R2.
      rutaLogo: uploaded.url || uploaded.key,
      nameLogo: uploaded.nombre,
    });

    return redirectWithFlash(res, `${appPath('/ajustes')}`, 'Foto de la empresa actualizada');
  } catch (err) {
    if (err.message && !err.code) {
      return redirectWithFlash(res, `${appPath('/ajustes')}`, err.message, 'error');
    }
    return next(err);
  }
}

async function updateMtc(req, res, next) {
  try {
    const companyRuc = res.locals.companyRuc || '';
    if (!companyRuc) {
      return redirectWithFlash(res, `${appPath('/ajustes')}`, 'Empresa no encontrada', 'error');
    }
    const nroMtc = req.body?.nro_mtc ?? req.body?.nroMtc ?? '';
    await companyModel.updateNroMtcByRuc(companyRuc, nroMtc);
    return redirectWithFlash(res, `${appPath('/ajustes')}`, 'Número MTC actualizado');
  } catch (err) {
    if (err.message && !err.code) {
      return redirectWithFlash(res, `${appPath('/ajustes')}`, err.message, 'error');
    }
    return next(err);
  }
}

module.exports = { show, uploadLogo, updateMtc };

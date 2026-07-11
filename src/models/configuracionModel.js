const prisma = require('../config/prisma');

const CONFIG_ID = 1;

const DEFAULTS = {
  nombreApp: 'FactApp',
  nombreDesarrollador: '',
  telefonosSoporte: [],
  whatsappSoporte: null,
  emailSoporte: null,
  horarioSoporte: null,
  urlActualizacion: null,
  urlActualizacionApk: null,
  versionActual: '1.0.0',
  versionMinima: '1.0.0',
  notasRelease: null,
  actualizar: false,
  mantenimientoActivo: false,
  mensajeMantenimiento: null,
  urlTerminos: null,
  urlPrivacidad: null,
  urlSitioWeb: null,
  urlLogo: null,
  mensajeBienvenida: null,
  redesSociales: null,
};

function trimOrNull(value) {
  const v = String(value ?? '').trim();
  return v || null;
}

function parseTelefonos(raw) {
  if (Array.isArray(raw)) {
    return raw.map((t) => String(t).trim()).filter(Boolean);
  }
  const text = String(raw ?? '').trim();
  if (!text) return [];
  return text
    .split(/[\n,;]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function parseRedesSociales(body) {
  const redes = {};
  const map = {
    facebook: body.red_facebook,
    instagram: body.red_instagram,
    tiktok: body.red_tiktok,
    youtube: body.red_youtube,
    linkedin: body.red_linkedin,
  };
  Object.entries(map).forEach(([key, value]) => {
    const v = trimOrNull(value);
    if (v) redes[key] = v;
  });
  return Object.keys(redes).length ? redes : null;
}

function redesToForm(redes) {
  const src = redes && typeof redes === 'object' ? redes : {};
  return {
    red_facebook: src.facebook || '',
    red_instagram: src.instagram || '',
    red_tiktok: src.tiktok || '',
    red_youtube: src.youtube || '',
    red_linkedin: src.linkedin || '',
  };
}

function toPublic(row) {
  if (!row) return { ...DEFAULTS, id: CONFIG_ID };
  return {
    id: row.id,
    nombreApp: row.nombreApp,
    nombreDesarrollador: row.nombreDesarrollador,
    telefonosSoporte: Array.isArray(row.telefonosSoporte) ? row.telefonosSoporte : [],
    whatsappSoporte: row.whatsappSoporte,
    emailSoporte: row.emailSoporte,
    horarioSoporte: row.horarioSoporte,
    urlActualizacion: row.urlActualizacion,
    urlActualizacionApk: row.urlActualizacionApk,
    versionActual: row.versionActual,
    versionMinima: row.versionMinima,
    notasRelease: row.notasRelease,
    actualizar: row.actualizar === true,
    mantenimientoActivo: row.mantenimientoActivo === true,
    mensajeMantenimiento: row.mensajeMantenimiento,
    urlTerminos: row.urlTerminos,
    urlPrivacidad: row.urlPrivacidad,
    urlSitioWeb: row.urlSitioWeb,
    urlLogo: row.urlLogo,
    mensajeBienvenida: row.mensajeBienvenida,
    redesSociales: row.redesSociales,
    actualizadoEn: row.actualizadoEn,
  };
}

function formFromRecord(row) {
  const c = toPublic(row);
  return {
    nombreApp: c.nombreApp,
    nombreDesarrollador: c.nombreDesarrollador,
    telefonosSoporteTexto: (c.telefonosSoporte || []).join('\n'),
    whatsappSoporte: c.whatsappSoporte || '',
    emailSoporte: c.emailSoporte || '',
    horarioSoporte: c.horarioSoporte || '',
    urlActualizacion: c.urlActualizacion || '',
    urlActualizacionApk: c.urlActualizacionApk || '',
    versionActual: c.versionActual || '',
    versionMinima: c.versionMinima || '',
    notasRelease: c.notasRelease || '',
    actualizar: c.actualizar,
    mantenimientoActivo: c.mantenimientoActivo,
    mensajeMantenimiento: c.mensajeMantenimiento || '',
    urlTerminos: c.urlTerminos || '',
    urlPrivacidad: c.urlPrivacidad || '',
    urlSitioWeb: c.urlSitioWeb || '',
    urlLogo: c.urlLogo || '',
    mensajeBienvenida: c.mensajeBienvenida || '',
    ...redesToForm(c.redesSociales),
  };
}

function parseBody(body) {
  const nombreApp = trimOrNull(body.nombreApp);
  const nombreDesarrollador = trimOrNull(body.nombreDesarrollador);
  if (!nombreApp) throw new Error('El nombre de la app es obligatorio.');
  if (!nombreDesarrollador) throw new Error('El nombre del desarrollador o empresa es obligatorio.');

  return {
    nombreApp,
    nombreDesarrollador,
    telefonosSoporte: parseTelefonos(body.telefonosSoporteTexto ?? body.telefonosSoporte),
    whatsappSoporte: trimOrNull(body.whatsappSoporte),
    emailSoporte: trimOrNull(body.emailSoporte),
    horarioSoporte: trimOrNull(body.horarioSoporte),
    urlActualizacion: trimOrNull(body.urlActualizacion),
    urlActualizacionApk: trimOrNull(body.urlActualizacionApk),
    versionActual: trimOrNull(body.versionActual),
    versionMinima: trimOrNull(body.versionMinima),
    notasRelease: trimOrNull(body.notasRelease),
    actualizar: body.actualizar === 'on' || body.actualizar === 'true',
    mantenimientoActivo: body.mantenimientoActivo === 'on' || body.mantenimientoActivo === 'true',
    mensajeMantenimiento: trimOrNull(body.mensajeMantenimiento),
    urlTerminos: trimOrNull(body.urlTerminos),
    urlPrivacidad: trimOrNull(body.urlPrivacidad),
    urlSitioWeb: trimOrNull(body.urlSitioWeb),
    urlLogo: trimOrNull(body.urlLogo),
    mensajeBienvenida: trimOrNull(body.mensajeBienvenida),
    redesSociales: parseRedesSociales(body),
    actualizadoEn: new Date().toISOString().slice(0, 19),
  };
}

async function getSingleton() {
  let row = await prisma.configuracion.findUnique({ where: { id: CONFIG_ID } });
  if (!row) {
    row = await prisma.configuracion.create({
      data: { id: CONFIG_ID, ...DEFAULTS, actualizadoEn: new Date().toISOString().slice(0, 19) },
    });
  }
  return row;
}

async function updateFromBody(body) {
  const data = parseBody(body);
  return prisma.configuracion.upsert({
    where: { id: CONFIG_ID },
    create: { id: CONFIG_ID, ...data },
    update: data,
  });
}

function toApiMobile(row) {
  const c = toPublic(row);
  return {
    soporte: {
      telefonos: c.telefonosSoporte || [],
      whatsapp: c.whatsappSoporte,
      email: c.emailSoporte,
      horario: c.horarioSoporte,
      desarrollador: c.nombreDesarrollador,
    },
    actualizaciones: {
      url: c.urlActualizacion,
      url_apk: c.urlActualizacionApk,
      version_actual: c.versionActual,
      version_minima: c.versionMinima,
      actualizar: c.actualizar === true,
    },
    actualizado_en: c.actualizadoEn,
  };
}

module.exports = {
  CONFIG_ID,
  getSingleton,
  updateFromBody,
  parseBody,
  formFromRecord,
  toPublic,
  toApiMobile,
};

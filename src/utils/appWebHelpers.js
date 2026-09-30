const { APP_NAV_ITEMS, appPath } = require('../config/appPanel');

const MOTIVO_NC_LABEL = {
  '01': 'Anulación de la operación',
  '02': 'Anulación por error en el RUC',
  '03': 'Corrección por error en la descripción',
  '04': 'Descuento global',
  '05': 'Descuento por ítem',
  '06': 'Devolución total',
  '07': 'Devolución por ítem',
  '08': 'Bonificación',
  '09': 'Disminución en el valor',
  '10': 'Otros conceptos',
  '11': 'Ajustes de operaciones de exportación',
  '12': 'Ajustes afectos al IVAP',
  '13': 'Ajustes – montos y/o fechas de pago',
};

const MOTIVO_ND_LABEL = {
  '01': 'Intereses por mora',
  '02': 'Aumento en el valor',
  '03': 'Penalidades / otros conceptos',
  '04': 'Ajustes de operaciones de exportación',
  '05': 'Ajustes afectos al IVAP',
};

const TIPO_DOC_LABEL = {
  '01': 'Factura',
  '03': 'Boleta',
  '07': 'Nota crédito',
  '08': 'Nota débito',
  '09': 'Guía remisión',
  '31': 'GRE transportista',
};

function parseFlash(req) {
  const { msg, tipo } = req.query;
  if (!msg) return null;
  return { text: msg, type: tipo === 'error' ? 'error' : 'success' };
}

function redirectWithFlash(res, path, message, type = 'success', extra = {}) {
  const q = new URLSearchParams({ msg: message, tipo: type, ...extra });
  return res.redirect(`${path}?${q.toString()}`);
}

function isWebCompanyAdmin(user) {
  return Boolean(user?.rol === 'ADMIN');
}

function navItemsForUser(user) {
  const admin = isWebCompanyAdmin(user);
  return APP_NAV_ITEMS.filter((item) => !item.adminOnly || admin);
}

function layoutLocals(res, extra = {}) {
  const webUser = res.locals.webUser || {};
  const isAdmin = isWebCompanyAdmin(webUser);
  return {
    webUser,
    appBase: res.locals.appBase,
    companyNombre: res.locals.companyNombre,
    companyRuc: res.locals.companyRuc,
    companyRazonSocial: res.locals.companyRazonSocial || res.locals.companyNombre,
    companyNombreComercial: res.locals.companyNombreComercial || null,
    companyLogoUrl: res.locals.companyLogoUrl || null,
    companyInitials: res.locals.companyInitials || 'E',
    companyEntorno: res.locals.companyEntorno || 'beta',
    companyEntornoLabel: res.locals.companyEntornoLabel || 'Beta',
    companyEsProd: Boolean(res.locals.companyEsProd),
    easyLogoUrl: res.locals.easyLogoUrl || '/img/easy-logo.png',
    easyNombreApp: res.locals.easyNombreApp || 'Easy',
    isWebAdmin: isAdmin,
    userAlmacenId: res.locals.userAlmacenId || webUser.almacenId || null,
    navItems: navItemsForUser(webUser),
    ...extra,
  };
}

function companyRucOf(res) {
  return String(res.locals.companyRuc || '').trim();
}

function formatMoney(value, moneda = 'PEN') {
  const n = Number(value);
  if (!Number.isFinite(n)) return moneda === 'USD' ? 'US$ 0.00' : 'S/ 0.00';
  const sym = moneda === 'USD' ? 'US$' : 'S/';
  return `${sym} ${n.toFixed(2)}`;
}

function labelTipoDoc(tipo) {
  const t = String(tipo || '').padStart(2, '0');
  return TIPO_DOC_LABEL[t] || `Doc ${t}`;
}

/** GRE emitida vía wizard por evento (tipo Doc sigue siendo 09 o 31). */
function esGrePorEvento(row = {}) {
  const tipo = String(row.tipo_doc || row.tipoDoc || '').padStart(2, '0');
  if (tipo !== '09' && tipo !== '31') return false;
  const envio = row.envio
    || row.guia_meta?.envio
    || row.guiaMetaJson?.envio
    || {};
  if (envio.gre_por_evento === true || envio.grePorEvento === true) return true;
  if (String(envio.tipo_evento || envio.tipoEvento || '').trim()) return true;
  const obs = String(row.observacion || row.observaciones || '').toLowerCase();
  return obs.includes('gre por evento');
}

function labelTipoComprobante(row = {}) {
  if (esGrePorEvento(row)) return 'GRE por evento';
  return labelTipoDoc(row.tipo_doc || row.tipoDoc);
}

function labelMotivoNota(tipoDoc, codigo, glosa) {
  const tipo = String(tipoDoc || '').padStart(2, '0');
  const cod = String(codigo || '').trim();
  const catalogo = tipo === '08' ? MOTIVO_ND_LABEL : MOTIVO_NC_LABEL;
  const titulo = catalogo[cod] || '';
  const desc = String(glosa || '').trim();
  if (cod && titulo) return `${cod} — ${titulo}`;
  return titulo || desc || (cod ? `Motivo ${cod}` : '');
}

function formatDocRef(row) {
  const serie = row.serie || '';
  const corr = row.correlativo || '';
  return serie ? `${serie}-${corr}` : corr || '—';
}

function formatFecha(value) {
  if (value == null || value === '') return '—';
  const { toApiTimestamp } = require('./fechas');
  const ms = typeof value === 'number' ? value : toApiTimestamp(value);
  if (ms == null) {
    const s = String(value);
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    return s.slice(0, 16);
  }
  // Siempre calendario Perú (mismo criterio que filtros Hoy/Ayer/Fecha).
  return new Date(ms).toLocaleDateString('es-PE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'America/Lima',
  });
}

const MESES_LIMA = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

function limaCalendar(ms) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(ms));
  const get = (type) => parts.find((p) => p.type === type)?.value || '';
  const y = Number(get('year'));
  const m = Number(get('month'));
  const d = Number(get('day'));
  return { y, m, d, ymd: `${get('year')}-${get('month')}-${get('day')}` };
}

/** Hoy, Ayer, o «2 de julio 2000» en calendario Perú. */
function formatFechaRelativa(value) {
  if (value == null || value === '') return '—';
  const { toApiTimestamp } = require('./fechas');
  const ms = typeof value === 'number' ? value : toApiTimestamp(value);
  if (ms == null) return formatFecha(value);
  const day = limaCalendar(ms);
  const now = limaCalendar(Date.now());
  if (day.ymd === now.ymd) return 'Hoy';
  const ayer = limaCalendar(Date.UTC(now.y, now.m - 1, now.d - 1, 17, 0, 0));
  if (day.ymd === ayer.ymd) return 'Ayer';
  const mes = MESES_LIMA[day.m - 1] || '';
  return `${day.d} de ${mes} ${day.y}`;
}

/** Fecha + hora en calendario Perú (comprobantes emitidos). */
function formatFechaHora(value) {
  if (value == null || value === '') return '—';
  const { toApiTimestamp } = require('./fechas');
  const ms = typeof value === 'number' ? value : toApiTimestamp(value);
  if (ms == null) {
    const s = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
      const d = new Date(s);
      if (!Number.isNaN(d.getTime())) {
        return d.toLocaleString('es-PE', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hour12: true,
          timeZone: 'America/Lima',
        });
      }
    }
    return formatFecha(value);
  }
  return new Date(ms).toLocaleString('es-PE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/Lima',
  });
}

/** Códigos SUNAT / EMISOR de caída del servicio (no son errores de datos). */
const CODIGOS_FALLO_COMUNICACION_SUNAT = new Set([
  '0100', '100',
  '0109', '109',
  '0127', '127',
  '0133', '133',
  '1032', '1033',
]);

const TXT_FALLO_COMUNICACION_SUNAT = /timeout|timed?\s*out|econnrefused|etimedout|enotfound|econnreset|socket hang|no respond|sin respuesta|no se pudo conectar|error interno|soap|unavailable|service unavailable|\b502\b|\b503\b|\b504\b|fetch failed|emisor|revisar sunat|connection reset|network|eai_again/i;

/**
 * Borrador o rechazo porque SUNAT/EMISOR no contestó.
 * Los rechazos de negocio (3271, 2116, etc.) no entran.
 */
function puedeReenviarPorFalloSunat(row = {}) {
  const estado = String(row.estado || row.sunat_estado || '').toUpperCase();
  const tipo = String(row.tipo_doc || row.tipoDoc || '').padStart(2, '0');
  if (tipo && !['01', '03', '07', '08', '09', '31'].includes(tipo) && tipo !== '00') {
    return false;
  }
  if (estado === 'BORRADOR') return true;
  if (estado.indexOf('RECHAZ') < 0) return false;

  const codigo = String(row.sunat_codigo || row.sunatCodigo || row.sunatCodigoDirecto || '')
    .replace(/\D/g, '');
  const desc = [
    row.sunat_descripcion,
    row.sunatDescripcion,
    row.sunatDescripcionDirecto,
    row.observacion,
  ].filter(Boolean).join(' ');

  if (TXT_FALLO_COMUNICACION_SUNAT.test(desc)) return true;
  if (!codigo) return true;
  return CODIGOS_FALLO_COMUNICACION_SUNAT.has(codigo)
    || CODIGOS_FALLO_COMUNICACION_SUNAT.has(codigo.padStart(4, '0'));
}

/** GRE por evento rechazada por SUNAT: se corrige en el wizard y se reemite el mismo CPE. */
function puedeCorregirGreEvento(row = {}) {
  const estado = String(row.estado || row.sunat_estado || '').toUpperCase();
  if (estado.indexOf('RECHAZ') < 0) return false;
  return esGrePorEvento(row);
}

/** Factura o boleta rechazada por datos: abre el formulario y reemite el mismo número. */
function puedeCorregirVenta(row = {}) {
  if (puedeCorregirGreEvento(row)) return false;
  const estado = String(row.estado || row.sunat_estado || '').toUpperCase();
  if (estado.indexOf('RECHAZ') < 0) return false;
  const tipo = String(row.tipo_doc || row.tipoDoc || '').padStart(2, '0');
  return tipo === '01' || tipo === '03';
}

function urlCorregirVenta(row = {}) {
  if (!puedeCorregirVenta(row) || !row.id) return '';
  const tipo = String(row.tipo_doc || row.tipoDoc || '').padStart(2, '0');
  const key = tipo === '03' ? 'BOLETA' : 'FACTURA';
  return appPath(`/emitir/${key}?corregir=${encodeURIComponent(row.id)}`);
}

function mesActualRango() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const lastDay = new Date(y, now.getMonth() + 1, 0).getDate();
  return {
    desde: `${y}-${m}-01`,
    hasta: `${y}-${m}-${String(lastDay).padStart(2, '0')}`,
    periodo: `${y}${m}`,
  };
}

module.exports = {
  parseFlash,
  redirectWithFlash,
  isWebCompanyAdmin,
  navItemsForUser,
  layoutLocals,
  companyRucOf,
  formatMoney,
  labelTipoDoc,
  esGrePorEvento,
  labelTipoComprobante,
  formatDocRef,
  formatFecha,
  formatFechaRelativa,
  formatFechaHora,
  labelMotivoNota,
  puedeReenviarPorFalloSunat,
  puedeCorregirGreEvento,
  puedeCorregirVenta,
  urlCorregirVenta,
  mesActualRango,
  TIPO_DOC_LABEL,
};

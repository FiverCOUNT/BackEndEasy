/**
 * Cliente del servicio SUNAT Scraping (FastAPI en puerto 3001).
 * Descarga GRE recibidas (09 remitente, 31 transportista) vía portal SOL
 * (menú Guía → Consulta de GRE → GRE recibidas), no api-cpe.
 * Fechas: las envía el backend (`fecha_inicio` / `fecha_fin`); SUNAT máx. 30 días
 * inclusive por consulta (el scraper parte rangos más largos).
 */
const companyModel = require('../models/companyModel');
const { periodoYyyyMmToRangoIso } = require('../utils/fechas');

const DEFAULT_BASE_URL = 'http://localhost:3001';
const DEFAULT_TIMEOUT_MS = Number(process.env.GRE_SCRAPER_TIMEOUT_MS || 10 * 60 * 1000);
/** Límite SUNAT Consulta GRE (días inclusive). No usar 31. */
const MAX_DIAS_GRE = 30;

function getBaseUrl() {
  return String(process.env.GRE_SCRAPER_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

function toIsoDay(value) {
  const s = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const pe = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (pe) return `${pe[3]}-${pe[2].padStart(2, '0')}-${pe[1].padStart(2, '0')}`;
  return '';
}

/**
 * Resuelve rango desde options o periodo YYYYMM.
 * @returns {{ fecha_inicio: string, fecha_fin: string, periodo: string }}
 */
function resolverRangoFechas(periodo, options = {}) {
  const ini = toIsoDay(options.fecha_inicio || options.fechaInicio || options.desde);
  const fin = toIsoDay(options.fecha_fin || options.fechaFin || options.hasta);
  if (ini && fin) {
    if (fin < ini) {
      const err = new Error('fecha_fin no puede ser menor que fecha_inicio');
      err.status = 400;
      throw err;
    }
    return {
      fecha_inicio: ini,
      fecha_fin: fin,
      periodo: `${ini}_${fin}`,
    };
  }
  return periodoToScraperRango(periodo);
}

function periodoToScraperRango(periodo) {
  return periodoYyyyMmToRangoIso(periodo, { capHoy: true });
}

function diasInclusive(isoDesde, isoHasta) {
  const a = new Date(`${isoDesde}T12:00:00Z`).getTime();
  const b = new Date(`${isoHasta}T12:00:00Z`).getTime();
  return Math.floor((b - a) / 86400000) + 1;
}

/**
 * Parte un rango ISO en ventanas ≤ maxDias (inclusive).
 * Ej. agosto: 2026-08-01→08-30 y 2026-08-31→08-31.
 */
function partirRangoMaxDias(fechaInicio, fechaFin, maxDias = MAX_DIAS_GRE) {
  const ini = toIsoDay(fechaInicio);
  const fin = toIsoDay(fechaFin);
  if (!ini || !fin || fin < ini) return [];
  if (diasInclusive(ini, fin) <= maxDias) {
    return [{ fecha_inicio: ini, fecha_fin: fin }];
  }
  const out = [];
  let cur = ini;
  while (cur <= fin) {
    const [y, m, d] = cur.split('-').map(Number);
    const start = new Date(Date.UTC(y, m - 1, d));
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + maxDias - 1);
    const finVentana = end.toISOString().slice(0, 10);
    const hasta = finVentana < fin ? finVentana : fin;
    out.push({ fecha_inicio: cur, fecha_fin: hasta });
    const next = new Date(`${hasta}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    cur = next.toISOString().slice(0, 10);
  }
  return out;
}

/**
 * @param {{ ruc: string, solUser: string, solPass: string }} company
 * @param {string} periodo YYYYMM (si no vienen fechas explícitas)
 * @param {{ fecha_inicio?: string, fecha_fin?: string, desde?: string, hasta?: string }} [options]
 */
async function descargarGuiasPeriodo(company, periodo, options = {}) {
  if (!company?.solUser || !company?.solPass) {
    const err = new Error('Faltan usuario/clave SOL en la empresa para descargar GRE vía scraping.');
    err.status = 400;
    throw err;
  }

  const rango = resolverRangoFechas(periodo, options);
  const ventanas = partirRangoMaxDias(rango.fecha_inicio, rango.fecha_fin, MAX_DIAS_GRE);
  if (!ventanas.length) {
    const err = new Error('Rango de fechas GRE inválido.');
    err.status = 400;
    throw err;
  }

  const agregados = {
    ok: true,
    mensaje: '',
    periodo: rango.periodo,
    fecha_desde: rango.fecha_inicio,
    fecha_hasta: rango.fecha_fin,
    via: null,
    total: 0,
    guias: [],
    errores: [],
    detalle: null,
    ventanas: ventanas.length,
  };
  const vistos = new Set();

  for (const ventana of ventanas) {
    let parte;
    try {
      parte = await descargarGuiasRango(company, ventana.fecha_inicio, ventana.fecha_fin, {
        tipos: options.tipos,
      });
    } catch (err) {
      agregados.ok = false;
      agregados.errores.push({
        tipo: 'ventana',
        error: `${ventana.fecha_inicio}→${ventana.fecha_fin}: ${err.message || err}`,
      });
      continue;
    }
    agregados.via = parte.via || agregados.via;
    if (parte.ok && parte.mensaje) agregados.mensaje = parte.mensaje;
    if (parte.detalle) agregados.detalle = parte.detalle;
    if (!parte.ok) {
      agregados.ok = false;
      if (parte.mensaje) agregados.mensaje = parte.mensaje;
    }
    for (const e of parte.errores || []) agregados.errores.push(e);
    for (const g of parte.guias || []) {
      const key = [
        String(g.ruc_emisor || g.emisor?.ruc || '').replace(/\D/g, ''),
        String(g.cod_cpe || g.tipo || '').padStart(2, '0'),
        String(g.serie || '').toUpperCase(),
        String(g.numero || g.correlativo || '').replace(/\D/g, ''),
      ].join('|');
      if (vistos.has(key)) continue;
      vistos.add(key);
      agregados.guias.push(g);
    }
  }

  agregados.total = agregados.guias.length;
  if (agregados.total > 0) {
    agregados.mensaje = `Se encontraron ${agregados.total} GRE (${rango.fecha_inicio} → ${rango.fecha_fin})`;
  } else if (!agregados.mensaje) {
    agregados.mensaje = `Se encontraron ${agregados.total} GRE (${rango.fecha_inicio} → ${rango.fecha_fin})`;
  }
  return agregados;
}

async function descargarGuiasRango(company, fechaInicio, fechaFin, options = {}) {
  const url = `${getBaseUrl()}/guias`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const body = {
      ruc: company.ruc,
      usuario: company.solUser,
      clave: company.solPass,
      fecha_inicio: fechaInicio,
      fecha_fin: fechaFin,
    };
    if (Array.isArray(options.tipos) && options.tipos.length) {
      body.tipos = options.tipos.map((t) => String(t).padStart(2, '0'));
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { ok: false, mensaje: text || 'Respuesta no JSON del scraper GRE' };
    }

    if (res.status === 409) {
      const err = new Error(data?.detail || 'El scraper GRE ya tiene otra descarga en curso.');
      err.status = 409;
      throw err;
    }

    if (!res.ok && !data?.ok) {
      const err = new Error(data?.mensaje || data?.detail || `Scraper GRE respondió HTTP ${res.status}`);
      err.status = res.status >= 400 && res.status < 600 ? res.status : 502;
      err.scraper = data;
      throw err;
    }

    return {
      ok: Boolean(data?.ok),
      mensaje: data?.mensaje || '',
      periodo: data?.periodo || `${fechaInicio}_${fechaFin}`,
      fecha_desde: data?.fecha_desde || fechaInicio,
      fecha_hasta: data?.fecha_hasta || fechaFin,
      via: data?.via || null,
      total: data?.total ?? (Array.isArray(data?.guias) ? data.guias.length : 0),
      guias: Array.isArray(data?.guias) ? data.guias : [],
      errores: Array.isArray(data?.errores) ? data.errores : [],
      detalle: data?.detalle || null,
    };
  } catch (err) {
    if (err.name === 'AbortError') {
      const timeoutErr = new Error(
        `Scraper GRE no respondió a tiempo (${Math.round(DEFAULT_TIMEOUT_MS / 1000)}s). `
          + 'La descarga por portal SOL puede tardar varios minutos.',
      );
      timeoutErr.status = 504;
      throw timeoutErr;
    }
    if (err.cause?.code === 'ECONNREFUSED' || /fetch failed/i.test(err.message)) {
      const connErr = new Error(
        `No se pudo conectar al scraper GRE en ${getBaseUrl()}. `
          + 'Verifica que el servicio en el puerto 3001 esté en ejecución.',
      );
      connErr.status = 503;
      throw connErr;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** GRE - Remitente → 09, GRE - Transportista → 31 */
function tipoDocFromGuiaRow(guia) {
  const cod = String(guia?.cod_cpe || guia?.raw?.codCpe || '').padStart(2, '0');
  if (cod === '09' || cod === '31') return cod;
  const raw = String(guia?.tipo_gre || guia?.tipoGre || '').toLowerCase();
  if (raw.includes('transportista')) return '31';
  if (raw.includes('remitente')) return '09';
  return null;
}

function parseNumeracionGre(numeracion) {
  const raw = String(numeracion || '').trim().toUpperCase();
  if (!raw.includes('-')) return { serie: '', correlativo: '' };
  const idx = raw.indexOf('-');
  const serie = raw.slice(0, idx).trim();
  const correlativo = raw.slice(idx + 1).replace(/\D/g, '').replace(/^0+/, '') || '0';
  return { serie, correlativo };
}

async function ensureCompany(ruc) {
  const company = await companyModel.findByRuc(ruc);
  if (!company) {
    const err = new Error('Empresa no encontrada.');
    err.status = 404;
    throw err;
  }
  return company;
}

function periodoFromFechaEmision(fechaRaw) {
  const v = String(fechaRaw || '').trim();
  let y = '';
  let m = '';
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) {
    [y, m] = v.slice(0, 10).split('-');
  } else if (/^\d{2}\/\d{2}\/\d{4}$/.test(v)) {
    const parts = v.split('/');
    y = parts[2];
    m = parts[1];
  }
  if (y && m) return `${y}${m.padStart(2, '0')}`;
  const now = new Date();
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function guiaCoincideParams(guia, params) {
  const emisor = String(params.emisor_ruc || params.emisorRuc || '').replace(/\D/g, '');
  const serie = String(params.serie || '').trim().toUpperCase();
  const correlativo = String(params.correlativo || params.numero || '').replace(/\D/g, '')
    .replace(/^0+/, '') || '0';
  const tipoDoc = String(params.tipo_doc || params.tipoDoc || '').padStart(2, '0');

  const guiaSerie = String(guia?.serie || parseNumeracionGre(guia?.numeracion).serie || '')
    .trim()
    .toUpperCase();
  const guiaCorr = String(guia?.numero ?? parseNumeracionGre(guia?.numeracion).correlativo)
    .replace(/\D/g, '')
    .replace(/^0+/, '') || '0';
  const guiaEmisor = String(
    guia?.ruc_emisor || guia?.emisor?.ruc || guia?.raw?.rucEmisor || '',
  ).replace(/\D/g, '');
  const guiaTipo = String(guia?.cod_cpe || tipoDocFromGuiaRow(guia) || '').padStart(2, '0');

  if (emisor && guiaEmisor && emisor !== guiaEmisor) return false;
  if (serie && guiaSerie && serie !== guiaSerie) return false;
  if (correlativo && guiaCorr && correlativo !== guiaCorr) return false;
  if (tipoDoc && guiaTipo && tipoDoc !== guiaTipo && tipoDoc !== '01') return false;
  return Boolean(guia?.xml_base64);
}

/**
 * Busca una GRE concreta en el scraper (rango acotado a la fecha de emisión).
 * @returns {Promise<{ xml: string|null, pdf: null, guia: object|null }>}
 */
async function descargarGreDocumento(company, params = {}) {
  const dia = toIsoDay(params.fecha_emision || params.fechaEmision
    || params.fecha_inicio || params.fechaInicio);
  const periodo = periodoFromFechaEmision(params.fecha_emision || params.fechaEmision);
  const fechaOpts = dia
    ? { fecha_inicio: dia, fecha_fin: dia }
    : {
      fecha_inicio: params.fecha_inicio || params.fechaInicio || params.desde,
      fecha_fin: params.fecha_fin || params.fechaFin || params.hasta,
    };
  const resultado = await descargarGuiasPeriodo(company, periodo, fechaOpts);
  const guia = (resultado.guias || []).find((row) => guiaCoincideParams(row, params)) || null;
  if (!guia?.xml_base64) {
    return { xml: null, pdf: null, guia: null };
  }
  const xml = Buffer.from(String(guia.xml_base64).replace(/\s/g, ''), 'base64').toString('utf8');
  let pdf = null;
  if (guia.pdf_base64 || guia.pdfBase64) {
    try {
      const buf = Buffer.from(String(guia.pdf_base64 || guia.pdfBase64).replace(/\s/g, ''), 'base64');
      if (buf.length) pdf = buf;
    } catch {
      pdf = null;
    }
  }
  return { xml: xml.startsWith('<') ? xml : null, pdf, guia };
}

module.exports = {
  descargarGuiasPeriodo,
  descargarGreDocumento,
  tipoDocFromGuiaRow,
  parseNumeracionGre,
  periodoFromFechaEmision,
  partirRangoMaxDias,
  MAX_DIAS_GRE,
  getBaseUrl,
  ensureCompany,
};

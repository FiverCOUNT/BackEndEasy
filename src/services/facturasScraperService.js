/**
 * Cliente del servicio SUNAT Scraping (FastAPI :3001).
 * FE Recibidas: login SOL → token api-cpe → listado por fechas + XML.
 */
const companyModel = require('../models/companyModel');

const DEFAULT_BASE_URL = 'http://localhost:3001';
const DEFAULT_TIMEOUT_MS = Number(process.env.FACTURAS_SCRAPER_TIMEOUT_MS || process.env.GRE_SCRAPER_TIMEOUT_MS || 15 * 60 * 1000);

function getBaseUrl() {
  return String(process.env.GRE_SCRAPER_URL || process.env.FACTURAS_SCRAPER_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

function periodoToScraperMes(periodo) {
  const digits = String(periodo || '').replace(/\D/g, '');
  if (!/^\d{6}$/.test(digits)) {
    const err = new Error('periodo inválido (usa YYYYMM).');
    err.status = 400;
    throw err;
  }
  const anio = Number(digits.slice(0, 4));
  const mes = Number(digits.slice(4, 6));
  return { anio, mes: `${anio}-${String(mes).padStart(2, '0')}` };
}

/**
 * @param {{ ruc: string, solUser: string, solPass: string }} company
 * @param {string} periodo YYYYMM
 * @param {{ comprobantes?: Array<object> }} [options]
 */
async function descargarFacturasPeriodo(company, periodo, options = {}) {
  if (!company?.solUser || !company?.solPass) {
    const err = new Error('Faltan usuario/clave SOL en la empresa para descargar facturas vía scraping.');
    err.status = 400;
    throw err;
  }

  const { anio, mes } = periodoToScraperMes(periodo);
  const url = `${getBaseUrl()}/facturas`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  const body = {
    ruc: company.ruc,
    usuario: company.solUser,
    clave: company.solPass,
    mes,
    anio,
  };
  if (Array.isArray(options.comprobantes)) {
    body.comprobantes = options.comprobantes;
  }
  if (Array.isArray(options.consultas) && options.consultas.length) {
    body.consultas = options.consultas.map(String);
  }
  if (Array.isArray(options.tipos) && options.tipos.length) {
    body.tipos = options.tipos.map((t) => String(t).padStart(2, '0'));
  }

  try {
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
      data = { ok: false, mensaje: text || 'Respuesta no JSON del scraper facturas' };
    }

    if (res.status === 409) {
      const err = new Error(data?.detail || 'El scraper ya tiene otra descarga en curso.');
      err.status = 409;
      throw err;
    }

    if (!res.ok && !data?.ok) {
      const err = new Error(data?.mensaje || data?.detail || `Scraper facturas respondió HTTP ${res.status}`);
      err.status = res.status >= 400 && res.status < 600 ? res.status : 502;
      err.scraper = data;
      throw err;
    }

    return {
      ok: Boolean(data?.ok),
      mensaje: data?.mensaje || '',
      periodo: data?.periodo || mes,
      total: data?.consultados ?? (Array.isArray(data?.facturas) ? data.facturas.length : 0),
      facturas: Array.isArray(data?.facturas) ? data.facturas : [],
      errores: Array.isArray(data?.errores) ? data.errores : [],
    };
  } catch (err) {
    if (err.name === 'AbortError') {
      const timeoutErr = new Error(
        `Scraper facturas no respondió a tiempo (${Math.round(DEFAULT_TIMEOUT_MS / 1000)}s).`,
      );
      timeoutErr.status = 504;
      throw timeoutErr;
    }
    if (err.cause?.code === 'ECONNREFUSED' || /fetch failed/i.test(err.message)) {
      const connErr = new Error(
        `No se pudo conectar al scraper en ${getBaseUrl()}. Verifica que el servicio :3001 esté en ejecución.`,
      );
      connErr.status = 503;
      throw connErr;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
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

module.exports = {
  descargarFacturasPeriodo,
  getBaseUrl,
  ensureCompany,
  periodoToScraperMes,
};

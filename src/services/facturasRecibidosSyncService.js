/**
 * Importa facturas/boletas recibidas (01/03) y notas (07/08) a tabla `compras`
 * vía scraper SOL (:3001) con XML e ítems UBL.
 */
const companyModel = require('../models/companyModel');
const compraModel = require('../models/compraModel');
const facturasScraperService = require('./facturasScraperService');
const { registrarInvoiceRecibido } = require('./ssppReceptorService');
const { periodoYyyyMmToRangoIso } = require('../utils/fechas');
const {
  facturaJsonToParsed,
  facturaAplicaParaReceptor,
  decodeXmlFromFactura,
  TIPOS_SOPORTADOS,
} = require('./facturaScraperMapper');

const TIPOS_FACTURAS = new Set(['01', '03', '07', '08']);
const TIPOS_GRE = new Set(['09', '31']);
/** Orden UI: FACT → BOL → NC → ND (luego GRE/GRT en otro paso). */
const ORDEN_TIPO_FACTURA = { '01': 1, '03': 2, '07': 3, '08': 4 };

function ordenTipoFactura(tipo) {
  const t = String(tipo || '01').padStart(2, '0');
  return ORDEN_TIPO_FACTURA[t] || 99;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function sortComprobantesScraper(lista) {
  return [...(lista || [])].sort((a, b) => {
    const oa = ordenTipoFactura(a.tipo || a.tipoDoc);
    const ob = ordenTipoFactura(b.tipo || b.tipoDoc);
    if (oa !== ob) return oa - ob;
    const sa = String(a.serie || '').toUpperCase();
    const sb = String(b.serie || '').toUpperCase();
    if (sa !== sb) return sa.localeCompare(sb);
    const ca = compraModel.normalizeCorrelativoCompra(a.numero ?? a.correlativo);
    const cb = compraModel.normalizeCorrelativoCompra(b.numero ?? b.correlativo);
    return Number(ca) - Number(cb);
  });
}

function claveComprobanteScraper(c) {
  const emisor = String(c.ruc_emisor || c.proveedorNumeroDoc || '').replace(/\D/g, '');
  const tipo = String(c.tipo || c.tipoDoc || '01').padStart(2, '0');
  const serie = String(c.serie || '').trim().toUpperCase();
  const correlativo = compraModel.normalizeCorrelativoCompra(c.numero ?? c.correlativo);
  return `${emisor}|${tipo}|${serie}|${correlativo}`;
}

function claveDesdeCompraApi(row) {
  return claveComprobanteScraper({
    ruc_emisor: row.proveedor?.ruc,
    tipo: row.tipo_doc,
    serie: row.serie,
    numero: row.correlativo,
  });
}

function compraTieneDetalleUtil(row) {
  const lineas = Array.isArray(row.details) ? row.details : [];
  if (!lineas.length) return false;
  if (lineas.length === 1) {
    const d = String(lineas[0]?.descripcion || lineas[0]?.nombre || '');
    if (/^(Compra|Servicio|GRE)\s*·/i.test(d)) return false;
  }
  return true;
}

/** Claves de comprobantes del periodo que ya tienen XML (+ detalle útil). */
async function clavesCompletasEnPeriodo(companyRuc, periodo, tipos = TIPOS_FACTURAS) {
  const { desde, hasta } = periodoRango(periodo);
  const rows = await compraModel.listByCompany(companyRuc, { desde, hasta });
  const set = new Set();
  for (const row of rows) {
    const tipo = String(row.tipo_doc || '').padStart(2, '0');
    if (!tipos.has(tipo)) continue;
    if (!row.xml_url) continue;
    if (!compraTieneDetalleUtil(row) && TIPOS_FACTURAS.has(tipo)) continue;
    set.add(claveDesdeCompraApi(row));
  }
  return set;
}

/** Solo comprobantes que aún no están completos en BD (re-sync rápido). */
async function comprobantesPendientesScraper(companyRuc, periodo, filasSire = null) {
  const completas = await clavesCompletasEnPeriodo(companyRuc, periodo, TIPOS_FACTURAS);
  let candidatos = [];
  if (Array.isArray(filasSire) && filasSire.length) {
    candidatos = comprobantesFacturasDesdeFilasSire(filasSire);
  } else {
    candidatos = await comprobantesDesdeComprasPeriodo(companyRuc, periodo);
  }
  return candidatos.filter((c) => !completas.has(claveComprobanteScraper(c)));
}

async function necesitaGreScraper(companyRuc, periodo) {
  const { desde, hasta } = periodoRango(periodo);
  const rows = await compraModel.listByCompany(companyRuc, { desde, hasta });
  const gres = rows.filter((r) => TIPOS_GRE.has(String(r.tipo_doc || '').padStart(2, '0')));
  if (!gres.length) return true;
  return gres.some((g) => !g.xml_url);
}

function normalizePeriodo(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (/^\d{6}$/.test(digits)) return digits;
  if (/^\d{4}-\d{2}/.test(String(raw))) {
    return String(raw).slice(0, 7).replace('-', '');
  }
  return null;
}

function periodoRango(periodo) {
  const { desde, hasta } = periodoYyyyMmToRangoIso(periodo, { capHoy: false });
  return { desde, hasta };
}

/** true si fecha_emision del scraper cae en el YYYYMM pedido. */
function facturaEnPeriodo(factura, periodo) {
  const raw = String(factura?.fecha_emision || factura?.fechaEmision || '').trim();
  if (!raw) return true;
  let ymd = '';
  const pe = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (pe) {
    ymd = `${pe[3]}-${pe[2].padStart(2, '0')}-${pe[1].padStart(2, '0')}`;
  } else if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    ymd = raw.slice(0, 10);
  }
  if (!ymd) return true;
  const { desde, hasta } = periodoRango(periodo);
  return ymd >= String(desde).slice(0, 10) && ymd <= String(hasta).slice(0, 10);
}

function toFechaScraper(value) {
  if (!value) return null;
  const s = String(value);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return s;
}

function compraAComprobanteScraper(compra) {
  return {
    ruc_emisor: compra.proveedorNumeroDoc,
    serie: compra.serie,
    numero: compra.correlativo,
    tipo: compra.tipoDoc,
    fecha_emision: toFechaScraper(compra.fechaEmision),
    importe_total: compra.mtoImpVenta,
    razon_social: compra.proveedorRazonSocial,
  };
}

function filaSireAComprobanteScraper(fila) {
  return {
    ruc_emisor: fila.emisorRuc,
    serie: fila.serie,
    numero: fila.correlativo,
    tipo: fila.tipoDoc,
    fecha_emision: fila.fechaEmision,
    importe_total: fila.mtoImpVenta,
    razon_social: fila.emisorRazonSocial,
  };
}

function comprobantesFacturasDesdeFilasSire(filas) {
  if (!Array.isArray(filas)) return [];
  return filas
    .filter((f) => TIPOS_FACTURAS.has(String(f.tipoDoc || '').padStart(2, '0')))
    .map(filaSireAComprobanteScraper);
}

/** Compras sin XML (01/03/07/08) → lista para scraper FE Recibidas. */
async function comprobantesDesdeComprasPeriodo(companyRuc, periodo) {
  const compraModel = require('../models/compraModel');
  const rows = await compraModel.listSinXml(companyRuc, { take: 200 });
  return rows
    .filter((r) => TIPOS_FACTURAS.has(String(r.tipoDoc || '').padStart(2, '0')))
    .map(compraAComprobanteScraper);
}

async function importarFacturasDesdeScraper(companyRuc, options = {}) {
  const company = await companyModel.findByRuc(companyRuc);
  if (!company) {
    const err = new Error('Empresa no encontrada.');
    err.status = 404;
    throw err;
  }

  const periodo = normalizePeriodo(options.periodo);
  if (!periodo) {
    const err = new Error('periodo inválido (usa YYYYMM).');
    err.status = 400;
    throw err;
  }

  const apiBaseUrl = options.apiBaseUrl || null;
  const forzarUnoPorUno = options.unoPorUno === true
    || (Array.isArray(options.comprobantes) && options.comprobantes.length > 0);
  const tiposFiltro = Array.isArray(options.tipos)
    ? options.tipos.map((t) => String(t).padStart(2, '0')).filter((t) => TIPOS_FACTURAS.has(t))
    : null;
  const consultas = Array.isArray(options.consultas) ? options.consultas.map(String) : undefined;

  // Modo preferido: 1 llamada al scraper (login + token + listado por fechas + XML).
  if (!forzarUnoPorUno) {
    const out = {
      fuente: 'facturas_scraper',
      scraper_url: facturasScraperService.getBaseUrl(),
      periodo,
      mensaje: '',
      omitido: false,
      comprobantes_enviados: 0,
      total_scraper: 0,
      candidatos: 0,
      omitidas_no_aplican: 0,
      creados: 0,
      enriquecidos: 0,
      duplicados: 0,
      sin_xml: 0,
      con_lineas: 0,
      fallidos: 0,
      errores: [],
      modo: 'periodo_completo',
      tipos: tiposFiltro || [...TIPOS_FACTURAS],
    };

    try {
      const scraper = await facturasScraperService.descargarFacturasPeriodo(company, periodo, {
        consultas,
        tipos: tiposFiltro || undefined,
      });
      out.mensaje = scraper.mensaje || '';
      out.total_scraper = scraper.facturas.length;

      const tiposClave = tiposFiltro?.length ? new Set(tiposFiltro) : TIPOS_FACTURAS;
      const completas = await clavesCompletasEnPeriodo(company.ruc, periodo, tiposClave);
      const facturas = sortComprobantesScraper(scraper.facturas || []);

      if (!facturas.length) {
        out.omitido = true;
        out.mensaje = out.mensaje || 'Sin facturas recibidas en el periodo (scraper).';
        return out;
      }

      for (const factura of facturas) {
        const tipo = String(factura?.tipo || '01').padStart(2, '0');
        if (!TIPOS_SOPORTADOS.has(tipo)) continue;
        if (tiposFiltro?.length && !tiposFiltro.includes(tipo)) continue;
        if (!facturaEnPeriodo(factura, periodo)) continue;

        const doc = `${factura.serie || ''}-${factura.numero || ''}`.trim();
        const clave = claveComprobanteScraper(factura);
        if (completas.has(clave)) {
          out.duplicados += 1;
          continue;
        }

        if (!facturaAplicaParaReceptor(factura, company.ruc)) {
          out.omitidas_no_aplican += 1;
          continue;
        }

        out.candidatos += 1;
        try {
          const xml = decodeXmlFromFactura(factura);
          const parsed = facturaJsonToParsed(factura, company, xml);
          if (!xml) out.sin_xml += 1;
          if (parsed.lineas?.length) out.con_lineas += 1;

          const result = await registrarInvoiceRecibido(company, parsed, {
            fuente: 'facturas_scraper',
            reemplazarResumen: true,
            xml: xml || null,
            pdfBuffer: null,
            apiBaseUrl,
          });

          if (result.creado) out.creados += 1;
          else if (result.enriquecido) out.enriquecidos += 1;
          else out.duplicados += 1;
        } catch (err) {
          out.fallidos += 1;
          out.errores.push({ doc: doc || '—', message: err.message });
        }
      }

      if (Array.isArray(scraper.errores)) {
        for (const e of scraper.errores) out.errores.push(e);
      }
      if (!out.mensaje) {
        out.mensaje = `Periodo ${periodo}: ${out.creados} creados, ${out.enriquecidos} enriquecidos`;
      }
      return out;
    } catch (err) {
      // Si falla el listado masivo, no fingir “ya descargadas”: reportar el error.
      if (err.status === 409) throw err;
      out.errores.push({ doc: 'periodo', message: err.message });
      out.mensaje = `Listado masivo falló: ${err.message}`;
      out.fallidos += 1;
      // Sin filas SIRE ni compras previas, el modo uno-por-uno no tiene candidatos.
      // Re-lanzar para que el sync muestre el error real.
      const err2 = new Error(out.mensaje);
      err2.status = err.status || 502;
      err2.cause = err;
      throw err2;
    }
  }

  const filasSire = options.filasSire || null;
  const comprobantesRaw = Array.isArray(options.comprobantes) && options.comprobantes.length
    ? options.comprobantes
    : await comprobantesPendientesScraper(company.ruc, periodo, filasSire);
  const comprobantes = sortComprobantesScraper(comprobantesRaw);

  const out = {
    fuente: 'facturas_scraper',
    scraper_url: facturasScraperService.getBaseUrl(),
    periodo,
    mensaje: '',
    omitido: false,
    comprobantes_enviados: comprobantes.length,
    total_scraper: 0,
    candidatos: 0,
    omitidas_no_aplican: 0,
    creados: 0,
    enriquecidos: 0,
    duplicados: 0,
    sin_xml: 0,
    con_lineas: 0,
    fallidos: 0,
    errores: [],
    modo: 'uno_por_uno',
  };

  if (!comprobantes.length) {
    out.omitido = true;
    out.mensaje = 'No hay candidatos pendientes (base vacía o sin XML pendiente). Usa sync de periodo completo.';
    return out;
  }

  const mensajes = [];
  for (let i = 0; i < comprobantes.length; i += 1) {
    const comp = comprobantes[i];
    const docLabel = `${comp.serie || ''}-${comp.numero || comp.correlativo || ''}`.trim();
    try {
      const scraper = await facturasScraperService.descargarFacturasPeriodo(company, periodo, {
        comprobantes: [comp],
      });
      if (scraper.mensaje) mensajes.push(scraper.mensaje);
      out.total_scraper += scraper.facturas.length;

      const facturas = scraper.facturas.length ? scraper.facturas : [];

      if (!facturas.length) {
        out.fallidos += 1;
        out.errores.push({
          doc: docLabel || '—',
          message: 'Scraper no devolvió el comprobante',
        });
      }

      for (const factura of facturas) {
        const tipo = String(factura?.tipo || comp.tipo || '01').padStart(2, '0');
        if (!TIPOS_SOPORTADOS.has(tipo)) continue;

        const doc = `${factura.serie || comp.serie || ''}-${factura.numero || comp.numero || ''}`.trim();

        if (!facturaAplicaParaReceptor(factura, company.ruc)) {
          out.omitidas_no_aplican += 1;
          continue;
        }

        out.candidatos += 1;

        try {
          const xml = decodeXmlFromFactura(factura);
          const parsed = facturaJsonToParsed(factura, company, xml);

          if (!xml) out.sin_xml += 1;
          if (parsed.lineas?.length) out.con_lineas += 1;

          const result = await registrarInvoiceRecibido(company, parsed, {
            fuente: 'facturas_scraper',
            reemplazarResumen: true,
            xml: xml || null,
            pdfBuffer: null,
            apiBaseUrl,
          });

          if (result.creado) out.creados += 1;
          else if (result.enriquecido) out.enriquecidos += 1;
          else out.duplicados += 1;
        } catch (err) {
          out.fallidos += 1;
          out.errores.push({
            doc: doc || docLabel || '—',
            message: err.message,
          });
        }
      }

      if (Array.isArray(scraper.errores)) {
        for (const e of scraper.errores) out.errores.push(e);
      }
    } catch (err) {
      out.fallidos += 1;
      out.errores.push({
        doc: docLabel || '—',
        message: err.message,
      });
      if (err.status === 409) await sleep(2500);
    }

    if (i < comprobantes.length - 1) await sleep(400);
  }

  out.mensaje = mensajes.filter(Boolean).slice(-3).join(' · ')
    || `Procesados ${comprobantes.length} comprobante(s) uno por uno`;

  return out;
}

module.exports = {
  importarFacturasDesdeScraper,
  normalizePeriodo,
  comprobantesDesdeComprasPeriodo,
  comprobantesPendientesScraper,
  comprobantesFacturasDesdeFilasSire,
  necesitaGreScraper,
  filaSireAComprobanteScraper,
  compraAComprobanteScraper,
};

/**
 * Importa GRE recibidas (09 remitente, 31 transportista) a tabla `compras`.
 * Fuentes:
 *  - Scraper SOL (:3001): GRE que otros emitieron hacia tu RUC → compras + XML en R2
 *  - Plataforma demo: GRE de otras empresas donde tú eres destinatario/transportista (no tus emitidos)
 */
const prisma = require('../config/prisma');
const companyModel = require('../models/companyModel');
const compraModel = require('../models/compraModel');
const comprobanteModel = require('../models/comprobanteModel');
const { registrarInvoiceRecibido } = require('./ssppReceptorService');
const greScraperService = require('./greScraperService');
const {
  guiaJsonToParsed,
  guiaAplicaParaReceptor,
  esGreEmitidaPorMi,
  decodeXmlFromGuia,
  decodePdfFromGuia,
} = require('./guiaScraperMapper');
const {
  calendarDayStartMsPe,
  calendarDayEndMsPe,
  parseStoredTimestamp,
  toApiTimestamp,
  periodoYyyyMmToRangoIso,
} = require('../utils/fechas');

const GRE_TIPOS = new Set(['09', '31']);

function normalizePeriodo(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (/^\d{6}$/.test(digits)) return digits;
  if (/^\d{4}-\d{2}/.test(String(raw))) {
    return String(raw).slice(0, 7).replace('-', '');
  }
  return null;
}

function periodoToRango(periodo) {
  const p = normalizePeriodo(periodo);
  if (!p) return { desde: null, hasta: null };
  const { desde, hasta } = periodoYyyyMmToRangoIso(p, { capHoy: false });
  return { desde, hasta };
}

function invoiceEnRangoFecha(invoice, desde, hasta) {
  if (!desde && !hasta) return true;
  const ms = parseStoredTimestamp(invoice.fechaEmision);
  if (ms == null) return true;
  const desdeMs = desde ? calendarDayStartMsPe(desde) : null;
  const hastaMs = hasta ? calendarDayEndMsPe(hasta) : null;
  if (desdeMs != null && ms < desdeMs) return false;
  if (hastaMs != null && ms > hastaMs) return false;
  return true;
}

/**
 * Stub creado solo para la FK de documentos relacionados (`line_invoice_invoice`).
 * Su `cliente` es el RUC que emitió la GRE que lo referencia, no el destinatario real.
 */
function esStubGre(invoice) {
  return /^Stub GRE/i.test(String(invoice?.observacion || '').trim());
}

function partesDesdeGuiaMeta(invoice) {
  const meta = invoice?.guiaMetaJson && typeof invoice.guiaMetaJson === 'object'
    ? invoice.guiaMetaJson
    : {};
  const dig = (v) => String(v || '').replace(/\D/g, '');
  return {
    destinatario: dig(meta.destinatario?.numero_doc),
    transportista: dig(
      meta.envio?.transportista?.numero_doc || meta.envio?.transportista?.num_doc,
    ),
    remitente: dig(meta.remitente?.numero_doc),
  };
}

/** Destinatario, transportista (GRE-R) o remitente (GRE-T). */
function invoiceGreAplicaComoRecibido(invoice, receptorRuc) {
  const target = String(receptorRuc || '').replace(/\D/g, '');
  if (!target || !invoice) return false;
  const emisor = String(invoice.companyRuc || '').replace(/\D/g, '');
  if (emisor && emisor === target) return false;
  const tipo = String(invoice.tipoDoc || '').padStart(2, '0');
  if (!GRE_TIPOS.has(tipo)) return false;
  // Un stub no acredita ningún rol: la GRE real llega por el scraper con su XML.
  if (esStubGre(invoice)) return false;
  const clienteDoc = String(invoice.cliente?.numeroDoc || '').replace(/\D/g, '');
  if (clienteDoc === target) return true;
  return comprobanteModel.invoiceGreIncluyeRuc(invoice, target);
}

function rolRecibidoGre(invoice, receptorRuc) {
  const target = String(receptorRuc || '').replace(/\D/g, '');
  const tipo = String(invoice.tipoDoc || '').padStart(2, '0');
  const partes = partesDesdeGuiaMeta(invoice);

  // guia_meta (partes del UBL) manda sobre el `cliente` del invoice.
  if (partes.destinatario.length === 11) {
    if (partes.destinatario === target) return 'DESTINATARIO';
    if (partes.transportista === target) return 'TRANSPORTISTA';
    if (tipo === '31' && partes.remitente === target) return 'REMITENTE';
    return 'RECIBIDO';
  }
  if (esStubGre(invoice)) {
    return partes.transportista === target ? 'TRANSPORTISTA' : 'RECIBIDO';
  }

  const clienteDoc = String(invoice.cliente?.numeroDoc || '').replace(/\D/g, '');
  if (clienteDoc === target) return 'DESTINATARIO';
  if (tipo === '09' && comprobanteModel.invoiceGreIncluyeRuc(invoice, target)) return 'TRANSPORTISTA';
  if (tipo === '31' && comprobanteModel.invoiceGreIncluyeRuc(invoice, target)) return 'REMITENTE';
  return 'RECIBIDO';
}

function lineasFromInvoiceDetails(invoice) {
  return (invoice.details || [])
    .map((d) => ({
      descripcion: String(d.descripcion || d.nombre || '').trim(),
      nombre: String(d.nombre || d.descripcion || '').trim(),
      cantidad: Number(d.cantidad) || 0,
      unidad: String(d.unidad || 'NIU').trim() || 'NIU',
      precio_unitario: Number(d.mtoPrecioUnitario ?? d.mtoValorUnitario) || 0,
      codigo: d.codigo || undefined,
      codigo_sunat: d.codigoSunat || undefined,
      tip_afe_igv: d.tipAfeIgv || '30',
    }))
    .filter((l) => l.descripcion && l.cantidad > 0);
}

function buildGuiaMetaFromInvoice(invoice, receptorRuc) {
  const base = invoice.guiaMetaJson && typeof invoice.guiaMetaJson === 'object'
    ? JSON.parse(JSON.stringify(invoice.guiaMetaJson))
    : {};
  const tipo = String(invoice.tipoDoc || '').padStart(2, '0');
  const rol = rolRecibidoGre(invoice, receptorRuc);
  base.rol_recibido = rol;
  const yo = String(receptorRuc || '').replace(/\D/g, '');
  const destExistente = String(base.destinatario?.numero_doc || '').replace(/\D/g, '');
  const clienteDoc = String(invoice.cliente?.numeroDoc || '').replace(/\D/g, '');
  const transp = String(
    base.envio?.transportista?.numero_doc
      || base.envio?.transportista?.num_doc
      || '',
  ).replace(/\D/g, '');

  if (tipo === '31' && base.remitente) {
    // ok
  } else if (esStubGre(invoice)) {
    // El `cliente` del stub es quien lo referenció, no el destinatario del UBL.
    if (destExistente !== yo) {
      // conservar lo que ya haya (o nada)
    } else {
      delete base.destinatario;
    }
  } else if (tipo === '09') {
    // Nunca poner como destinatario al RUC que importa (p. ej. transportista stub).
    if (destExistente.length === 11 && destExistente !== yo) {
      // conservar
    } else if (clienteDoc.length === 11 && clienteDoc !== yo) {
      base.destinatario = {
        tipo_doc: invoice.cliente.tipoDoc || '6',
        numero_doc: invoice.cliente.numeroDoc,
        razon_social: invoice.cliente.razonSocial,
      };
    } else if (transp === yo && destExistente === yo) {
      delete base.destinatario;
    }
  }
  if (invoice.observacion && !base.nota_importacion) {
    base.nota_importacion = String(invoice.observacion).slice(0, 500);
  }
  return base;
}

function invoiceToParsedRecibido(invoice, receptorCompany, sellerCompany) {
  const emisorRuc = String(invoice.companyRuc || '').replace(/\D/g, '');
  const lineas = lineasFromInvoiceDetails(invoice);
  const tipo = String(invoice.tipoDoc || '').padStart(2, '0');
  const proveedorNombre = sellerCompany?.nombreComercial
    || sellerCompany?.nombre
    || emisorRuc;
  const docRef = `${invoice.serie}-${invoice.correlativo}`;
  const esGre = GRE_TIPOS.has(tipo);
  const etiquetaTipo = tipo === '09' ? 'GRE remitente' : 'GRE transportista';
  const guiaMeta = buildGuiaMetaFromInvoice(invoice, receptorCompany.ruc);
  const destDoc = String(guiaMeta.destinatario?.numero_doc || '').replace(/\D/g, '');
  const destNombre = guiaMeta.destinatario?.razon_social || destDoc;

  return {
    tipo_doc: tipo,
    serie: invoice.serie,
    correlativo: String(invoice.correlativo),
    fecha_emision: toApiTimestamp(invoice.fechaEmision) || invoice.fechaEmision,
    tipo_moneda: invoice.tipoMoneda || 'PEN',
    proveedor: {
      tipo_doc: '6',
      numero_doc: emisorRuc,
      razon_social: proveedorNombre,
    },
    // Destinatario real de la GRE (no el RUC de quien importa como transportista).
    receptor: destDoc.length === 11
      ? { tipo_doc: '6', numero_doc: destDoc, razon_social: destNombre }
      : { numero_doc: receptorCompany.ruc },
    sub_total: esGre ? 0 : (Number(invoice.subTotal) || null),
    mto_igv: esGre ? 0 : (Number(invoice.mtoIgv) || null),
    mto_imp_venta: esGre ? 0 : (Number(invoice.mtoImpVenta) || null),
    guia_meta: guiaMeta,
    lineas: lineas.length > 0
      ? lineas
      : [{
          nombre: `${etiquetaTipo} · ${proveedorNombre}`.slice(0, 255),
          descripcion: `${etiquetaTipo} ${docRef}`.slice(0, 500),
          cantidad: 1,
          unidad: 'NIU',
          precio_unitario: 0,
          codigo: `GRE-${emisorRuc}-${invoice.serie}-${invoice.correlativo}`.slice(0, 64),
        }],
  };
}

async function buscarGreInvoicesParaReceptor(receptorRuc) {
  const ruc = String(receptorRuc || '').trim();
  if (!ruc) return [];

    const [asDestinatario, greCandidatas] = await Promise.all([
    prisma.invoice.findMany({
      where: {
        companyRuc: { not: ruc },
        cliente: { numeroDoc: ruc },
        estado: { in: ['ACEPTADO', 'ENVIADO'] },
        tipoDoc: { in: ['09', '31'] },
      },
      include: comprobanteModel.INVOICE_INCLUDE,
    }),
    prisma.invoice.findMany({
      where: {
        companyRuc: { not: ruc },
        tipoDoc: { in: ['09', '31'] },
        estado: { in: ['ACEPTADO', 'ENVIADO'] },
        NOT: { cliente: { numeroDoc: ruc } },
      },
      include: comprobanteModel.INVOICE_INCLUDE,
    }),
  ]);

  const byId = new Map();
  for (const row of asDestinatario) {
    if (invoiceGreAplicaComoRecibido(row, ruc)) byId.set(row.id, row);
  }
  for (const row of greCandidatas) {
    if (esStubGre(row)) continue;
    if (comprobanteModel.invoiceGreIncluyeRuc(row, ruc)) byId.set(row.id, row);
  }
  return [...byId.values()];
}

/**
 * @deprecated Ya no se importan GRE demo desde invoices de la plataforma.
 * Solo se sincronizan GRE reales vía scraper SOL (`importarGreDesdeScraper`).
 */
async function importarGreRecibidasDesdeInvoices(_companyRuc, _options = {}) {
  return {
    candidatos: 0,
    creados: 0,
    enriquecidos: 0,
    duplicados: 0,
    gre_r: 0,
    gre_t: 0,
    errores: [],
    omitido: true,
    mensaje: 'Importar GRE demo desde plataforma deshabilitado.',
  };
}

/**
 * Importa GRE recibidas del periodo vía scraper SOL (POST /guias) → tabla `compras`.
 * Solo guías que otros emitieron hacia tu RUC. Las que tú emites no se importan aquí.
 * Fechas: `fecha_inicio` / `fecha_fin` (o periodo YYYYMM). SUNAT máx. 30 días inclusive;
 * el cliente scraper parte rangos más largos (p. ej. agosto → 01–30 + 31).
 */
async function importarGreDesdeScraper(companyRuc, options = {}) {
  const company = await companyModel.findByRuc(companyRuc);
  if (!company) {
    const err = new Error('Empresa no encontrada.');
    err.status = 404;
    throw err;
  }

  const periodo = normalizePeriodo(options.periodo);
  const tieneFechas = Boolean(
    options.fecha_inicio || options.fechaInicio || options.desde
      || options.fecha_fin || options.fechaFin || options.hasta,
  );
  if (!periodo && !tieneFechas) {
    const err = new Error('periodo inválido (usa YYYYMM) o envía fecha_inicio/fecha_fin.');
    err.status = 400;
    throw err;
  }

  const apiBaseUrl = options.apiBaseUrl || null;
  const fechaOpts = {
    fecha_inicio: options.fecha_inicio || options.fechaInicio || options.desde,
    fecha_fin: options.fecha_fin || options.fechaFin || options.hasta,
  };
  // Si solo viene periodo, el scraper convierte a fechas y parte en ventanas ≤30 días.
  const scraper = await greScraperService.descargarGuiasPeriodo(
    company,
    periodo || null,
    {
      ...fechaOpts,
      tipos: Array.isArray(options.tipos) ? options.tipos : undefined,
    },
  );

  const out = {
    fuente: 'gre_scraper',
    scraper_url: greScraperService.getBaseUrl(),
    periodo: scraper.periodo || periodo,
    fecha_desde: scraper.fecha_desde || null,
    fecha_hasta: scraper.fecha_hasta || null,
    ventanas: scraper.ventanas || 1,
    mensaje: scraper.mensaje,
    total_scraper: scraper.guias.length,
    candidatos: 0,
    omitidas_emitidas: 0,
    omitidas_no_aplican: 0,
    omitidas_duplicadas_lote: 0,
    creados: 0,
    enriquecidos: 0,
    duplicados: 0,
    sin_xml: 0,
    gre_r: 0,
    gre_t: 0,
    fallidos: 0,
    errores: [],
    modo: 'uno_por_uno',
  };

  // Dedup + orden GRE (09) → GRT (31), luego serie/número (como chips de la app).
  const vistos = new Set();
  const guiasOrdenadas = [...(scraper.guias || [])]
    .map((guia) => {
      const tipo = String(
        guia.cod_cpe || greScraperService.tipoDocFromGuiaRow(guia) || '09',
      ).padStart(2, '0');
      const num = String(guia.numeracion || `${guia.serie || ''}-${guia.numero || ''}`).trim();
      const parsedNum = greScraperService.parseNumeracionGre(num);
      const serie = String(guia.serie || parsedNum.serie || '').trim().toUpperCase();
      const correlativo = compraModel.normalizeCorrelativoCompra(
        guia.numero ?? parsedNum.correlativo,
      );
      const emisor = String(
        guia.ruc_emisor || guia.emisor?.ruc || guia.raw?.rucEmisor || '',
      ).replace(/\D/g, '');
      return {
        guia,
        tipo,
        serie,
        correlativo,
        emisor,
        clave: `${emisor}|${tipo}|${serie}|${correlativo}`,
        numSort: Number(correlativo) || 0,
      };
    })
    .sort((a, b) => {
      const oa = a.tipo === '09' ? 1 : (a.tipo === '31' ? 2 : 9);
      const ob = b.tipo === '09' ? 1 : (b.tipo === '31' ? 2 : 9);
      if (oa !== ob) return oa - ob;
      if (a.serie !== b.serie) return a.serie.localeCompare(b.serie);
      return a.numSort - b.numSort;
    });

  for (const item of guiasOrdenadas) {
    const { guia, clave, tipo } = item;
    const numeracion = String(guia.numeracion || `${guia.serie || ''}-${guia.numero || ''}`).trim();

    if (Array.isArray(options.tipos) && options.tipos.length) {
      const allow = options.tipos.map((t) => String(t).padStart(2, '0'));
      if (!allow.includes(tipo)) continue;
    }

    if (vistos.has(clave)) {
      out.omitidas_duplicadas_lote += 1;
      continue;
    }
    vistos.add(clave);

    if (esGreEmitidaPorMi(guia, company.ruc)) {
      out.omitidas_emitidas += 1;
      continue;
    }

    if (!guiaAplicaParaReceptor(guia, company.ruc)) {
      out.omitidas_no_aplican += 1;
      continue;
    }

    out.candidatos += 1;

    try {
      const xml = decodeXmlFromGuia(guia);
      const pdfBuffer = decodePdfFromGuia(guia);
      const parsed = guiaJsonToParsed(guia, company, xml);

      if (!xml) {
        out.sin_xml += 1;
        out.errores.push({
          doc: numeracion || '—',
          message: 'Sin XML en respuesta del scraper (no se sube a R2)',
        });
      }

      const result = await registrarInvoiceRecibido(company, parsed, {
        fuente: 'gre_scraper',
        reemplazarResumen: true,
        xml: xml || null,
        pdfBuffer: pdfBuffer || null,
        forcePdf: Boolean(pdfBuffer),
        apiBaseUrl,
      });

      if (result.creado) out.creados += 1;
      else if (result.enriquecido) out.enriquecidos += 1;
      else out.duplicados += 1;
      if (tipo === '09' || parsed.tipo_doc === '09') out.gre_r += 1;
      if (tipo === '31' || parsed.tipo_doc === '31') out.gre_t += 1;
    } catch (err) {
      out.fallidos += 1;
      out.errores.push({
        doc: numeracion || '—',
        message: err.message,
      });
    }
  }

  if (scraper.errores?.length) {
    for (const e of scraper.errores) {
      out.errores.push({
        doc: e.tipo || 'scraper',
        message: e.error || JSON.stringify(e),
      });
    }
  }

  return out;
}

/** @deprecated Usar importarGreDesdeScraper */
async function enriquecerGreEnCompras(company, periodo, apiBaseUrl = null) {
  return importarGreDesdeScraper(company.ruc, { periodo, apiBaseUrl });
}

module.exports = {
  importarGreRecibidasDesdeInvoices,
  importarGreDesdeScraper,
  enriquecerGreEnCompras,
  invoiceGreAplicaComoRecibido,
  normalizePeriodo,
};

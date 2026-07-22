const { randomUUID } = require('crypto');
const prisma = require('../config/prisma');
const clienteModel = require('./clienteModel');
const companyModel = require('./companyModel');
const productoSerieModel = require('./productoSerieModel');
const comprobanteArchivosService = require('../services/comprobanteArchivosService');
const comprobantePdfService = require('../services/comprobantePdfService');
const {
  loadSalidasPorComprobanteIds,
  loadEntradasPorReferenciaIds,
} = require('../services/comprobanteInventarioService');
const {
  toApiTimestamp,
  compareStoredTimestamps,
  toStoredTimestamp,
  parseStoredTimestamp,
  calendarDayStartMsPe,
  calendarDayEndMsPe,
} = require('../utils/fechas');
const {
  resolveTipoConfig: resolveTipoConfigFromSeries,
  formatCorrelativo,
  parseCorrelativoNumber,
} = require('../utils/seriesConfig');

const IGV_RATE = 0.18;

const TIPO_DOC_LABEL = {
  '01': 'Factura',
  '03': 'Boleta',
  '07': 'Nota crédito',
  '08': 'Nota débito',
  '09': 'Guía remisión',
  '31': 'Guía remisión transportista',
};

const TIPO_CONFIG = {
  FACTURA: { tipoDoc: '01', serie: 'F001' },
  BOLETA: { tipoDoc: '03', serie: 'B001' },
  NOTA_CREDITO: { tipoDoc: '07', serie: 'FC01' },
  NOTA_DEBITO: { tipoDoc: '08', serie: 'FD01' },
  GUIA_EMISION: { tipoDoc: '09', serie: 'T001' },
  GUIA_TRANSPORTISTA: { tipoDoc: '31', serie: 'V001' },
};

const COD_TO_TIPO = {
  '01': 'FACTURA',
  '03': 'BOLETA',
  '07': 'NOTA_CREDITO',
  '08': 'NOTA_DEBITO',
  '09': 'GUIA_EMISION',
  '31': 'GUIA_TRANSPORTISTA',
};

const DETAIL_INCLUDE = {
  include: { catalogItem: true, productoSerie: true },
};

const INVOICE_INCLUDE = {
  cliente: {
    include: { address: true },
  },
  details: DETAIL_INCLUDE,
  legends: true,
  documentoAfectado: {
    select: { id: true, tipoDoc: true, serie: true, correlativo: true },
  },
  lineInvoices: {
    orderBy: { orden: 'asc' },
    include: {
      invoice2: {
        select: {
          id: true,
          companyRuc: true,
          tipoDoc: true,
          serie: true,
          correlativo: true,
        },
      },
    },
  },
};

/** Filas de documentos relacionados vía line_invoice_invoice. */
function documentosRelacionadosRows(invoice) {
  const lines = invoice?.lineInvoices || [];
  return lines
    .map((line, idx) => {
      const inv = line?.invoice2;
      if (!inv) return null;
      return {
        invoiceRelacionadoId: inv.id,
        tipoDoc: inv.tipoDoc,
        serie: inv.serie,
        correlativo: inv.correlativo,
        emisorTipoDoc: '6',
        emisorNumeroDoc: inv.companyRuc,
        emisorRazonSocial: null,
        orden: line.orden ?? idx,
      };
    })
    .filter(Boolean);
}

async function syncDocumentosRelacionados(tx, invoiceId, docs) {
  await tx.lineInvoiceInvoice.deleteMany({ where: { invoiceId } });
  if (!Array.isArray(docs) || !docs.length) return;

  for (let i = 0; i < docs.length; i += 1) {
    const doc = docs[i];
    const invoice2Id = String(doc.invoiceRelacionadoId || doc.invoice2Id || '').trim();
    if (!invoice2Id || invoice2Id === invoiceId) continue;

    await tx.lineInvoiceInvoice.create({
      data: {
        id: doc.id || randomUUID(),
        invoiceId,
        invoice2Id,
        orden: doc.orden ?? i,
      },
    });
  }
}

function round4(value) {
  return Math.round(Number(value) * 10000) / 10000;
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function resolveTipoConfig(tipoRaw, company = null) {
  return resolveTipoConfigFromSeries(tipoRaw, company);
}

function parseRemitente(body) {
  const remitente = body.remitente;
  if (!remitente || typeof remitente !== 'object') {
    throw new Error('remitente es obligatorio para GRE transportista.');
  }
  const tipoDoc = String(remitente.tipo_doc || remitente.tipoDoc || '6').trim();
  const numeroDoc = String(
    remitente.numero_doc || remitente.numeroDoc || remitente.ruc || '',
  ).trim();
  const razonSocial = String(
    remitente.razon_social || remitente.razonSocial || remitente.nombre || '',
  ).trim();
  if (!numeroDoc) throw new Error('remitente.numero_doc es obligatorio.');
  if (!razonSocial) throw new Error('remitente.razon_social es obligatorio.');
  const digits = numeroDoc.replace(/\D/g, '');
  return { tipoDoc, numeroDoc: digits || numeroDoc, razonSocial };
}

function parseGuiaRemitenteRef(body) {
  const ref = body.guia_remitente || body.guiaRemitente;
  if (!ref || typeof ref !== 'object') return null;
  const serie = String(ref.serie || '').trim();
  const correlativo = String(ref.correlativo || ref.numero || '').trim();
  if (!serie || !correlativo) return null;
  return {
    tipo_doc: String(ref.tipo_doc || ref.tipoDoc || '09').trim(),
    serie,
    correlativo,
    id: String(ref.id || '').trim() || null,
    emisor_tipo_doc: ref.emisor_tipo_doc || ref.emisorTipoDoc || null,
    emisor_numero_doc: ref.emisor_numero_doc || ref.emisorNumeroDoc || ref.emisor || null,
    emisor_razon_social: ref.emisor_razon_social || ref.emisorRazonSocial || null,
  };
}

function parseDocumentosRelacionadosBody(body) {
  const raw = body.documentos_relacionados
    || body.documentosRelacionados
    || body.facturas
    || body.facturasVinculadas
    || [];
  return Array.isArray(raw) ? raw.filter((ref) => ref && typeof ref === 'object') : [];
}

/** Normaliza un ítem de adjunto a { url, nombre, content_type, size }. */
function normalizeAdjuntoItem(a) {
  if (!a || typeof a !== 'object') return null;
  const key = String(a.key || a.archivo_key || a.archivoKey || '').trim();
  const url = String(a.url || a.archivo_url || a.archivoUrl || '').trim() || null;
  const nombre = String(a.nombre || a.name || a.filename || '').trim() || null;
  const contentType = String(a.content_type || a.contentType || a.mime || '').trim() || null;
  const size = Number(a.size);
  if (!key && !url) return null;
  return {
    url: url || undefined,
    nombre: nombre || undefined,
    content_type: contentType || undefined,
    size: Number.isFinite(size) && size > 0 ? size : undefined,
    ...(key ? { key } : {}),
  };
}

/**
 * Columna única `archivos`: mapa clave → valor para editar/eliminar después.
 * Acepta body.archivos (objeto) o body.adjuntos (array u objeto).
 * Clave = key R2 (o id estable). null = no viene en el body.
 */
function parseArchivosBody(body) {
  const raw =
    body.archivos !== undefined
      ? body.archivos
      : body.adjuntos !== undefined
        ? body.adjuntos
        : body.attachments !== undefined
          ? body.attachments
          : undefined;
  if (raw === undefined) return null;
  if (raw === null) return {};

  const map = {};
  if (Array.isArray(raw)) {
    for (const a of raw) {
      const item = normalizeAdjuntoItem(a);
      if (!item) continue;
      const id = String(item.key || '').trim() || randomUUID();
      map[id] = {
        url: item.url,
        nombre: item.nombre,
        content_type: item.content_type,
        size: item.size,
      };
    }
    return map;
  }
  if (typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw)) {
      if (v == null) continue;
      if (typeof v === 'string') {
        const id = String(k).trim();
        if (!id) continue;
        map[id] = v.startsWith('http')
          ? { url: v }
          : { key: v };
        continue;
      }
      const item = normalizeAdjuntoItem(typeof v === 'object' ? { key: k, ...v } : null);
      if (!item) continue;
      const id = String(k || item.key || '').trim() || randomUUID();
      map[id] = {
        url: item.url,
        nombre: item.nombre,
        content_type: item.content_type,
        size: item.size,
      };
    }
    return map;
  }
  return {};
}

/** Lee `archivos` (mapa o array legacy) → lista para API móvil. */
function archivosJsonToAdjuntosList(archivosJson) {
  if (!archivosJson) return undefined;
  if (Array.isArray(archivosJson)) {
    const list = archivosJson.map(normalizeAdjuntoItem).filter(Boolean);
    return list.length ? list.map((a) => ({
      key: a.key || '',
      url: a.url,
      nombre: a.nombre,
      content_type: a.content_type,
      size: a.size,
    })) : undefined;
  }
  if (typeof archivosJson !== 'object') return undefined;
  // Legacy CPE (xml/pdf/cdr): no son adjuntos de usuario.
  if (archivosJson.xml || archivosJson.pdf || archivosJson.cdr_zip || archivosJson.cdr) {
    return undefined;
  }
  const list = [];
  for (const [k, v] of Object.entries(archivosJson)) {
    if (v == null) continue;
    if (typeof v === 'string') {
      list.push({
        key: k,
        url: v.startsWith('http') ? v : undefined,
        nombre: k.substring(k.lastIndexOf('/') + 1) || k,
      });
      continue;
    }
    if (typeof v !== 'object') continue;
    const item = normalizeAdjuntoItem({ key: v.key || k, ...v });
    if (!item) continue;
    list.push({
      key: item.key || k,
      url: item.url,
      nombre: item.nombre,
      content_type: item.content_type,
      size: item.size,
    });
  }
  return list.length ? list : undefined;
}

function extractEmisorFromRef(ref, fallback = {}) {
  const emisorObj = ref.emisor && typeof ref.emisor === 'object' ? ref.emisor : null;
  const companyObj = ref.company && typeof ref.company === 'object' ? ref.company : null;
  const tipoDoc = String(
    ref.emisor_tipo_doc
    || ref.emisorTipoDoc
    || emisorObj?.tipo_doc
    || emisorObj?.tipoDoc
    || companyObj?.tipo_doc
    || companyObj?.tipoDoc
    || fallback.tipoDoc
    || '6',
  ).trim() || '6';
  const numeroDoc = String(
    ref.emisor_numero_doc
    || ref.emisorNumeroDoc
    || ref.emisor
    || emisorObj?.numero_doc
    || emisorObj?.numeroDoc
    || emisorObj?.ruc
    || emisorObj?.num_doc
    || companyObj?.numero_doc
    || companyObj?.numeroDoc
    || companyObj?.ruc
    || fallback.numeroDoc
    || '',
  ).replace(/\D/g, '');
  const razonSocial = String(
    ref.emisor_razon_social
    || ref.emisorRazonSocial
    || emisorObj?.razon_social
    || emisorObj?.razonSocial
    || emisorObj?.nombre
    || companyObj?.razon_social
    || companyObj?.razonSocial
    || companyObj?.nombre
    || fallback.razonSocial
    || '',
  ).trim() || null;
  return { tipoDoc, numeroDoc, razonSocial };
}

/**
 * Resuelve refs del body a filas line_invoice_invoice.
 * El CPE debe existir como invoice (emitido o recibido). Si es compra externa
 * (emisor ≠ nosotros) y aún no está, se registra un stub recibido mínimo.
 */
async function resolveDocumentosRelacionados(companyRuc, company, refs, receptorFallback = null) {
  if (!Array.isArray(refs) || refs.length === 0) {
    return { docs: [], invoicesInternas: [] };
  }

  const docs = [];
  const invoicesInternas = [];
  const companyFallback = {
    tipoDoc: '6',
    numeroDoc: company?.ruc || companyRuc,
    razonSocial: company?.nombre || null,
  };

  for (let i = 0; i < refs.length; i += 1) {
    const ref = refs[i];
    let linked = await loadFacturaReferencia(companyRuc, ref);
    if (!linked) {
      linked = await ensureInvoiceRecibidoDesdeRef(company, ref, receptorFallback);
    }
    if (!linked) {
      const serie = String(ref.serie || '').trim();
      const correlativo = String(ref.correlativo || ref.numero || '').trim();
      const etiqueta = ref.id || `${serie}-${correlativo}` || 'desconocido';
      throw new Error(
        `Documento relacionado no encontrado en invoices (${etiqueta}). `
          + 'Debe ser un CPE emitido por tu empresa o una compra recibida (con emisor RUC).',
      );
    }

    const explicit = extractEmisorFromRef(ref, {});
    const emisor = explicit.numeroDoc
      ? explicit
      : {
          tipoDoc: '6',
          numeroDoc: linked.companyRuc,
          razonSocial: companyFallback.razonSocial,
        };

    docs.push({
      id: randomUUID(),
      tipoDoc: linked.tipoDoc,
      serie: linked.serie,
      correlativo: String(linked.correlativo),
      emisorTipoDoc: emisor.tipoDoc,
      emisorNumeroDoc: emisor.numeroDoc || linked.companyRuc,
      emisorRazonSocial: emisor.razonSocial,
      invoiceRelacionadoId: linked.id,
      orden: i,
    });
    invoicesInternas.push(linked);
  }

  return { docs, invoicesInternas };
}

/**
 * Stub mínimo de compra recibida: company_ruc=emisor, cliente=nosotros.
 * Sirve para GRE motivo compra con serie manual sin romper emisor/series.
 */
async function ensureInvoiceRecibidoDesdeRef(receptorCompany, ref, receptorFallback = null) {
  const receptorRuc = String(receptorCompany?.ruc || '').replace(/\D/g, '');
  const serie = String(ref.serie || '').trim().toUpperCase();
  let correlativo = String(ref.correlativo || ref.numero || '').trim();
  if (correlativo.includes('-') && !serie) {
    const parts = correlativo.split('-');
    correlativo = parts[parts.length - 1];
  }
  correlativo = correlativo.replace(/\D/g, '') || correlativo;
  const tipoDoc = String(ref.tipo_doc || ref.tipoDoc || '01').trim() || '01';
  const emisor = extractEmisorFromRef(ref, receptorFallback || {});

  if (!receptorRuc || !serie || !correlativo || !emisor.numeroDoc) return null;
  if (emisor.numeroDoc === receptorRuc) return null;

  const emisorRuc = emisor.numeroDoc;
  const existente = await prisma.invoice.findFirst({
    where: {
      companyRuc: emisorRuc,
      tipoDoc,
      serie,
      correlativo,
    },
    include: {
      details: { include: { catalogItem: true } },
      cliente: true,
    },
  });
  if (existente) return existente;

  let seller = await prisma.company.findFirst({ where: { ruc: emisorRuc } });
  if (!seller) {
    seller = await prisma.company.create({
      data: {
        ruc: emisorRuc,
        nombre: (emisor.razonSocial || emisorRuc).slice(0, 255),
        tipoDoc: '6',
        numeroDoc: emisorRuc,
        entorno: 'prod',
        activo: false,
        isActive: false,
        tieneCertificado: false,
      },
    });
  }

  let cliente = await clienteModel.findByDocumento(emisorRuc, '6', receptorRuc);
  if (!cliente) {
    cliente = await clienteModel.create({
      companyRuc: emisorRuc,
      tipoDoc: '6',
      numeroDoc: receptorRuc,
      razonSocial: receptorCompany?.nombre || receptorRuc,
    });
  }

  const invoiceId = randomUUID();
  return prisma.invoice.create({
    data: {
      id: invoiceId,
      companyRuc: emisorRuc,
      tipoDoc,
      serie,
      correlativo,
      fechaEmision: toStoredTimestamp(),
      tipoMoneda: 'PEN',
      estado: 'ACEPTADO',
      sunatEstadoDirecto: 'ACEPTADA',
      observacion: `Stub GRE · receptor ${receptorRuc}`,
      clienteId: cliente.id,
    },
    include: {
      details: { include: { catalogItem: true } },
      cliente: true,
    },
  });
}

function toApiDocumentoRelacionado(row) {
  if (!row) return null;
  return {
    id: row.invoiceRelacionadoId || undefined,
    tipo_doc: row.tipoDoc,
    serie: row.serie,
    correlativo: row.correlativo,
    emisor_tipo_doc: row.emisorTipoDoc,
    emisor_numero_doc: row.emisorNumeroDoc,
    emisor_razon_social: row.emisorRazonSocial || undefined,
    invoice_relacionado_id: row.invoiceRelacionadoId || undefined,
  };
}

function parseReceptor(body) {
  const receptor = body.receptor || body.client || body.cliente;
  if (!receptor || typeof receptor !== 'object') {
    throw new Error('receptor es obligatorio.');
  }

  const tipoDoc = String(receptor.tipo_doc || receptor.tipoDoc || '1').trim();
  const numeroDoc = String(receptor.numero_doc || receptor.numeroDoc || receptor.ruc || '').trim();
  const razonSocial = String(
    receptor.razon_social || receptor.razonSocial || receptor.nombre || '',
  ).trim();

  if (!numeroDoc) throw new Error('receptor.numero_doc es obligatorio.');
  if (!razonSocial) throw new Error('receptor.razon_social es obligatorio.');

  return { tipoDoc, numeroDoc, razonSocial };
}

function validateReceptorForTipo(tipoDocComprobante, receptor) {
  const digits = String(receptor.numeroDoc || '').replace(/\D/g, '');

  if (tipoDocComprobante === '01') {
    if (digits.length !== 11) {
      throw new Error('Factura: el cliente debe tener un RUC de 11 dígitos.');
    }
    return { ...receptor, tipoDoc: '6', numeroDoc: digits };
  }

  if (tipoDocComprobante === '03' && receptor.tipoDoc === '1' && digits.length !== 8) {
    throw new Error('Boleta: el DNI del cliente debe tener 8 dígitos.');
  }

  return { ...receptor, numeroDoc: digits || receptor.numeroDoc };
}

function calcularLinea(catalogItem, cantidad, precioOverride = null) {
  const precioConIgv = precioOverride != null && precioOverride !== ''
    ? toNumber(precioOverride)
    : toNumber(catalogItem.precioUnitario);
  const afectacion = catalogItem.afectacionIgv || '10';
  const qty = toNumber(cantidad, 1);

  if (afectacion === '10') {
    const valorUnitario = round4(precioConIgv / (1 + IGV_RATE));
    const valorVenta = round4(valorUnitario * qty);
    const igv = round4(valorVenta * IGV_RATE);
    const total = round4(valorVenta + igv);

    return {
      descripcion: catalogItem.descripcion || catalogItem.nombre,
      nombre: catalogItem.nombre,
      cantidad: qty,
      unidad: catalogItem.unidad || 'NIU',
      mtoValorUnitario: valorUnitario,
      mtoPrecioUnitario: precioConIgv,
      mtoBaseIgv: valorVenta,
      mtoValorVenta: valorVenta,
      mtoIgv: igv,
      totalFactura: total,
      porcentajeIgv: 18,
      tipAfeIgv: afectacion,
    };
  }

  const valorVenta = round4(precioConIgv * qty);
  return {
    descripcion: catalogItem.descripcion || catalogItem.nombre,
    nombre: catalogItem.nombre,
    cantidad: qty,
    unidad: catalogItem.unidad || 'NIU',
    mtoValorUnitario: precioConIgv,
    mtoPrecioUnitario: precioConIgv,
    mtoBaseIgv: valorVenta,
    mtoValorVenta: valorVenta,
    mtoIgv: 0,
    totalFactura: valorVenta,
    porcentajeIgv: 0,
    tipAfeIgv: afectacion,
  };
}

function calcularTotales(details) {
  const gravadas = details
    .filter((d) => d.tipAfeIgv === '10')
    .reduce((sum, d) => sum + toNumber(d.mtoValorVenta), 0);
  const exoneradas = details
    .filter((d) => d.tipAfeIgv === '20')
    .reduce((sum, d) => sum + toNumber(d.mtoValorVenta), 0);
  const inafectas = details
    .filter((d) => !['10', '20'].includes(d.tipAfeIgv))
    .reduce((sum, d) => sum + toNumber(d.mtoValorVenta), 0);
  const igv = details.reduce((sum, d) => sum + toNumber(d.mtoIgv), 0);
  const valorVenta = gravadas + exoneradas + inafectas;
  const totalVentas = details.reduce((sum, d) => sum + toNumber(d.totalFactura), 0);

  return {
    mtoOperGravadas: round4(gravadas),
    mtoOperExoneradas: round4(exoneradas),
    mtoOperInafectas: round4(inafectas),
    mtoIgv: round4(igv),
    totalImpuestos: round4(igv),
    subTotal: round4(valorVenta),
    mtoImpVenta: round4(totalVentas),
  };
}

async function getNextCorrelativo(companyRuc, tipoDoc, serie, options = {}) {
  const inicio = Math.max(1, Number.parseInt(String(options.correlativoInicio ?? 1), 10) || 1);
  const digitos = Number.parseInt(String(options.correlativoDigitos ?? 8), 10) || 8;

  const last = await prisma.invoice.findFirst({
    where: { companyRuc, tipoDoc, serie },
    orderBy: { correlativo: 'desc' },
    select: { correlativo: true },
  });

  const current = last ? parseCorrelativoNumber(last.correlativo) : 0;
  const next = Math.max(inicio, (Number.isFinite(current) ? current : 0) + 1);
  return formatCorrelativo(next, digitos);
}

async function resolveClienteId(companyRuc, receptor) {
  const resolved = await clienteModel.resolveForSalida({
    companyRuc,
    clienteBody: {
      tipo_doc: receptor.tipoDoc,
      numero_doc: receptor.numeroDoc,
      razon_social: receptor.razonSocial,
    },
  });

  if (resolved.error === 'cliente_nombre_requerido') {
    throw new Error('receptor.razon_social es obligatorio.');
  }

  return resolved.clienteId;
}

async function loadFacturaReferencia(companyRuc, ref) {
  const receptorRuc = String(companyRuc || '').trim();
  const include = {
    details: { include: { catalogItem: true } },
    cliente: true,
  };

  const id = String(ref.id || ref.invoice_relacionado_id || ref.invoiceRelacionadoId || '').trim();
  if (id) {
    const byId = await prisma.invoice.findFirst({
      where: {
        id,
        OR: [
          { companyRuc: receptorRuc },
          { cliente: { numeroDoc: receptorRuc } },
        ],
      },
      include,
    });
    if (byId) return byId;
  }

  const serie = String(ref.serie || '').trim();
  let correlativo = String(ref.correlativo || ref.numero || '').trim();
  if (correlativo.includes('-')) {
    const parts = correlativo.split('-');
    correlativo = parts[parts.length - 1];
  }
  if (!serie || !correlativo) return null;

  const tipoDoc = String(ref.tipo_doc || ref.tipoDoc || '').trim() || undefined;
  const emisor = extractEmisorFromRef(ref, {});
  const emisorRuc = emisor.numeroDoc || null;

  // Recibido: company_ruc = emisor, cliente = nosotros.
  if (emisorRuc && emisorRuc !== receptorRuc) {
    const recibida = await prisma.invoice.findFirst({
      where: {
        companyRuc: emisorRuc,
        serie,
        correlativo,
        ...(tipoDoc ? { tipoDoc } : {}),
        cliente: { numeroDoc: receptorRuc },
      },
      include,
    });
    if (recibida) return recibida;
  }

  // Emitido por nosotros.
  return prisma.invoice.findFirst({
    where: {
      companyRuc: receptorRuc,
      serie,
      correlativo,
      ...(tipoDoc ? { tipoDoc } : {}),
    },
    include,
  });
}

function aggregateDetailsFromFacturas(facturas) {
  const aggregated = [];

  for (const factura of facturas) {
    for (const detail of factura.details || []) {
      aggregated.push({
        catalogItemId: detail.catalogItemId,
        descripcion: detail.descripcion || detail.nombre,
        nombre: detail.nombre,
        cantidad: toNumber(detail.cantidad, 1),
        unidad: detail.unidad || detail.catalogItem?.unidad || 'NIU',
        mtoPrecioUnitario: toNumber(detail.mtoPrecioUnitario),
        tipAfeIgv: detail.tipAfeIgv || '10',
        mtoValorVenta: toNumber(detail.mtoValorVenta),
        mtoIgv: toNumber(detail.mtoIgv),
        totalFactura: toNumber(detail.totalFactura),
        mtoValorUnitario: toNumber(detail.mtoValorUnitario),
        mtoBaseIgv: toNumber(detail.mtoBaseIgv),
        porcentajeIgv: toNumber(detail.porcentajeIgv, 18),
        productoSerieId: detail.productoSerieId,
        catalogItem: detail.catalogItem,
      });
    }
  }

  if (!aggregated.length) {
    throw new Error('Las facturas vinculadas no tienen líneas de detalle.');
  }

  return aggregated;
}

function normalizeFechaEnvio(value) {
  if (!value) return null;
  const normalized = String(value).trim().slice(0, 10);
  return normalized || null;
}

function resolveFechaInicioTrasladoEnvio(envioBody) {
  return normalizeFechaEnvio(
    envioBody.fecha_traslado
    || envioBody.fechaTraslado
    || envioBody.fecha_inicio_traslado
    || envioBody.fechaInicioTraslado
    || null,
  );
}

function resolveFechaEntregaTransportistaEnvio(envioBody, fechaInicioFallback = null) {
  return normalizeFechaEnvio(
    envioBody.fecha_entrega_transportista
    || envioBody.fechaEntregaTransportista
    || null,
  ) || fechaInicioFallback;
}

function buildEnvioMeta(body, company, cliente) {
  const envioBody = body.envio && typeof body.envio === 'object' ? body.envio : {};
  const fechaInicioTraslado = resolveFechaInicioTrasladoEnvio(envioBody)
    || resolveFechaEntregaTransportistaEnvio(envioBody);
  const fechaEntregaTransportista = resolveFechaEntregaTransportistaEnvio(
    envioBody,
    fechaInicioTraslado,
  );

  const envio = {
    cod_traslado: envioBody.cod_traslado || envioBody.codTraslado || '01',
    mod_traslado: envioBody.mod_traslado || envioBody.modTraslado || '02',
    fecha_traslado: fechaInicioTraslado,
    fecha_entrega_transportista: fechaEntregaTransportista,
    peso_total: envioBody.peso_total ?? envioBody.pesoTotal ?? null,
    und_peso_total: envioBody.und_peso_total || envioBody.undPesoTotal || 'KGM',
    partida: envioBody.partida || (company?.address
      ? { ubigeo: company.address.ubigeo, direccion: company.address.direccion }
      : undefined),
    llegada: envioBody.llegada || (cliente?.address
      ? { ubigeo: cliente.address.ubigeo, direccion: cliente.address.direccion }
      : undefined),
    transportista: envioBody.transportista || undefined,
    vehiculo: envioBody.vehiculo || undefined,
    conductor: envioBody.conductor || undefined,
    nro_mtc: envioBody.nro_mtc || envioBody.nroMtc || envioBody.transportista?.nro_mtc || undefined,
    registrar_vehiculos_conductores:
      envioBody.registrar_vehiculos_conductores
      ?? envioBody.registrarVehiculosConductores
      ?? undefined,
  };

  const movimientoId = body.movimiento_id || body.movimientoId || envioBody.movimiento_id || null;
  const almacenDestinoId = body.almacen_destino_id
    || body.almacenDestinoId
    || envioBody.almacen_destino_id
    || null;
  if (movimientoId) envio.movimiento_id = movimientoId;
  if (almacenDestinoId) envio.almacen_destino_id = almacenDestinoId;

  return { envio };
}

function mapLineasToSaleDetails(lineas, catalogMap) {
  const saleDetails = [];

  for (const linea of lineas) {
    const catalogItemId = String(linea.catalog_item_id || linea.catalogItemId || '').trim();
    const catalogItem = catalogMap.get(catalogItemId);
    const precioOverride = linea.precio_unitario ?? linea.precioUnitario ?? null;
    const cantidad = toNumber(linea.cantidad, 1);
    const legacyIds = linea.serie_ids || linea.serieIds || [];
    const productoSerieId = String(
      linea.producto_serie_id || linea.productoSerieId || legacyIds[0] || '',
    ).trim() || null;

    saleDetails.push({
      catalogItemId,
      productoSerieId,
      catalogItem,
      ...calcularLinea(catalogItem, cantidad, precioOverride),
    });
  }

  return saleDetails;
}

async function resolveDocumentoAfectadoId(companyRuc, documentoAfectado) {
  if (!documentoAfectado || typeof documentoAfectado !== 'object') {
    throw new Error('documento_afectado es obligatorio para notas.');
  }

  const id = String(documentoAfectado.id || '').trim();
  if (id) {
    const row = await prisma.invoice.findFirst({ where: { id, companyRuc } });
    if (!row) throw new Error('documento_afectado no encontrado.');
    return row.id;
  }

  const serie = String(documentoAfectado.serie || '').trim();
  const correlativo = String(documentoAfectado.correlativo || documentoAfectado.numero || '').trim();
  if (!serie || !correlativo) {
    throw new Error('documento_afectado requiere id o serie/correlativo.');
  }

  const row = await prisma.invoice.findFirst({
    where: { companyRuc, serie, correlativo },
  });
  if (!row) throw new Error('documento_afectado no encontrado.');
  return row.id;
}

function toSaleDetailCreateInput(detail) {
  const row = {
    descripcion: detail.descripcion,
    nombre: detail.nombre,
    cantidad: detail.cantidad,
    unidad: detail.unidad,
    mtoPrecioUnitario: detail.mtoPrecioUnitario,
    tipAfeIgv: detail.tipAfeIgv,
    mtoValorVenta: detail.mtoValorVenta,
    mtoIgv: detail.mtoIgv,
    totalFactura: detail.totalFactura,
    mtoValorUnitario: detail.mtoValorUnitario,
    mtoBaseIgv: detail.mtoBaseIgv,
    porcentajeIgv: detail.porcentajeIgv,
    estado: detail.estado || 'ACTIVO',
  };

  const catalogItemId = String(detail.catalogItemId || '').trim();
  if (catalogItemId) {
    row.catalogItem = { connect: { id: catalogItemId } };
  }

  const productoSerieId = String(detail.productoSerieId || '').trim();
  if (productoSerieId) {
    row.productoSerie = { connect: { id: productoSerieId } };
  }

  return row;
}

function buildLineasLimitePorDocumento(details) {
  const byCatalog = new Map();
  for (const detail of details || []) {
    if (detail.estado && detail.estado !== 'ACTIVO') continue;
    const catalogItemId = String(detail.catalogItemId || '').trim();
    if (!catalogItemId) continue;
    const cantidad = toNumber(detail.cantidad);
    const precio = toNumber(detail.mtoPrecioUnitario);
    const nombre = detail.nombre || detail.descripcion || catalogItemId;
    const prev = byCatalog.get(catalogItemId);
    if (prev) {
      prev.cantidad = round4(prev.cantidad + cantidad);
      prev.precioMax = Math.max(prev.precioMax, precio);
    } else {
      byCatalog.set(catalogItemId, { cantidad, precioMax: precio, nombre });
    }
  }
  return byCatalog;
}

const MOTIVOS_NC_DEVOLUCION = new Set(['01', '06', '07']);
const MOTIVOS_NC_ACREDITACION = new Set(['04', '05', '09']);

function estadoNotaCreditoParaLinea(motivoCodigo) {
  const cod = String(motivoCodigo || '').trim();
  if (MOTIVOS_NC_DEVOLUCION.has(cod)) return 'DEVUELTO';
  if (MOTIVOS_NC_ACREDITACION.has(cod)) return 'ACREDITADO';
  return null;
}

function labelEstadoLineaNoDisponible(estado) {
  if (estado === 'DEVUELTO') return 'ya fue devuelta en otra nota de crédito';
  if (estado === 'ACREDITADO') return 'ya fue acreditada en otra nota de crédito';
  return 'no está disponible para otra nota de crédito';
}

async function aplicarEstadoLineasDocumentoAfectadoNotaCredito(invoice, lineasBody) {
  const nuevoEstado = estadoNotaCreditoParaLinea(invoice.motivoCodigo);
  if (!nuevoEstado || !invoice.documentoAfectadoId) return;

  const doc = await prisma.invoice.findFirst({
    where: { id: invoice.documentoAfectadoId },
    include: { details: true },
  });
  if (!doc) return;

  const idsToUpdate = new Set();
  const bodyLineas = Array.isArray(lineasBody) ? lineasBody : [];
  const motivo = String(invoice.motivoCodigo || '').trim();

  if (motivo === '01' && bodyLineas.length === 0) {
    for (const detail of doc.details) {
      if (detail.estado === 'ACTIVO') idsToUpdate.add(detail.id);
    }
  } else {
    for (const linea of bodyLineas) {
      const saleDetailId = String(linea.sale_detail_id || linea.saleDetailId || '').trim();
      if (saleDetailId) {
        idsToUpdate.add(saleDetailId);
        continue;
      }
      const catalogItemId = String(linea.catalog_item_id || linea.catalogItemId || '').trim();
      if (!catalogItemId) continue;
      const match = doc.details.find(
        (d) => d.catalogItemId === catalogItemId && d.estado === 'ACTIVO',
      );
      if (match) idsToUpdate.add(match.id);
    }
  }

  if (idsToUpdate.size === 0) return;

  await prisma.saleDetail.updateMany({
    where: {
      id: { in: [...idsToUpdate] },
      invoiceId: invoice.documentoAfectadoId,
      estado: 'ACTIVO',
    },
    data: { estado: nuevoEstado },
  });
}

async function validateNotaCreditoLineas(companyRuc, documentoAfectadoId, saleDetails, lineasBody = []) {
  const doc = await prisma.invoice.findFirst({
    where: { id: documentoAfectadoId, companyRuc },
    include: { details: true },
  });
  if (!doc) throw new Error('documento_afectado no encontrado.');

  const limites = buildLineasLimitePorDocumento(doc.details);
  if (limites.size === 0) {
    throw new Error('El documento afectado no tiene líneas disponibles para acreditar.');
  }

  const acreditadas = new Map();
  const lineasPorSaleDetail = new Map();

  for (let i = 0; i < saleDetails.length; i += 1) {
    const detail = saleDetails[i];
    const lineaBody = lineasBody[i];
    const saleDetailId = String(lineaBody?.sale_detail_id || lineaBody?.saleDetailId || '').trim();

    if (saleDetailId) {
      const origen = doc.details.find((d) => d.id === saleDetailId);
      if (!origen) {
        throw new Error('La línea referenciada no pertenece al documento afectado.');
      }
      if (origen.estado !== 'ACTIVO') {
        throw new Error(
          `La línea "${origen.nombre || origen.descripcion || saleDetailId}" `
            + `${labelEstadoLineaNoDisponible(origen.estado)}.`,
        );
      }
      const cantidadAcreditar = toNumber(detail.cantidad);
      const prev = lineasPorSaleDetail.get(saleDetailId) || 0;
      lineasPorSaleDetail.set(saleDetailId, round4(prev + cantidadAcreditar));
      if (lineasPorSaleDetail.get(saleDetailId) > toNumber(origen.cantidad) + 0.0001) {
        throw new Error(
          `La cantidad a acreditar de "${origen.nombre || origen.descripcion}" `
            + `no puede superar la facturada (${toNumber(origen.cantidad)}).`,
        );
      }
      const precioOverride = lineaBody?.precio_unitario ?? lineaBody?.precioUnitario ?? null;
      if (precioOverride != null && precioOverride !== '') {
        if (toNumber(precioOverride) > toNumber(origen.mtoPrecioUnitario) + 0.009) {
          throw new Error(
            `El monto a acreditar de "${origen.nombre || origen.descripcion}" `
              + 'no puede superar el precio facturado.',
          );
        }
      }
      continue;
    }

    const catalogItemId = String(detail.catalogItemId || '').trim();
    if (!catalogItemId) {
      throw new Error('Cada línea de la nota de crédito debe referenciar un producto del documento afectado.');
    }

    const limite = limites.get(catalogItemId);
    if (!limite) {
      throw new Error(
        `El producto "${detail.nombre || catalogItemId}" no está disponible en el documento afectado. `
          + 'La nota de crédito solo puede incluir ítems activos de esa factura o boleta.',
      );
    }

    const prev = acreditadas.get(catalogItemId) || 0;
    acreditadas.set(catalogItemId, round4(prev + toNumber(detail.cantidad)));

    const precioOverride = lineaBody?.precio_unitario ?? lineaBody?.precioUnitario ?? null;
    if (precioOverride == null || precioOverride === '') continue;
    if (toNumber(precioOverride) > limite.precioMax + 0.009) {
      throw new Error(
        `El monto a acreditar de "${limite.nombre}" no puede superar el precio facturado.`,
      );
    }
  }

  for (const [catalogItemId, cantidadAcreditar] of acreditadas) {
    const limite = limites.get(catalogItemId);
    if (!limite) continue;
    if (cantidadAcreditar > limite.cantidad + 0.0001) {
      throw new Error(
        `La cantidad a acreditar de "${limite.nombre}" no puede superar la disponible (${limite.cantidad}).`,
      );
    }
  }
}

async function loadCatalogItems(companyRuc, lineas) {
  const ids = [
    ...new Set(
      lineas
        .map((l) => String(l.catalog_item_id || l.catalogItemId || '').trim())
        .filter(Boolean),
    ),
  ];
  if (ids.length === 0) return new Map();

  const items = await prisma.catalogItem.findMany({
    where: { companyRuc, id: { in: ids }, activo: true },
  });
  const map = new Map(items.map((item) => [item.id, item]));

  for (const id of ids) {
    if (!map.has(id)) throw new Error(`Producto de catálogo no encontrado: ${id}`);
  }

  return map;
}

/** Línea GRE sin catálogo (compra OCR / bienes libres). */
function saleDetailDesdeLineaLibre(linea, cantidad) {
  const descripcion = String(linea.descripcion || linea.nombre || '').trim();
  if (!descripcion) {
    throw new Error('Cada línea sin catálogo requiere descripción.');
  }
  return {
    catalogItemId: null,
    catalogItem: null,
    descripcion,
    nombre: descripcion,
    cantidad,
    unidad: String(linea.unidad || 'NIU').trim() || 'NIU',
    mtoValorUnitario: 0,
    mtoPrecioUnitario: 0,
    mtoBaseIgv: 0,
    mtoValorVenta: 0,
    mtoIgv: 0,
    totalFactura: 0,
    porcentajeIgv: 0,
    tipAfeIgv: '30',
    productoSerieId: linea.producto_serie_id || linea.productoSerieId || null,
  };
}

function toApiSaleDetail(detail) {
  const row = {
    id: detail.id,
    invoice_id: detail.invoiceId,
    catalog_item_id: detail.catalogItemId,
    descripcion: detail.descripcion,
    nombre: detail.nombre,
    cantidad: toNumber(detail.cantidad),
    unidad: detail.unidad,
    mto_precio_unitario: toNumber(detail.mtoPrecioUnitario),
    tip_afe_igv: detail.tipAfeIgv,
    mto_valor_venta: toNumber(detail.mtoValorVenta),
    mto_igv: toNumber(detail.mtoIgv),
    total: toNumber(detail.totalFactura),
    mto_valor_unitario: toNumber(detail.mtoValorUnitario),
    mto_base_igv: toNumber(detail.mtoBaseIgv),
    porcentaje_igv: toNumber(detail.porcentajeIgv),
    producto_serie_id: detail.productoSerieId,
    estado: detail.estado || 'ACTIVO',
  };
  if (detail.productoSerie) {
    row.producto_serie = productoSerieModel.toApi(detail.productoSerie);
  }
  const codigoDetalle = String(detail.codigo || '').trim();
  const codigoSunatDetalle = String(detail.codigoSunat || detail.codigo_sunat || '').trim();
  const cat = detail.catalogItem;
  const codigoCat = cat ? String(cat.codigo || '').trim() : '';
  const codigoSunatCat = cat
    ? String(cat.codigoSunat || cat.codigo_sunat || '').trim()
    : '';
  const codigo = codigoDetalle || codigoCat;
  const codigoSunat = codigoSunatDetalle || codigoSunatCat;
  if (codigo) row.codigo = codigo;
  if (codigoSunat) row.codigo_sunat = codigoSunat;
  return row;
}

function formatMoney(value) {
  if (value == null) return '—';
  const n = Number(value);
  if (Number.isNaN(n)) return '—';
  return n.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function toPublicSummary(invoice) {
  if (!invoice) return null;
  const doc = `${invoice.serie}-${invoice.correlativo}`;
  return {
    id: invoice.id,
    companyRuc: invoice.companyRuc,
    tipoDoc: invoice.tipoDoc,
    tipoDocLabel: TIPO_DOC_LABEL[invoice.tipoDoc] || invoice.tipoDoc,
    serie: invoice.serie,
    correlativo: invoice.correlativo,
    numero: doc,
    fechaEmision: toApiTimestamp(invoice.fechaEmision),
    estado: invoice.estado,
    tipoMoneda: invoice.tipoMoneda,
    total: formatMoney(invoice.mtoImpVenta),
    clienteNombre: invoice.cliente?.razonSocial || '—',
    clienteDoc: invoice.cliente?.numeroDoc,
    sunatEstado: invoice.sunatEstadoDirecto || invoice.cdrEstado,
    sunatCodigo: invoice.sunatCodigoDirecto,
    sunatDescripcion: invoice.sunatDescripcionDirecto,
  };
}

function resolveEstadoApi(invoice) {
  if (invoice.estado && invoice.estado !== 'BORRADOR') return invoice.estado;
  if (invoice.sunatJson && typeof invoice.sunatJson === 'object') {
    return mapEstadoEmision(invoice.tipoDoc, invoice.sunatJson);
  }
  const sunat = String(invoice.sunatEstadoDirecto || invoice.cdrEstado || '').trim().toUpperCase();
  if (sunat) {
    return mapEstadoEmision(invoice.tipoDoc, { estado: sunat, success: sunat !== 'RECHAZADA' });
  }
  return invoice.estado || 'BORRADOR';
}

function sanitizeSunatForApi(sunatJson, includePayload = true) {
  if (!sunatJson || typeof sunatJson !== 'object') return sunatJson;
  if (includePayload) return sunatJson;
  const cleaned = { ...sunatJson };
  delete cleaned.xml;
  delete cleaned.cdr_zip;
  delete cleaned.cdr;
  delete cleaned.pdf;
  delete cleaned.pdf_base64;
  return cleaned;
}

function collectFacturaIdsFromGuias(rows) {
  const ids = new Set();
  for (const row of rows) {
    if (!['09', '31'].includes(row.tipoDoc)) continue;
    for (const doc of documentosRelacionadosRows(row)) {
      const trimmed = String(doc.invoiceRelacionadoId || '').trim();
      if (trimmed) ids.add(trimmed);
    }
    // Legacy: facturas_vinculadas en guia_meta (guias antiguas sin migrar).
    const refs = row.guiaMetaJson?.facturas_vinculadas;
    if (Array.isArray(refs)) {
      for (const id of refs) {
        const trimmed = String(id || '').trim();
        if (trimmed) ids.add(trimmed);
      }
    }
  }
  return [...ids];
}

async function loadFacturaRefMap(companyRuc, facturaIds) {
  if (!facturaIds.length) return new Map();
  const receptorRuc = String(companyRuc || '').trim();
  const rows = await prisma.invoice.findMany({
    where: {
      id: { in: facturaIds },
      OR: [
        { companyRuc: receptorRuc },
        { cliente: { numeroDoc: receptorRuc } },
      ],
    },
    select: { id: true, tipoDoc: true, serie: true, correlativo: true, companyRuc: true },
  });
  return new Map(rows.map((row) => [row.id, row]));
}

function buildGuiaApiFields(invoice, facturaMap = new Map()) {
  if (!['09', '31'].includes(invoice.tipoDoc)) return {};

  const meta = invoice.guiaMetaJson && typeof invoice.guiaMetaJson === 'object'
    ? invoice.guiaMetaJson
    : {};
  const envio = meta.envio && typeof meta.envio === 'object' ? meta.envio : undefined;

  let documentos = documentosRelacionadosRows(invoice)
    .map((row) => toApiDocumentoRelacionado(row))
    .filter(Boolean);

  // Compat lectura: facturas_vinculadas / guia_remitente legacy en JSON.
  if (!documentos.length && Array.isArray(meta.facturas_vinculadas)) {
    documentos = meta.facturas_vinculadas
      .map((id) => facturaMap.get(String(id || '').trim()))
      .filter(Boolean)
      .map((row) => ({
        id: row.id,
        tipo_doc: row.tipoDoc,
        serie: row.serie,
        correlativo: row.correlativo,
        emisor_tipo_doc: '6',
        emisor_numero_doc: row.companyRuc || invoice.companyRuc,
      }));
  }
  if (!documentos.length && meta.guia_remitente?.serie && meta.guia_remitente?.correlativo) {
    documentos = [{
      id: meta.guia_remitente.id || undefined,
      tipo_doc: meta.guia_remitente.tipo_doc || '09',
      serie: meta.guia_remitente.serie,
      correlativo: meta.guia_remitente.correlativo,
      emisor_tipo_doc: meta.remitente?.tipo_doc || '6',
      emisor_numero_doc: meta.remitente?.numero_doc || undefined,
      emisor_razon_social: meta.remitente?.razon_social || undefined,
    }];
  }

  const guiaRemitente = documentos.find((d) => d.tipo_doc === '09')
    || (meta.guia_remitente?.serie ? {
      tipo_doc: meta.guia_remitente.tipo_doc || '09',
      serie: meta.guia_remitente.serie,
      correlativo: meta.guia_remitente.correlativo,
      id: meta.guia_remitente.id || undefined,
    } : undefined);

  return {
    envio,
    facturas: documentos.length ? documentos : undefined,
    documentos_relacionados: documentos.length ? documentos : undefined,
    remitente: meta.remitente || undefined,
    guia_remitente: guiaRemitente,
  };
}

function toApiCompraInvoice(invoice, sellerCompany, options = {}) {
  if (!invoice) return null;
  const base = toApiInvoice(invoice, { ...options, includeSunatPayload: false });
  const seller = sellerCompany || null;
  return {
    ...base,
    sentido: 'RECIBIDO',
    company: seller
      ? {
          ruc: seller.ruc,
          nombre: seller.nombre,
          nombre_comercial: seller.nombreComercial || seller.nombre,
        }
      : {
          ruc: invoice.companyRuc,
          nombre: invoice.companyRuc,
        },
  };
}

function toApiInvoice(invoice, options = {}) {
  if (!invoice) return null;

  const {
    apiBaseUrl,
    companyRuc,
    includeSunatPayload = true,
    facturaMap = new Map(),
    salidaByInvoiceId = null,
    entradaByInvoiceId = null,
  } = options;
  const estadoEfectivo = resolveEstadoApi(invoice);
  const invoiceForUrls = { ...invoice, estado: estadoEfectivo };
  const fileUrls = comprobanteArchivosService.resolveFileUrls(invoiceForUrls, apiBaseUrl, {
    accessCompanyRuc: companyRuc || invoice.companyRuc,
  });
  const enrichFileUrls = (resolved) => ({
    pdf_url: resolved.pdf_url || invoice.pdfUrl,
    cdr_zip_url: resolved.cdr_zip_url || invoice.cdrZipUrl,
    xml_url: resolved.xml_url || invoice.xmlUrlDirecto,
  });
  const urls = enrichFileUrls(fileUrls);

  const tipoDocStr = String(invoice.tipoDoc || '');
  const esVentaInventario = ['01', '03'].includes(tipoDocStr);
  const esNotaCreditoInventario = tipoDocStr === '07';
  const movimientoSalidaId = esVentaInventario
    ? (salidaByInvoiceId?.get?.(invoice.id)
      || options.movimientoSalidaId
      || null)
    : null;
  const movimientoEntradaNcId = esNotaCreditoInventario
    ? (entradaByInvoiceId?.get?.(invoice.id)
      || options.movimientoEntradaId
      || null)
    : null;

  return {
    id: invoice.id,
    company_ruc: invoice.companyRuc,
    ubl_version: invoice.ublVersion,
    tipo_operacion: invoice.tipoOperacion,
    tipo_doc: invoice.tipoDoc,
    serie: invoice.serie,
    correlativo: invoice.correlativo,
    fecha_emision: toApiTimestamp(invoice.fechaEmision),
    fec_vencimiento: invoice.fecVencimiento,
    tipo_moneda: invoice.tipoMoneda,
    forma_pago: invoice.formaPago,
    observacion: invoice.observacion,
    mto_oper_gravadas: toNumber(invoice.mtoOperGravadas),
    mto_oper_exoneradas: toNumber(invoice.mtoOperExoneradas),
    mto_oper_inafectas: toNumber(invoice.mtoOperInafectas),
    mto_oper_exportacion: toNumber(invoice.mtoOperExportacion),
    mto_igv: toNumber(invoice.mtoIgv),
    total_impuestos: toNumber(invoice.totalImpuestos),
    sub_total: toNumber(invoice.subTotal),
    mto_imp_venta: toNumber(invoice.mtoImpVenta),
    almacen_id: invoice.almacenId || undefined,
    motivo_codigo: invoice.motivoCodigo,
    motivo_nota: invoice.motivoNota,
    documento_afectado_id: invoice.documentoAfectadoId,
    documento_afectado: invoice.documentoAfectado
      ? {
          id: invoice.documentoAfectado.id,
          tipo_doc: invoice.documentoAfectado.tipoDoc,
          serie: invoice.documentoAfectado.serie,
          correlativo: invoice.documentoAfectado.correlativo,
        }
      : undefined,
    estado: estadoEfectivo,
    cdr_estado: invoice.cdrEstado,
    pdf_url: urls.pdf_url,
    cdr_zip_url: urls.cdr_zip_url,
    xml_url: urls.xml_url,
    adjuntos: archivosJsonToAdjuntosList(invoice.archivosJson),
    archivos: (() => {
      const a = invoice.archivosJson;
      if (!a || typeof a !== 'object' || Array.isArray(a)) return undefined;
      if (a.xml || a.pdf || a.cdr_zip || a.cdr) return undefined;
      return Object.keys(a).length ? a : undefined;
    })(),
    sunat_estado: invoice.sunatEstadoDirecto || invoice.cdrEstado,
    sunat_codigo: invoice.sunatCodigoDirecto,
    sunat_descripcion: invoice.sunatDescripcionDirecto,
    sunat_notas: invoice.sunatNotasDirecto,
    hash: invoice.hash,
    hash_cpe: invoice.hash,
    sunat: sanitizeSunatForApi(invoice.sunatJson, includeSunatPayload),
    puede_reenviar: estadoEfectivo === 'RECHAZADO' && ['01', '03', '07', '08', '09', '31'].includes(invoice.tipoDoc),
    cliente: invoice.cliente ? clienteModel.toApi(invoice.cliente) : undefined,
    client: invoice.cliente
      ? {
          tipo_doc: invoice.cliente.tipoDoc,
          numero_doc: invoice.cliente.numeroDoc,
          razon_social: invoice.cliente.razonSocial,
          nombre: invoice.cliente.razonSocial,
        }
      : undefined,
    details: (invoice.details || []).map(toApiSaleDetail),
    legends: (invoice.legends || []).map((legend) => ({
      code: legend.code,
      value: legend.value,
    })),
    ...(esVentaInventario
      ? {
          inventario_estado: movimientoSalidaId ? 'DESCONTADO' : 'PENDIENTE',
          movimiento_salida_id: movimientoSalidaId || undefined,
        }
      : {}),
    ...(esNotaCreditoInventario
      ? {
          inventario_estado: movimientoEntradaNcId ? 'DEVUELTO' : 'PENDIENTE',
          movimiento_entrada_id: movimientoEntradaNcId || undefined,
        }
      : {}),
    ...buildGuiaApiFields(invoice, facturaMap),
  };
}

function mapEstadoEmision(tipoDoc, emisorData) {
  const raw = String(emisorData?.estado || '').trim().toUpperCase();
  if (raw === 'ACEPTADA' || raw === 'ACEPTADO') return 'ACEPTADO';
  if (raw === 'RECHAZADA' || raw === 'RECHAZADO') return 'RECHAZADO';
  if (raw === 'GENERADA') return 'ENVIADO';
  if (raw === 'ENVIADA' || raw === 'PROCESANDO' || raw === 'ENVIADO') return 'ENVIADO';
  if (tipoDoc === '03' && emisorData.success) return 'ENVIADO';
  if (emisorData.success === false) return 'RECHAZADO';
  if (emisorData.success === true) return 'ENVIADO';
  return 'ENVIADO';
}

/**
 * gre-test a veces responde solo "Error inesperado"; enriquecemos el mensaje
 * para que en la app se entienda la causa más probable.
 */
function enrichSunatDescripcion(emisorData) {
  const codigo = String(emisorData?.error?.codigo ?? emisorData?.codigo_cdr ?? '');
  const mensaje = String(
    emisorData?.error?.mensaje ||
    emisorData?.error?.descripcion ||
    emisorData?.descripcion ||
    emisorData?.mensaje ||
    '',
  ).trim();

  if (!mensaje) return null;

  const isGeneric500 =
    (codigo === '500' || /error inesperado/i.test(mensaje)) &&
    /inesperado/i.test(mensaje);

  if (isGeneric500) {
    return (
      'Error inesperado del sandbox GRE (gre-test). '
      + 'Revisa: RUC del XML alineado con OAuth demo, fecha de traslado ≥ emisión, '
      + 'y si es transporte público (01) el nro_mtc del transportista.'
    );
  }

  return mensaje;
}

async function findCompany(companyRuc) {
  return prisma.company.findFirst({
    where: { ruc: companyRuc },
    include: { address: true },
  });
}

async function getNextResumenCorrelativo(companyRuc) {
  const count = await prisma.invoice.count({
    where: { companyRuc, tipoDoc: '03', estado: { in: ['ACEPTADO', 'ENVIADO'] } },
  });
  return String(count + 1).padStart(3, '0');
}

async function findBoletasPendientesResumen(companyRuc, fecha = null) {
  const boletas = await prisma.invoice.findMany({
    where: {
      companyRuc,
      tipoDoc: '03',
      estado: 'ENVIADO',
    },
    include: {
      cliente: { include: { address: true } },
      details: { include: { catalogItem: true } },
    },
  });

  return boletas.filter((boleta) => {
    const sunat = boleta.sunatJson;
    if (sunat && typeof sunat === 'object' && sunat.resumen?.success) return false;
    if (!fecha) return true;
    const ms = Number.parseInt(String(boleta.fechaEmision || ''), 10);
    if (!Number.isFinite(ms)) return false;
    const boletaFecha = new Date(ms).toISOString().slice(0, 10);
    return boletaFecha === fecha;
  });
}

async function marcarBoletasResumidas(ids, resumenData) {
  await prisma.invoice.updateMany({
    where: { id: { in: ids } },
    data: {
      estado: resumenData.success ? 'ACEPTADO' : 'ENVIADO',
      sunatEstadoDirecto: resumenData.estado || null,
      sunatCodigoDirecto: resumenData.codigo_cdr != null ? String(resumenData.codigo_cdr) : null,
      sunatDescripcionDirecto: resumenData.descripcion || null,
      sunatNotasDirecto: resumenData.observaciones ?? null,
    },
  });

  for (const id of ids) {
    const row = await prisma.invoice.findUnique({ where: { id }, select: { sunatJson: true } });
    const prev = row?.sunatJson && typeof row.sunatJson === 'object' ? row.sunatJson : {};
    await prisma.invoice.update({
      where: { id },
      data: {
        sunatJson: { ...prev, resumen: resumenData },
      },
    });
  }
}

async function createFromMobileRequest(companyRuc, body) {
  const company = await findCompany(companyRuc);
  if (!company) throw new Error('No se encontró la empresa emisora.');

  const tipoConfig = resolveTipoConfig(body.tipo, company);
  const receptor = validateReceptorForTipo(tipoConfig.tipoDoc, parseReceptor(body));
  const lineas = Array.isArray(body.lineas) ? body.lineas : [];

  let saleDetails = [];
  let guiaMetaJson = null;
  let almacenId = null;
  let documentosRelacionadosCreate = [];

  if (tipoConfig.tipoDoc === '09') {
    const docsBody = parseDocumentosRelacionadosBody(body);
    const tieneDocs = docsBody.length > 0;
    const clienteRow = await prisma.cliente.findFirst({
      where: { companyRuc, tipoDoc: receptor.tipoDoc, numeroDoc: receptor.numeroDoc },
      include: { address: true },
    });

    const { docs, invoicesInternas } = await resolveDocumentosRelacionados(
      companyRuc,
      company,
      docsBody,
      receptor,
    );
    documentosRelacionadosCreate = docs;

    const conDetalle = invoicesInternas.filter((inv) => (inv.details || []).length > 0);
    if (conDetalle.length > 0) {
      saleDetails = aggregateDetailsFromFacturas(conDetalle);
      guiaMetaJson = buildEnvioMeta(body, company, clienteRow);
    } else if (lineas.length > 0) {
      // Traslado interno, compra/manual externo: bienes desde catálogo o descripción libre.
      const catalogMap = await loadCatalogItems(companyRuc, lineas);
      saleDetails = lineas.map((linea) => {
        const catalogItemId = String(linea.catalog_item_id || linea.catalogItemId || '').trim();
        const catalogItem = catalogMap.get(catalogItemId);
        const cantidad = toNumber(linea.cantidad, 1);
        if (!catalogItem) {
          return saleDetailDesdeLineaLibre(linea, cantidad);
        }
        const calc = calcularLinea(catalogItem, cantidad, null);
        return {
          catalogItemId,
          catalogItem,
          descripcion: calc.descripcion,
          nombre: calc.nombre,
          cantidad: calc.cantidad,
          unidad: calc.unidad,
          mtoValorUnitario: 0,
          mtoPrecioUnitario: 0,
          mtoBaseIgv: 0,
          mtoValorVenta: 0,
          mtoIgv: 0,
          totalFactura: 0,
          porcentajeIgv: 0,
          tipAfeIgv: '30',
          productoSerieId: linea.producto_serie_id || linea.productoSerieId || null,
        };
      });
      almacenId = String(body.almacen_id || body.almacenId || '').trim() || null;
      guiaMetaJson = buildEnvioMeta(body, company, clienteRow);
    } else if (tieneDocs) {
      throw new Error(
        'Los documentos relacionados no tienen líneas de bienes utilizables. '
          + 'Vincula CPE emitidos/recibidos con detalle, o agrega líneas manuales.',
      );
    } else {
      throw new Error(
        'La GRE remitente requiere documentos relacionados o al menos una línea de bienes (traslado interno).',
      );
    }
  } else if (tipoConfig.tipoDoc === '31') {
    if (lineas.length === 0) {
      throw new Error('La GRE transportista requiere al menos una línea de detalle.');
    }
    const remitente = parseRemitente(body);
    const catalogMap = await loadCatalogItems(companyRuc, lineas);
    saleDetails = lineas.map((linea) => {
      const catalogItemId = String(linea.catalog_item_id || linea.catalogItemId || '').trim();
      const catalogItem = catalogMap.get(catalogItemId);
      const cantidad = toNumber(linea.cantidad, 1);
      const calc = calcularLinea(catalogItem, cantidad, null);
      return {
        catalogItemId,
        catalogItem,
        descripcion: calc.descripcion,
        nombre: calc.nombre,
        cantidad: calc.cantidad,
        unidad: calc.unidad,
        mtoValorUnitario: 0,
        mtoPrecioUnitario: 0,
        mtoBaseIgv: 0,
        mtoValorVenta: 0,
        mtoIgv: 0,
        totalFactura: 0,
        porcentajeIgv: 0,
        tipAfeIgv: '30',
      };
    });
    const clienteRow = await prisma.cliente.findFirst({
      where: { companyRuc, tipoDoc: receptor.tipoDoc, numeroDoc: receptor.numeroDoc },
      include: { address: true },
    });
    const guiaRemitente = parseGuiaRemitenteRef(body);
    guiaMetaJson = {
      ...buildEnvioMeta(body, company, clienteRow),
      remitente: {
        tipo_doc: remitente.tipoDoc,
        numero_doc: remitente.numeroDoc,
        razon_social: remitente.razonSocial,
      },
    };
    if (guiaRemitente) {
      const { docs } = await resolveDocumentosRelacionados(
        companyRuc,
        company,
        [{
          ...guiaRemitente,
          emisor_tipo_doc: remitente.tipoDoc,
          emisor_numero_doc: remitente.numeroDoc,
          emisor_razon_social: remitente.razonSocial,
        }],
        remitente,
      );
      documentosRelacionadosCreate = docs;
    }
  } else {
    if (lineas.length === 0) {
      throw new Error('Debe incluir al menos una línea.');
    }

    const catalogMap = await loadCatalogItems(companyRuc, lineas);
    saleDetails = mapLineasToSaleDetails(lineas, catalogMap);
    almacenId = String(body.almacen_id || body.almacenId || '').trim() || null;
  }

  const montos = (tipoConfig.tipoDoc === '09' || tipoConfig.tipoDoc === '31')
    ? {
        mtoOperGravadas: 0,
        mtoOperExoneradas: 0,
        mtoOperInafectas: 0,
        mtoIgv: 0,
        totalImpuestos: 0,
        subTotal: 0,
        mtoImpVenta: 0,
      }
    : calcularTotales(saleDetails);

  const clienteId = await resolveClienteId(companyRuc, receptor);
  const correlativo = await getNextCorrelativo(
    companyRuc,
    tipoConfig.tipoDoc,
    tipoConfig.serie,
    {
      correlativoInicio: tipoConfig.correlativoInicio,
      correlativoDigitos: tipoConfig.correlativoDigitos,
    },
  );

  let documentoAfectadoId = null;
  let motivoCodigo = null;
  let motivoNota = (body.motivo_nota || body.motivoNota || '').trim() || null;

  if (tipoConfig.tipoDoc === '07' || tipoConfig.tipoDoc === '08') {
    documentoAfectadoId = await resolveDocumentoAfectadoId(companyRuc, body.documento_afectado || body.documentoAfectado);
    motivoCodigo = String(body.motivo_codigo || body.motivoCodigo || '01').trim();
    if (!motivoNota) throw new Error('motivo_nota es obligatorio para notas.');
  }

  if (tipoConfig.tipoDoc === '07') {
    await validateNotaCreditoLineas(companyRuc, documentoAfectadoId, saleDetails, lineas);
  }

  const invoiceId = randomUUID();
  const archivosJson = parseArchivosBody(body);

  await prisma.$transaction(async (tx) => {
    await tx.invoice.create({
      data: {
        id: invoiceId,
        companyRuc,
        tipoDoc: tipoConfig.tipoDoc,
        serie: tipoConfig.serie,
        correlativo,
        fechaEmision: toStoredTimestamp(),
        tipoMoneda: 'PEN',
        formaPago: 'Contado',
        observacion: (body.observaciones || body.observacion || '').trim() || null,
        mtoOperGravadas: montos.mtoOperGravadas,
        mtoOperExoneradas: montos.mtoOperExoneradas,
        mtoOperInafectas: montos.mtoOperInafectas,
        mtoIgv: montos.mtoIgv,
        totalImpuestos: montos.totalImpuestos,
        subTotal: montos.subTotal,
        mtoImpVenta: montos.mtoImpVenta,
        almacenId,
        guiaMetaJson,
        motivoCodigo,
        motivoNota,
        documentoAfectadoId,
        estado: 'BORRADOR',
        clienteId,
        archivosJson:
          archivosJson && Object.keys(archivosJson).length ? archivosJson : undefined,
        details: {
          create: saleDetails.map(toSaleDetailCreateInput),
        },
      },
    });
    if (documentosRelacionadosCreate.length) {
      await syncDocumentosRelacionados(tx, invoiceId, documentosRelacionadosCreate);
    }
  });

  // Persistir MTC del transportista en la empresa si vino en el envío GRE.
  if (tipoConfig.tipoDoc === '09' || tipoConfig.tipoDoc === '31') {
    const nroMtcEnvio =
      guiaMetaJson?.envio?.nro_mtc ||
      body?.envio?.nro_mtc ||
      body?.nro_mtc ||
      body?.nroMtc ||
      '';
    const nroMtc = String(nroMtcEnvio || '').trim();
    if (nroMtc) {
      try {
        await companyModel.updateNroMtcByRuc(companyRuc, nroMtc);
      } catch (_) {
        /* no bloquear emisión si falla el update de MTC */
      }
    }
  }

  return findByIdForEmission(invoiceId, companyRuc);
}

async function findAllByCompany(companyRuc, { desde = null, hasta = null, apiBaseUrl = null } = {}) {
  const rows = await prisma.invoice.findMany({
    where: { companyRuc },
    include: INVOICE_INCLUDE,
  });

  let filtered = rows;
  if (desde || hasta) {
    const desdeMs = desde ? calendarDayStartMsPe(desde) : null;
    const hastaMs = hasta ? calendarDayEndMsPe(hasta) : null;

    filtered = rows.filter((row) => {
      const ms = parseStoredTimestamp(row.fechaEmision);
      if (ms == null) return false;
      if (desdeMs != null && ms < desdeMs) return false;
      if (hastaMs != null && ms > hastaMs) return false;
      return true;
    });
  }

  filtered.sort((a, b) => {
    const byFecha = compareStoredTimestamps(b.fechaEmision, a.fechaEmision);
    if (byFecha !== 0) return byFecha;
    const serieCmp = String(a.serie || '').localeCompare(String(b.serie || ''));
    if (serieCmp !== 0) return serieCmp;
    return String(b.correlativo || '').localeCompare(String(a.correlativo || ''), undefined, {
      numeric: true,
    });
  });

  const facturaMap = await loadFacturaRefMap(companyRuc, collectFacturaIdsFromGuias(filtered));
  const ventaIds = filtered
    .filter((row) => ['01', '03'].includes(row.tipoDoc))
    .map((row) => row.id);
  const ncIds = filtered
    .filter((row) => row.tipoDoc === '07')
    .map((row) => row.id);
  const [salidaByInvoiceId, entradaByInvoiceId] = await Promise.all([
    loadSalidasPorComprobanteIds(companyRuc, ventaIds),
    loadEntradasPorReferenciaIds(companyRuc, ncIds),
  ]);

  return filtered.map((row) =>
    toApiInvoice(row, {
      apiBaseUrl,
      companyRuc,
      includeSunatPayload: false,
      facturaMap,
      salidaByInvoiceId,
      entradaByInvoiceId,
    }),
  );
}

/** Compras: comprobantes que otras empresas emitieron a mi RUC (soy el cliente/receptor). */
async function findComprasByCompany(companyRuc, { desde = null, hasta = null, apiBaseUrl = null } = {}) {
  const receptorRuc = String(companyRuc || '').trim();
  if (!receptorRuc) return [];

  const rows = await prisma.invoice.findMany({
    where: {
      companyRuc: { not: receptorRuc },
      cliente: { numeroDoc: receptorRuc },
      estado: { in: ['ACEPTADO', 'ENVIADO'] },
      tipoDoc: { in: ['01', '03', '07', '08', '09', '31'] },
    },
    include: INVOICE_INCLUDE,
  });

  let filtered = rows;
  if (desde || hasta) {
    const desdeMs = desde ? calendarDayStartMsPe(desde) : null;
    const hastaMs = hasta ? calendarDayEndMsPe(hasta) : null;

    filtered = rows.filter((row) => {
      const ms = parseStoredTimestamp(row.fechaEmision);
      if (ms == null) return false;
      if (desdeMs != null && ms < desdeMs) return false;
      if (hastaMs != null && ms > hastaMs) return false;
      return true;
    });
  }

  filtered.sort((a, b) => {
    const byFecha = compareStoredTimestamps(b.fechaEmision, a.fechaEmision);
    if (byFecha !== 0) return byFecha;
    const serieCmp = String(a.serie || '').localeCompare(String(b.serie || ''));
    if (serieCmp !== 0) return serieCmp;
    return String(b.correlativo || '').localeCompare(String(a.correlativo || ''), undefined, {
      numeric: true,
    });
  });

  const sellerRucs = [...new Set(filtered.map((row) => row.companyRuc).filter(Boolean))];
  const sellers = sellerRucs.length
    ? await prisma.company.findMany({
        where: { ruc: { in: sellerRucs } },
        select: { ruc: true, nombre: true, nombreComercial: true },
      })
    : [];
  const sellerMap = new Map(sellers.map((s) => [s.ruc, s]));

  const invoiceIds = filtered.map((row) => row.id);
  const entradas = invoiceIds.length
    ? await prisma.movimiento.findMany({
        where: {
          companyRuc: receptorRuc,
          tipo: 'ENTRADA',
          OR: [
            { comprobanteId: { in: invoiceIds } },
            { referenciaId: { in: invoiceIds } },
          ],
        },
        select: { id: true, comprobanteId: true, referenciaId: true },
      })
    : [];
  const entradaPorInvoice = new Map();
  for (const mov of entradas) {
    const key = mov.comprobanteId || mov.referenciaId;
    if (key) entradaPorInvoice.set(key, mov.id);
  }

  return filtered.map((row) => {
    const base = toApiCompraInvoice(row, sellerMap.get(row.companyRuc), {
      apiBaseUrl,
      companyRuc: receptorRuc,
      includeSunatPayload: false,
    });
    const entradaId = entradaPorInvoice.get(row.id);
    if (entradaId) {
      base.movimiento_entrada_id = entradaId;
      base.inventario_estado = 'RECIBIDO';
    } else {
      base.inventario_estado = base.inventario_estado || null;
    }
    return base;
  });
}

async function findAll() {
  const rows = await prisma.invoice.findMany({
    include: {
      cliente: { select: { razonSocial: true, numeroDoc: true, tipoDoc: true } },
    },
  });
  rows.sort((a, b) => {
    const byFecha = compareStoredTimestamps(b.fechaEmision, a.fechaEmision);
    if (byFecha !== 0) return byFecha;
    return String(b.correlativo || '').localeCompare(String(a.correlativo || ''), undefined, {
      numeric: true,
    });
  });
  return rows.map(toPublicSummary);
}

async function findByIdForEmission(id, companyRuc) {
  const invoice = await prisma.invoice.findFirst({
    where: { id, companyRuc },
    include: INVOICE_INCLUDE,
  });

  if (!invoice) return null;

  const company = await prisma.company.findFirst({
    where: { ruc: companyRuc },
    include: { address: true },
  });

  return { ...invoice, company };
}

/**
 * Emisor (company_ruc) o receptor (cliente.numeroDoc) pueden acceder
 * (PDF / detalle de compras recibidas).
 */
async function findByIdForCompanyAccess(id, companyRuc) {
  const ruc = String(companyRuc || '').trim();
  if (!ruc) return null;

  const invoice = await prisma.invoice.findFirst({
    where: {
      id,
      OR: [
        { companyRuc: ruc },
        { cliente: { numeroDoc: ruc } },
      ],
    },
    include: INVOICE_INCLUDE,
  });
  if (!invoice) return null;

  // Company del emisor: el PDF muestra quién facturó.
  const company = await prisma.company.findFirst({
    where: { ruc: invoice.companyRuc },
    include: { address: true },
  });

  return { ...invoice, company };
}

async function ensurePdfAtEmission(invoice, estado, apiBaseUrl) {
  if (!invoice || estado === 'BORRADOR') return null;

  try {
    const buffer = await comprobantePdfService.generarPdfBuffer({ ...invoice, estado });
    if (!buffer?.length) return null;
    const saved = await comprobanteArchivosService.persistGeneratedPdf(invoice, buffer, apiBaseUrl);
    return saved?.url || null;
  } catch (err) {
    console.warn('[comprobante] No se pudo generar/subir PDF al emitir:', err.message);
    return null;
  }
}

async function applyEmisionResult(id, companyRuc, tipoDoc, emisorData, options = {}) {
  const estado = mapEstadoEmision(tipoDoc, emisorData);
  const current = await findByIdForEmission(id, companyRuc);

  const persisted = current
    ? await comprobanteArchivosService.persistEmisorArchivos(
        current,
        emisorData,
        options.apiBaseUrl,
      )
    : {
        pdfUrl: null,
        cdrZipUrl: null,
        xmlUrlDirecto: null,
        hash: null,
      };

  const sunatNotas = emisorData.observaciones ?? null;

  let pdfUrl = persisted.pdfUrl;
  if (!pdfUrl && current && estado !== 'BORRADOR') {
    pdfUrl = await ensurePdfAtEmission({ ...current, estado }, estado, options.apiBaseUrl);
  }

  const updated = await prisma.invoice.update({
    where: { id },
    data: {
      estado,
      cdrEstado: emisorData.estado || null,
      sunatEstadoDirecto: emisorData.estado || null,
      sunatCodigoDirecto:
        emisorData.codigo_cdr != null
          ? String(emisorData.codigo_cdr)
          : emisorData.error?.codigo != null
            ? String(emisorData.error.codigo)
            : null,
      sunatDescripcionDirecto:
        enrichSunatDescripcion(emisorData) ||
        emisorData.descripcion ||
        emisorData.mensaje ||
        emisorData.error?.mensaje ||
        emisorData.error?.descripcion ||
        null,
      sunatNotasDirecto: sunatNotas,
      sunatJson: emisorData,
      pdfUrl: pdfUrl || undefined,
      cdrZipUrl: persisted.cdrZipUrl || undefined,
      xmlUrlDirecto: persisted.xmlUrlDirecto || undefined,
      hash: persisted.hash || undefined,
    },
    include: INVOICE_INCLUDE,
  });

  if (
    tipoDoc === '07'
    && ['ACEPTADO', 'ENVIADO'].includes(estado)
    && updated.documentoAfectadoId
  ) {
    await aplicarEstadoLineasDocumentoAfectadoNotaCredito(updated, options.lineasBody || null);
  }

  return toApiInvoiceEnriched(updated, options);
}

async function getArchivoBuffer(invoice, tipo, options = {}) {
  const formato = String(options.formato || 'a4').trim().toLowerCase();

  if (tipo === 'pdf' && (formato === 'ticket' || formato === 'thermal')) {
    const estado = resolveEstadoApi(invoice);
    if (estado === 'BORRADOR') return null;
    const buffer = await comprobantePdfService.generarPdfBuffer({ ...invoice, estado }, formato);
    return { buffer, contentType: 'application/pdf', ext: 'pdf' };
  }

  const stored = await comprobanteArchivosService.getArchivoBuffer(invoice, tipo);
  if (stored) return stored;

  const estado = resolveEstadoApi(invoice);
  if (tipo === 'pdf' && estado !== 'BORRADOR') {
    const buffer = await comprobantePdfService.generarPdfBuffer({ ...invoice, estado }, formato);
    if (buffer && formato === 'a4' && !invoice.pdfUrl && options.apiBaseUrl) {
      const saved = await comprobanteArchivosService.persistGeneratedPdf(
        invoice,
        buffer,
        options.apiBaseUrl,
      );
      if (saved?.url) {
        await prisma.invoice.update({
          where: { id: invoice.id },
          data: { pdfUrl: saved.url },
        });
      }
    }
    return { buffer, contentType: 'application/pdf', ext: 'pdf' };
  }

  return null;
}

async function findInvoiceRow(id) {
  return prisma.invoice.findUnique({
    where: { id },
    select: { id: true, sunatJson: true, estado: true, companyRuc: true },
  });
}

async function updateSunatJson(id, sunatJson) {
  await prisma.invoice.update({
    where: { id },
    data: { sunatJson },
  });
}

async function marcarAnulado(id, companyRuc, motivo) {
  const row = await prisma.invoice.findFirst({ where: { id, companyRuc }, select: { sunatJson: true } });
  const prev = row?.sunatJson && typeof row.sunatJson === 'object' ? row.sunatJson : {};
  await prisma.invoice.update({
    where: { id },
    data: {
      estado: 'ANULADO',
      sunatJson: { ...prev, baja_motivo: motivo, baja_en: new Date().toISOString() },
    },
  });
}

async function toApiInvoiceEnriched(invoice, options = {}) {
  if (!invoice) return null;
  const companyRuc = options.companyRuc || invoice.companyRuc;
  const facturaMap = await loadFacturaRefMap(companyRuc, collectFacturaIdsFromGuias([invoice]));
  let salidaByInvoiceId = options.salidaByInvoiceId || null;
  let entradaByInvoiceId = options.entradaByInvoiceId || null;
  const tipo = String(invoice.tipoDoc || '');
  if (!salidaByInvoiceId && ['01', '03'].includes(tipo)) {
    salidaByInvoiceId = await loadSalidasPorComprobanteIds(companyRuc, [invoice.id]);
  }
  if (!entradaByInvoiceId && tipo === '07') {
    entradaByInvoiceId = await loadEntradasPorReferenciaIds(companyRuc, [invoice.id]);
  }
  return toApiInvoice(invoice, {
    ...options,
    companyRuc,
    facturaMap,
    salidaByInvoiceId,
    entradaByInvoiceId,
  });
}

async function deleteDraftInvoice(id, companyRuc) {
  const row = await prisma.invoice.findFirst({
    where: { id, companyRuc, estado: 'BORRADOR' },
    select: { id: true },
  });
  if (!row) return false;

  await prisma.invoice.updateMany({
    where: { documentoAfectadoId: id },
    data: { documentoAfectadoId: null },
  });
  await prisma.invoice.delete({ where: { id } });
  return true;
}

/**
 * Elimina un comprobante registrado que aún no fue aceptado por SUNAT.
 * No permite borrar ACEPTADO ni ANULADO.
 */
async function deleteNoAceptadoInvoice(id, companyRuc) {
  const row = await prisma.invoice.findFirst({
    where: { id, companyRuc },
    select: { id: true, estado: true, serie: true, correlativo: true, tipoDoc: true },
  });
  if (!row) {
    const err = new Error('Comprobante no encontrado');
    err.status = 404;
    throw err;
  }

  const estado = String(row.estado || '').toUpperCase();
  if (estado === 'ACEPTADO' || estado === 'ANULADO') {
    const err = new Error(
      `No se puede eliminar un comprobante en estado ${estado}. Solo borradores, enviados o rechazados.`,
    );
    err.status = 409;
    throw err;
  }

  await prisma.invoice.updateMany({
    where: { documentoAfectadoId: id },
    data: { documentoAfectadoId: null },
  });
  await prisma.invoice.delete({ where: { id } });
  return {
    id: row.id,
    serie: row.serie,
    correlativo: row.correlativo,
    tipo_doc: row.tipoDoc,
    estado,
  };
}

/** Aplica cambios del body mobile a un comprobante rechazado antes de reemitir. */
async function updateRejectedFromMobileRequest(id, companyRuc, body) {
  const invoice = await prisma.invoice.findFirst({
    where: { id, companyRuc, estado: 'RECHAZADO' },
    include: INVOICE_INCLUDE,
  });
  if (!invoice) return null;

  if (!['09', '31'].includes(invoice.tipoDoc)) return invoice;

  const company = await findCompany(companyRuc);
  const clienteRow = invoice.cliente
    || (invoice.clienteId
      ? await prisma.cliente.findFirst({
          where: { id: invoice.clienteId },
          include: { address: true },
        })
      : null);

  const prevMeta = invoice.guiaMetaJson && typeof invoice.guiaMetaJson === 'object'
    ? invoice.guiaMetaJson
    : {};
  const envioMeta = buildEnvioMeta(body, company, clienteRow);

  const guiaMetaJson = {
    envio: envioMeta.envio,
    ...(prevMeta.remitente ? { remitente: prevMeta.remitente } : {}),
    ...(invoice.tipoDoc === '31' && body.remitente
      ? {
          remitente: {
            tipo_doc: parseRemitente(body).tipoDoc,
            numero_doc: parseRemitente(body).numeroDoc,
            razon_social: parseRemitente(body).razonSocial,
          },
        }
      : {}),
  };

  const docsBody = parseDocumentosRelacionadosBody(body);
  const guiaRemitenteBody = invoice.tipoDoc === '31' ? parseGuiaRemitenteRef(body) : null;
  const refsToResolve = docsBody.length
    ? docsBody
    : (guiaRemitenteBody ? [guiaRemitenteBody] : []);

  let documentosRelacionadosCreate = null;
  if (refsToResolve.length) {
    const receptor = invoice.cliente
      ? {
          tipoDoc: invoice.cliente.tipoDoc,
          numeroDoc: invoice.cliente.numeroDoc,
          razonSocial: invoice.cliente.razonSocial,
        }
      : null;
    const { docs } = await resolveDocumentosRelacionados(
      companyRuc,
      company,
      refsToResolve,
      guiaMetaJson.remitente
        ? {
            tipoDoc: guiaMetaJson.remitente.tipo_doc,
            numeroDoc: guiaMetaJson.remitente.numero_doc,
            razonSocial: guiaMetaJson.remitente.razon_social,
          }
        : receptor,
    );
    documentosRelacionadosCreate = docs;
  }

  const observacion = (body.observaciones || body.observacion || '').trim() || invoice.observacion;
  const archivosJson = parseArchivosBody(body);

  await prisma.$transaction(async (tx) => {
    await tx.invoice.update({
      where: { id },
      data: {
        guiaMetaJson,
        observacion,
        motivoCodigo: String(body.motivo_codigo || body.motivoCodigo || invoice.motivoCodigo || '').trim() || null,
        motivoNota: (body.motivo_nota || body.motivoNota || invoice.motivoNota || '').trim() || null,
        ...(archivosJson !== null
          ? {
              archivosJson: Object.keys(archivosJson).length ? archivosJson : null,
            }
          : {}),
      },
    });

    if (documentosRelacionadosCreate !== null) {
      await syncDocumentosRelacionados(tx, id, documentosRelacionadosCreate);
    }
  });

  return findByIdForEmission(id, companyRuc);
}

module.exports = {
  findAll,
  findAllByCompany,
  findComprasByCompany,
  findByIdForEmission,
  findByIdForCompanyAccess,
  findCompany,
  getNextResumenCorrelativo,
  findBoletasPendientesResumen,
  marcarBoletasResumidas,
  createFromMobileRequest,
  updateRejectedFromMobileRequest,
  deleteDraftInvoice,
  deleteNoAceptadoInvoice,
  applyEmisionResult,
  toApiInvoice,
  toApiCompraInvoice,
  toApiInvoiceEnriched,
  toApiSaleDetail,
  getArchivoBuffer,
  toPublic: toPublicSummary,
  findInvoiceRow,
  updateSunatJson,
  marcarAnulado,
};

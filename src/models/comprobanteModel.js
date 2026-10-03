const { randomUUID } = require('crypto');
const prisma = require('../config/prisma');
const clienteModel = require('./clienteModel');
const companyModel = require('./companyModel');
const productoSerieModel = require('./productoSerieModel');
const comprobanteArchivosService = require('../services/comprobanteArchivosService');
const comprobantePdfService = require('../services/comprobantePdfService');
const {
  loadSalidasPorComprobanteIds,
  loadSalidasPorGuiaRemisionIds,
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
const {
  aplicarIndicadorPagadorFleteGreT,
  esGreTransportistaBody,
} = require('../utils/grePagadorFleteSunat');
const {
  aplicarIndicadorVehiculoM1L,
  truthyFlag,
} = require('../utils/greEnvioIndicadoresSunat');

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
  cliente: true,
  details: DETAIL_INCLUDE,
  legends: true,
  metodoPago: true,
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

  const seen = new Set();
  let orden = 0;
  for (let i = 0; i < docs.length; i += 1) {
    const doc = docs[i];
    const invoice2Id = String(doc.invoiceRelacionadoId || doc.invoice2Id || '').trim();
    if (!invoice2Id || invoice2Id === invoiceId) continue;
    if (seen.has(invoice2Id)) continue;
    seen.add(invoice2Id);

    await tx.lineInvoiceInvoice.create({
      data: {
        id: doc.id || randomUUID(),
        invoiceId,
        invoice2Id,
        orden: doc.orden ?? orden,
      },
    });
    orden += 1;
  }
}

function round4(value) {
  return Math.round(Number(value) * 10000) / 10000;
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Costo de catálogo; null si no hay (no forzar 0). */
function snapshotPrecioCompra(item) {
  if (!item) return null;
  const raw = item.precioCompra ?? item.precio_compra;
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
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
 * Máximo 5 adjuntos de usuario (imágenes + archivos) por comprobante.
 */
const MAX_ADJUNTOS_COMPROBANTE = 5;

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
  } else if (typeof raw === 'object') {
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
  } else {
    return {};
  }

  const total = Object.keys(map).length;
  if (total > MAX_ADJUNTOS_COMPROBANTE) {
    throw new Error(
      `Máximo ${MAX_ADJUNTOS_COMPROBANTE} adjuntos por comprobante (archivos e imágenes). Recibidos: ${total}.`,
    );
  }
  return map;
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
    || ref.company_ruc
    || ref.companyRuc
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

function normalizeTipoDocRef(raw, fallback = '') {
  const v = String(raw || '').trim();
  if (!v) return fallback;
  const map = {
    FACTURA: '01',
    BOLETA: '03',
    NOTA_CREDITO: '07',
    NOTA_DEBITO: '08',
    GUIA_EMISION: '09',
    GUIA_REMITENTE: '09',
    GUIA_TRANSPORTISTA: '31',
  };
  if (map[v.toUpperCase()]) return map[v.toUpperCase()];
  const digits = v.replace(/\D/g, '');
  if (digits.length >= 1 && digits.length <= 2) return digits.padStart(2, '0');
  return v.slice(0, 4);
}

function correlativosCandidatos(raw) {
  const original = String(raw || '').trim();
  const digits = original.replace(/\D/g, '');
  if (!digits) return original ? [original] : [];
  const stripped = digits.replace(/^0+/, '') || '0';
  const padded8 = stripped.padStart(8, '0');
  return [...new Set([original, digits, stripped, padded8])];
}

/** NC motivo 02: etiqueta F001-00000018 de la nueva FE (puede no existir en BD local). */
function parseNuevaFacturaNota(body) {
  const direct = String(body.nueva_factura || body.nuevaFactura || '').trim();
  if (direct) return direct;
  const serie = String(body.serie_nueva_fe || body.serieNuevaFe || '').trim().toUpperCase();
  const numero = String(body.numero_nueva_fe || body.numeroNuevaFe || '').trim();
  if (!serie || !numero) return null;
  const digits = numero.replace(/\D/g, '');
  if (!digits) return null;
  return `${serie}-${digits.padStart(8, '0')}`;
}

/**
 * Resuelve refs del body a filas line_invoice_invoice.
 * Si el CPE no está en BD, crea un stub mínimo (emitido propio o compra recibida).
 * SUNAT valida la relación al emitir la GRE.
 */
async function resolveDocumentosRelacionados(companyRuc, company, refs, receptorFallback = null) {
  if (!Array.isArray(refs) || refs.length === 0) {
    return { docs: [], invoicesInternas: [] };
  }

  const docs = [];
  const invoicesInternas = [];
  const seenLinkedIds = new Set();
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
      linked = await ensureInvoiceReferenciaManualGre(companyRuc, company, ref, receptorFallback);
    }
    if (!linked) {
      const serie = String(ref.serie || '').trim();
      const correlativo = String(ref.correlativo || ref.numero || '').trim();
      const etiqueta = ref.id || `${serie}-${correlativo}` || 'desconocido';
      throw new Error(
        `No se pudo registrar la referencia del documento (${etiqueta}). `
          + 'Verifica tipo, serie, número y RUC del emisor.',
      );
    }

    const linkedId = String(linked.id || '').trim();
    if (linkedId && seenLinkedIds.has(linkedId)) continue;
    if (linkedId) seenLinkedIds.add(linkedId);

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
      orden: docs.length,
    });
    invoicesInternas.push(linked);
  }

  return { docs, invoicesInternas };
}

/**
 * Stub mínimo de compra recibida en `invoices` solo para FK GRE (`line_invoice_invoice`).
 * La fuente canónica del CPE recibido es `compras`; también se asegura esa fila.
 */
async function ensureInvoiceRecibidoDesdeRef(receptorCompany, ref, receptorFallback = null) {
  const receptorRuc = String(receptorCompany?.ruc || '').replace(/\D/g, '');
  const serie = String(ref.serie || '').trim().toUpperCase();
  let correlativoRaw = String(ref.correlativo || ref.numero || '').trim();
  if (correlativoRaw.includes('-') && !serie) {
    const parts = correlativoRaw.split('-');
    correlativoRaw = parts[parts.length - 1];
  }
  const correlativos = correlativosCandidatos(correlativoRaw);
  const correlativo = correlativos.includes(correlativoRaw.replace(/\D/g, '').padStart(8, '0'))
    ? correlativoRaw.replace(/\D/g, '').padStart(8, '0')
    : (correlativos[0] || correlativoRaw.replace(/\D/g, '') || correlativoRaw);
  const tipoDoc = normalizeTipoDocRef(ref.tipo_doc || ref.tipoDoc, '01') || '01';
  const emisor = extractEmisorFromRef(ref, receptorFallback || {});

  if (!receptorRuc || !serie || !correlativo || !emisor.numeroDoc) return null;
  if (emisor.numeroDoc === receptorRuc) return null;

  const emisorRuc = emisor.numeroDoc;

  // Mantener espejo en `compras` (listado app / inventario) solo si aún no existe:
  // este stub no conoce el XML y degradaría origen/fuente, destinatario y líneas
  // de un CPE ya importado (GRE del scraper, SIRE, SSPP).
  try {
    const compraModel = require('./compraModel');
    const yaEnCompras = await compraModel.findRowByClaveNatural(receptorRuc, {
      tipoDoc,
      serie,
      correlativo,
      proveedorNumeroDoc: emisorRuc,
    });
    if (!yaEnCompras) {
      await compraModel.upsertRecibidoFromParsed(receptorCompany, {
        tipo_doc: tipoDoc,
        serie,
        correlativo,
        fecha_emision: null,
        tipo_moneda: 'PEN',
        mto_imp_venta: null,
        proveedor: {
          tipo_doc: emisor.tipoDoc || '6',
          numero_doc: emisorRuc,
          razon_social: emisor.razonSocial || emisorRuc,
        },
        receptor: { numero_doc: receptorRuc },
        lineas: [],
      }, { fuente: 'sspp', reemplazarResumen: false });
    }
  } catch (err) {
    console.warn('[gre-stub] compra:', err.message);
  }

  const existente = await prisma.invoice.findFirst({
    where: {
      companyRuc: emisorRuc,
      tipoDoc,
      serie,
      correlativo: correlativos.length === 1 ? correlativos[0] : { in: correlativos },
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

/**
 * Stub de factura/boleta emitida por la empresa cuando el CPE no está en BD
 * (emitido antes del software o fuera de la plataforma). Solo para vincular GRE.
 */
async function ensureInvoiceEmitidoStubDesdeRef(companyRuc, ref) {
  const serie = String(ref.serie || '').trim().toUpperCase();
  let correlativoRaw = String(ref.correlativo || ref.numero || '').trim();
  if (correlativoRaw.includes('-') && !serie) {
    const parts = correlativoRaw.split('-');
    correlativoRaw = parts[parts.length - 1];
  }
  const correlativos = correlativosCandidatos(correlativoRaw);
  const correlativo = correlativos.includes(correlativoRaw.replace(/\D/g, '').padStart(8, '0'))
    ? correlativoRaw.replace(/\D/g, '').padStart(8, '0')
    : (correlativos[correlativos.length - 1] || correlativoRaw.replace(/\D/g, '') || correlativoRaw);
  const tipoDoc = normalizeTipoDocRef(ref.tipo_doc || ref.tipoDoc, '01') || '01';

  if (!serie || !correlativo) return null;

  const existente = await prisma.invoice.findFirst({
    where: {
      companyRuc,
      tipoDoc,
      serie,
      correlativo: correlativos.length === 1 ? correlativos[0] : { in: correlativos },
    },
    include: {
      details: { include: { catalogItem: true } },
      cliente: true,
    },
  });
  if (existente) return existente;

  const invoiceId = randomUUID();
  return prisma.invoice.create({
    data: {
      id: invoiceId,
      companyRuc,
      tipoDoc,
      serie,
      correlativo,
      fechaEmision: toStoredTimestamp(),
      tipoMoneda: 'PEN',
      estado: 'ACEPTADO',
      sunatEstadoDirecto: 'ACEPTADA',
      observacion: 'Referencia manual GRE (CPE no registrado en el sistema)',
    },
    include: {
      details: { include: { catalogItem: true } },
      cliente: true,
    },
  });
}

/**
 * Último recurso: acepta referencias manuales (serie + número + emisor) sin exigir
 * que el CPE exista en la BD. SUNAT validará la relación al emitir.
 */
async function ensureInvoiceReferenciaManualGre(companyRuc, company, ref, receptorFallback = null) {
  const emisor = extractEmisorFromRef(ref, {
    tipoDoc: '6',
    numeroDoc: companyRuc,
    razonSocial: company?.nombre || null,
  });
  const emisorRuc = String(emisor.numeroDoc || companyRuc || '').replace(/\D/g, '');
  const serie = String(ref.serie || '').trim().toUpperCase();
  const correlativo = String(ref.correlativo || ref.numero || '').trim();

  if (!serie || !correlativo) return null;

  // Factura/boleta propia (emisor = nuestra empresa) o sin emisor explícito.
  if (!emisorRuc || emisorRuc === String(companyRuc || '').replace(/\D/g, '')) {
    return ensureInvoiceEmitidoStubDesdeRef(companyRuc, ref);
  }

  // Tercero: reintentar stub recibido (compra / proveedor).
  return ensureInvoiceRecibidoDesdeRef(company, ref, receptorFallback);
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
      precioCompra: snapshotPrecioCompra(catalogItem),
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
    precioCompra: snapshotPrecioCompra(catalogItem),
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
  // correlativoInicio = último número ya usado (0 → el siguiente es 1)
  const seed = Math.max(0, Number.parseInt(String(options.correlativoInicio ?? 0), 10) || 0);
  const digitos = Number.parseInt(String(options.correlativoDigitos ?? 8), 10) || 8;

  const rows = await prisma.invoice.findMany({
    where: { companyRuc, tipoDoc, serie },
    select: { correlativo: true },
  });

  let current = 0;
  for (const row of rows) {
    const n = parseCorrelativoNumber(row.correlativo);
    if (Number.isFinite(n) && n > current) current = n;
  }

  const next = Math.max(current, seed) + 1;
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
    // El id es único global: no exigir que el cliente sea nuestro RUC
    // (en GRE-R el transportista suele ≠ destinatario).
    const byId = await prisma.invoice.findFirst({
      where: { id },
      include,
    });
    if (byId) return byId;

    // Id de compra recibida (tabla `compras`) → stub invoice solo para FK GRE.
    const compra = await prisma.compra.findFirst({
      where: { id, companyRuc: receptorRuc },
    });
    if (compra) {
      const company = await companyModel.findByRuc(receptorRuc);
      if (company) {
        const stub = await ensureInvoiceRecibidoDesdeRef(company, {
          tipo_doc: compra.tipoDoc,
          serie: compra.serie,
          correlativo: compra.correlativo,
          emisor_numero_doc: compra.proveedorNumeroDoc,
          emisor_razon_social: compra.proveedorRazonSocial,
          company: {
            numero_doc: compra.proveedorNumeroDoc,
            razon_social: compra.proveedorRazonSocial,
          },
        });
        return attachCompraLineasAsDetails(stub, compra);
      }
    }
  }

  const serie = String(ref.serie || '').trim();
  let correlativoRaw = String(ref.correlativo || ref.numero || '').trim();
  if (correlativoRaw.includes('-')) {
    const parts = correlativoRaw.split('-');
    correlativoRaw = parts[parts.length - 1];
  }
  const correlativos = correlativosCandidatos(correlativoRaw);
  if (!serie || !correlativos.length) return null;

  const tipoDoc = normalizeTipoDocRef(ref.tipo_doc || ref.tipoDoc, '') || undefined;
  const emisor = extractEmisorFromRef(ref, {});
  const emisorRuc = emisor.numeroDoc || null;

  const serieWhere = {
    serie,
    correlativo: correlativos.length === 1 ? correlativos[0] : { in: correlativos },
    ...(tipoDoc ? { tipoDoc } : {}),
  };

  // Recibido: company_ruc = emisor, cliente = nosotros O nosotros como transportista GRE-R.
  if (emisorRuc && emisorRuc !== receptorRuc) {
    const recibidas = await prisma.invoice.findMany({
      where: {
        companyRuc: emisorRuc,
        ...serieWhere,
      },
      include,
      take: 20,
    });
    const match = recibidas.find((row) => {
      if (row.cliente?.numeroDoc === receptorRuc) return true;
      return invoiceGreIncluyeRuc(row, receptorRuc);
    }) || recibidas[0];
    if (match) {
      if ((match.details || []).length) return match;
      // Si el stub no tiene detalle, enriquecer desde compra canónica.
      const compraModel = require('./compraModel');
      const compra = await compraModel.findRowByClaveNatural(receptorRuc, {
        tipoDoc: match.tipoDoc || tipoDoc || '01',
        serie: match.serie,
        correlativo: match.correlativo,
        proveedorNumeroDoc: emisorRuc,
      });
      return attachCompraLineasAsDetails(match, compra);
    }

    // Buscar en compras (fuente canónica de recibidos) y stubear invoice si hace falta.
    const compraModel = require('./compraModel');
    const compra = await compraModel.findRowByClaveNatural(receptorRuc, {
      tipoDoc: tipoDoc || '01',
      serie,
      correlativo: correlativos[0],
      proveedorNumeroDoc: emisorRuc,
    });
    if (compra) {
      const company = await companyModel.findByRuc(receptorRuc);
      if (company) {
        const stub = await ensureInvoiceRecibidoDesdeRef(company, {
          tipo_doc: compra.tipoDoc,
          serie: compra.serie,
          correlativo: compra.correlativo,
          emisor_numero_doc: compra.proveedorNumeroDoc,
          emisor_razon_social: compra.proveedorRazonSocial,
          company: {
            numero_doc: compra.proveedorNumeroDoc,
            razon_social: compra.proveedorRazonSocial,
          },
        });
        return attachCompraLineasAsDetails(stub, compra);
      }
    }
  }

  // Emitido por nosotros.
  return prisma.invoice.findFirst({
    where: {
      companyRuc: receptorRuc,
      ...serieWhere,
    },
    include,
  });
}

/** Detalle en memoria desde `compras.lineas` para poder armar bienes de la GRE. */
function attachCompraLineasAsDetails(invoice, compraRow) {
  if (!invoice) return invoice;
  if ((invoice.details || []).length > 0) return invoice;
  const lineas = Array.isArray(compraRow?.lineasJson) ? compraRow.lineasJson : [];
  if (!lineas.length) return invoice;
  invoice.details = lineas
    .map((l, idx) => {
      const desc = String(l.descripcion || l.nombre || '').trim();
      const cantidad = toNumber(l.cantidad, 0);
      if (!desc || cantidad <= 0) return null;
      return {
        id: l.id || `${invoice.id}-compra-${idx}`,
        catalogItemId: l.catalog_item_id || l.catalogItemId || null,
        descripcion: desc,
        nombre: l.nombre || desc,
        cantidad,
        unidad: String(l.unidad || 'NIU').trim() || 'NIU',
        mtoPrecioUnitario: toNumber(l.precio_unitario ?? l.mto_precio_unitario, 0),
        mtoValorUnitario: 0,
        mtoValorVenta: 0,
        mtoIgv: 0,
        mtoBaseIgv: 0,
        totalFactura: 0,
        tipAfeIgv: '30',
        porcentajeIgv: 0,
        productoSerieId: null,
        catalogItem: null,
      };
    })
    .filter(Boolean);
  return invoice;
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
    partida: envioBody.partida || (() => {
      const a = company?.addressJson || company?.address;
      return a ? { ubigeo: a.ubigeo, direccion: a.direccion } : undefined;
    })(),
    llegada: envioBody.llegada || (() => {
      const a = cliente?.addressJson || cliente?.address;
      return a ? { ubigeo: a.ubigeo, direccion: a.direccion } : undefined;
    })(),
    transportista: envioBody.transportista || undefined,
    vehiculo: envioBody.vehiculo || undefined,
    conductor: envioBody.conductor || undefined,
    nro_mtc: envioBody.nro_mtc || envioBody.nroMtc || envioBody.transportista?.nro_mtc || undefined,
    registrar_vehiculos_conductores:
      envioBody.registrar_vehiculos_conductores
      ?? envioBody.registrarVehiculosConductores
      ?? undefined,
    indicadores: Array.isArray(envioBody.indicadores) ? envioBody.indicadores : undefined,
  };

  // GRE por evento (RS 123 art. 19-B): marcar en guia_meta para listados / chips.
  if (truthyFlag(envioBody.gre_por_evento ?? envioBody.grePorEvento)) {
    envio.gre_por_evento = true;
  }
  const tipoEvento = String(envioBody.tipo_evento || envioBody.tipoEvento || '').trim();
  if (tipoEvento) envio.tipo_evento = tipoEvento;
  const descEvento = String(envioBody.descripcion_evento || envioBody.descripcionEvento || '').trim();
  if (descEvento) envio.descripcion_evento = descEvento;
  const citaTerminal = String(envioBody.cita_terminal || envioBody.citaTerminal || '').trim();
  if (citaTerminal) envio.cita_terminal = citaTerminal;

  // GRE-R: persistir flag e indicador SUNAT M1/L en guia_meta.
  const m1Raw = envioBody.traslado_vehiculo_m1_l ?? envioBody.trasladoVehiculoM1L;
  if (m1Raw != null && !esGreTransportistaBody(body)) {
    aplicarIndicadorVehiculoM1L(envio, truthyFlag(m1Raw));
  }

  const movimientoId = body.movimiento_id || body.movimientoId || envioBody.movimiento_id || null;
  const almacenDestinoId = body.almacen_destino_id
    || body.almacenDestinoId
    || envioBody.almacen_destino_id
    || null;
  if (movimientoId) envio.movimiento_id = movimientoId;
  if (almacenDestinoId) envio.almacen_destino_id = almacenDestinoId;

  const meta = { envio };
  const pagadorRaw = body.pagador_flete || body.pagadorFlete || envioBody.pagador_flete || null;
  if (pagadorRaw && typeof pagadorRaw === 'object') {
    const tipoDoc = String(pagadorRaw.tipo_doc || pagadorRaw.tipoDoc || '6').trim();
    const numeroDoc = String(
      pagadorRaw.numero_doc || pagadorRaw.numeroDoc || pagadorRaw.num_doc || pagadorRaw.ruc || '',
    ).replace(/\D/g, '');
    const razonSocial = String(
      pagadorRaw.razon_social || pagadorRaw.razonSocial || pagadorRaw.nombre || '',
    ).trim();
    let indicador = String(pagadorRaw.indicador || pagadorRaw.pagador || '').trim().toUpperCase();
    if (!indicador) {
      const remDoc = String(
        body.remitente?.numero_doc || body.remitente?.numeroDoc || body.remitente?.ruc || '',
      ).replace(/\D/g, '');
      indicador = (numeroDoc && remDoc && numeroDoc !== remDoc) ? 'TERCERO' : 'REMITENTE';
    }
    meta.pagador_flete = {
      indicador,
      tipo_doc: tipoDoc,
      numero_doc: numeroDoc,
      razon_social: razonSocial,
    };
    // Respaldo dentro de envio para lectores que solo miran envio.*
    envio.pagador_flete = meta.pagador_flete;
    if (esGreTransportistaBody(body)) {
      aplicarIndicadorPagadorFleteGreT(envio, indicador);
    }
  }
  return meta;
}

function normalizeStringArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim()).filter(Boolean);
  }
  return [];
}

/** Expande serie_ids / series[] a una línea por unidad (igual que movimientoModel). */
function expandLineasVentaEntrada(lineas) {
  const out = [];

  for (const linea of lineas || []) {
    const catalogItemId = String(linea.catalog_item_id || linea.catalogItemId || '').trim();
    const almacenId = String(linea.almacen_id || linea.almacenId || '').trim() || null;
    const precioOverride = linea.precio_unitario ?? linea.precioUnitario ?? null;
    const productoSerieId = String(linea.producto_serie_id || linea.productoSerieId || '').trim();
    const numeroSerie = String(linea.numero_serie || linea.numeroSerie || '').trim();
    const legacyIds = normalizeStringArray(linea.serie_ids || linea.serieIds);
    const legacyNumeros = normalizeStringArray(linea.series || linea.numeros_serie || linea.numerosSerie);
    const cantidad = toNumber(linea.cantidad, 1);
    const meta = { linea, almacenId, precioOverride };

    if (!catalogItemId) {
      out.push({
        ...meta,
        catalogItemId: '',
        cantidad,
        productoSerieId: productoSerieId || null,
        numeroSerie: numeroSerie || null,
      });
      continue;
    }

    if (productoSerieId) {
      out.push({
        ...meta,
        catalogItemId,
        cantidad: cantidad || 1,
        productoSerieId,
        numeroSerie: null,
      });
      continue;
    }
    if (numeroSerie) {
      out.push({
        ...meta,
        catalogItemId,
        cantidad: 1,
        productoSerieId: null,
        numeroSerie,
      });
      continue;
    }
    if (legacyIds.length > 0) {
      for (const id of legacyIds) {
        out.push({
          ...meta,
          catalogItemId,
          cantidad: 1,
          productoSerieId: id,
          numeroSerie: null,
        });
      }
      continue;
    }
    if (legacyNumeros.length > 0) {
      for (const num of legacyNumeros) {
        out.push({
          ...meta,
          catalogItemId,
          cantidad: 1,
          productoSerieId: null,
          numeroSerie: num,
        });
      }
      continue;
    }

    out.push({
      ...meta,
      catalogItemId,
      cantidad,
      productoSerieId: null,
      numeroSerie: null,
    });
  }

  return out;
}

function itemUsaSeriesInventario(catalogItem) {
  return Boolean(
    catalogItem?.manejaSerie
    && String(catalogItem.unidad || 'NIU').toUpperCase() === 'NIU',
  );
}

function mapLineasToSaleDetails(lineas, catalogMap, options = {}) {
  const omitSeriesValidation = options.omitSeriesValidation === true;
  const saleDetails = [];

  for (const row of expandLineasVentaEntrada(lineas)) {
    const {
      linea,
      catalogItemId,
      cantidad,
      productoSerieId,
      numeroSerie,
      almacenId,
      precioOverride,
    } = row;
    const catalogItem = catalogItemId ? catalogMap.get(catalogItemId) : null;

    if (!catalogItemId) {
      saleDetails.push({
        ...saleDetailDesdeLineaVentaLibre(linea, cantidad, precioOverride),
        productoSerieId,
        almacenId: null,
      });
      continue;
    }

    if (!catalogItem) {
      throw new Error(`Producto de catálogo no encontrado: ${catalogItemId}`);
    }

    if (itemUsaSeriesInventario(catalogItem) && !omitSeriesValidation) {
      if (cantidad !== 1) {
        throw new Error(
          `"${catalogItem.nombre}": cada unidad con serie debe ir en una línea con cantidad 1.`,
        );
      }
      if (!productoSerieId && !numeroSerie) {
        throw new Error(`"${catalogItem.nombre}": selecciona la serie de cada unidad.`);
      }
    }

    saleDetails.push({
      catalogItemId,
      productoSerieId,
      numeroSerie: numeroSerie || null,
      catalogItem,
      almacenId,
      ...calcularLinea(catalogItem, cantidad, precioOverride),
    });
  }

  return saleDetails;
}

/** Copia snapshot de la factura afectada cuando la NC referencia sale_detail_id. */
async function enrichLineasNotaCreditoDesdeDocumento(companyRuc, documentoAfectadoId, lineas) {
  if (!documentoAfectadoId || !Array.isArray(lineas) || lineas.length === 0) {
    return { lineas, detailsById: new Map() };
  }

  const doc = await prisma.invoice.findFirst({
    where: { id: documentoAfectadoId, companyRuc },
    include: { details: true },
  });
  if (!doc?.details?.length) return { lineas, detailsById: new Map() };

  const byId = new Map(doc.details.map((d) => [d.id, d]));

  const enrichedLineas = lineas.map((linea) => {
    const saleDetailId = String(linea.sale_detail_id || linea.saleDetailId || '').trim();
    if (!saleDetailId) return linea;

    const origen = byId.get(saleDetailId);
    if (!origen) return linea;

    const enriched = { ...linea };
    const serieId = String(enriched.producto_serie_id || enriched.productoSerieId || '').trim();
    if (!serieId && origen.productoSerieId) {
      enriched.producto_serie_id = origen.productoSerieId;
    }
    const almacenId = String(enriched.almacen_id || enriched.almacenId || '').trim();
    if (!almacenId && origen.almacenId) {
      enriched.almacen_id = origen.almacenId;
    }
    const catalogItemId = String(enriched.catalog_item_id || enriched.catalogItemId || '').trim();
    if (!catalogItemId && origen.catalogItemId) {
      enriched.catalog_item_id = origen.catalogItemId;
    }
    const precio = enriched.precio_unitario ?? enriched.precioUnitario;
    if ((precio == null || precio === '') && origen.mtoPrecioUnitario != null) {
      enriched.precio_unitario = toNumber(origen.mtoPrecioUnitario);
    }
    const tip = enriched.tip_afe_igv ?? enriched.tipAfeIgv ?? enriched.afectacion_igv ?? enriched.afectacionIgv;
    if (!tip && origen.tipAfeIgv) {
      enriched.tip_afe_igv = origen.tipAfeIgv;
    }
    const unidad = String(enriched.unidad || '').trim();
    if (!unidad && origen.unidad) {
      enriched.unidad = origen.unidad;
    }
    return enriched;
  });

  return { lineas: enrichedLineas, detailsById: byId };
}

/**
 * Montos de NC tomados del sale_detail original (í­tems mixtos, fracciones, IGV distinto).
 *
 * escalarPorPrecio es opt-in (lo activa el panel web con escalar_montos_por_precio):
 * la app móvil conserva el prorrateo histórico, que solo escala por cantidad.
 */
function saleDetailDesdeLineaDocumentoAfectado(
  origen,
  cantidadAcreditar,
  precioOverride,
  catalogItem = null,
  { escalarPorPrecio = false } = {},
) {
  const qtyOrig = toNumber(origen.cantidad);
  const qty = toNumber(cantidadAcreditar, qtyOrig);
  if (!(qty > 0)) {
    throw new Error('La cantidad a acreditar debe ser mayor a 0.');
  }

  const precioFacturado = toNumber(origen.mtoPrecioUnitario);
  const precio = precioOverride != null && precioOverride !== ''
    ? toNumber(precioOverride)
    : precioFacturado;

  const base = {
    catalogItemId: origen.catalogItemId || null,
    productoSerieId: origen.productoSerieId || null,
    numeroSerie: null,
    catalogItem,
    almacenId: origen.almacenId || null,
    descripcion: origen.descripcion || origen.nombre,
    nombre: origen.nombre || origen.descripcion,
    unidad: origen.unidad || 'NIU',
    tipAfeIgv: origen.tipAfeIgv || '10',
    codigo: origen.codigo || undefined,
    codigoSunat: origen.codigoSunat || undefined,
    precioCompra: snapshotPrecioCompra(origen) ?? snapshotPrecioCompra(catalogItem),
  };

  const creditoTotal = Math.abs(qty - qtyOrig) < 0.0001
    && (precioOverride == null || precioOverride === '' || Math.abs(precio - precioFacturado) < 0.009);

  if (creditoTotal) {
    return {
      ...base,
      cantidad: qtyOrig,
      mtoValorUnitario: toNumber(origen.mtoValorUnitario),
      mtoPrecioUnitario: precioFacturado,
      mtoBaseIgv: toNumber(origen.mtoBaseIgv),
      mtoValorVenta: toNumber(origen.mtoValorVenta),
      mtoIgv: toNumber(origen.mtoIgv),
      totalFactura: toNumber(origen.totalFactura),
      porcentajeIgv: toNumber(origen.porcentajeIgv, origen.tipAfeIgv === '10' ? 18 : 0),
    };
  }

  // Con escalarPorPrecio los montos se escalan por cantidad y por precio acreditado:
  // una NC de descuento por S/ 13 sobre un ítem de S/ 130 vale 13, no 130.
  const ratioCantidad = qtyOrig > 0 ? qty / qtyOrig : 1;
  const ratioPrecio = escalarPorPrecio && precioFacturado > 0 ? precio / precioFacturado : 1;
  const ratio = ratioCantidad * ratioPrecio;
  const porcentajeIgv = toNumber(origen.porcentajeIgv, origen.tipAfeIgv === '10' ? 18 : 0);

  if (escalarPorPrecio) {
    // SUNAT 3271: LineExtensionAmount debe ser cantidad × valor unitario.
    // Escalar vv y vu por separado (y volver a redondear vu a 4 decimales)
    // descuadra en cantidades grandes (p. ej. 35200 m).
    const vu = round4(toNumber(origen.mtoValorUnitario) * ratioPrecio);
    const vv = round4(vu * qty);
    const igv = round4(vv * (porcentajeIgv / 100));
    return {
      ...base,
      cantidad: qty,
      mtoValorUnitario: vu,
      mtoPrecioUnitario: precio,
      mtoBaseIgv: vv,
      mtoValorVenta: vv,
      mtoIgv: igv,
      totalFactura: round4(vv + igv),
      porcentajeIgv,
    };
  }

  return {
    ...base,
    cantidad: qty,
    mtoValorUnitario: round4(toNumber(origen.mtoValorUnitario) * ratioPrecio),
    mtoPrecioUnitario: precio,
    mtoBaseIgv: round4(toNumber(origen.mtoBaseIgv) * ratio),
    mtoValorVenta: round4(toNumber(origen.mtoValorVenta) * ratio),
    mtoIgv: round4(toNumber(origen.mtoIgv) * ratio),
    totalFactura: round4(toNumber(origen.totalFactura) * ratio),
    porcentajeIgv,
  };
}

function mapLineasNotaCreditoToSaleDetails(lineas, catalogMap, detailsById, opciones = {}) {
  const saleDetails = [];

  for (const row of expandLineasVentaEntrada(lineas)) {
    const {
      linea,
      catalogItemId,
      cantidad,
      productoSerieId,
      numeroSerie,
      almacenId,
      precioOverride,
    } = row;
    const saleDetailId = String(linea?.sale_detail_id || linea?.saleDetailId || '').trim();
    const origen = saleDetailId ? detailsById.get(saleDetailId) : null;

    if (origen) {
      const catalogItem = catalogItemId ? catalogMap.get(catalogItemId) : null;
      saleDetails.push(
        saleDetailDesdeLineaDocumentoAfectado(origen, cantidad, precioOverride, catalogItem, opciones),
      );
      continue;
    }

    if (!catalogItemId) {
      saleDetails.push({
        ...saleDetailDesdeLineaVentaLibre(linea, cantidad, precioOverride),
        productoSerieId,
        almacenId: null,
      });
      continue;
    }

    const catalogItem = catalogMap.get(catalogItemId);
    if (!catalogItem) {
      throw new Error(`Producto de catálogo no encontrado: ${catalogItemId}`);
    }

    const tipOverride = String(
      linea.tip_afe_igv || linea.tipAfeIgv || linea.afectacion_igv || linea.afectacionIgv || '',
    ).trim();
    const itemCalc = tipOverride
      ? { ...catalogItem, afectacionIgv: tipOverride }
      : catalogItem;

    saleDetails.push({
      catalogItemId,
      productoSerieId,
      numeroSerie: numeroSerie || null,
      catalogItem,
      almacenId,
      ...calcularLinea(itemCalc, cantidad, precioOverride),
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
    descripcion: String(detail.descripcion || '').slice(0, 500) || null,
    nombre: String(detail.nombre || detail.descripcion || '').slice(0, 255) || null,
    cantidad: detail.cantidad,
    unidad: String(detail.unidad || 'NIU').slice(0, 10) || 'NIU',
    mtoPrecioUnitario: detail.mtoPrecioUnitario ?? 0,
    tipAfeIgv: String(detail.tipAfeIgv || '30').slice(0, 4),
    mtoValorVenta: detail.mtoValorVenta ?? 0,
    mtoIgv: detail.mtoIgv ?? 0,
    totalFactura: detail.totalFactura ?? 0,
    mtoValorUnitario: detail.mtoValorUnitario ?? 0,
    mtoBaseIgv: detail.mtoBaseIgv ?? 0,
    porcentajeIgv: detail.porcentajeIgv ?? 0,
    estado: detail.estado || 'ACTIVO',
  };

  const precioCompraSnap = snapshotPrecioCompra(detail);
  if (precioCompraSnap != null) row.precioCompra = precioCompraSnap;

  if (detail.codigo) row.codigo = String(detail.codigo).slice(0, 64);
  if (detail.codigoSunat) row.codigoSunat = String(detail.codigoSunat).slice(0, 32);

  const catalogItemId = String(detail.catalogItemId || '').trim();
  if (catalogItemId) {
    row.catalogItem = { connect: { id: catalogItemId } };
  }

  const productoSerieId = String(detail.productoSerieId || '').trim();
  if (productoSerieId) {
    row.productoSerie = { connect: { id: productoSerieId } };
  }

  const almacenId = String(detail.almacenId || '').trim();
  if (almacenId) {
    row.almacen = { connect: { id: almacenId } };
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
      let restante = toNumber(linea.cantidad, 0);
      for (const detail of doc.details) {
        if (detail.catalogItemId !== catalogItemId || detail.estado !== 'ACTIVO') continue;
        if (restante <= 0.0001) break;
        idsToUpdate.add(detail.id);
        restante = round4(restante - toNumber(detail.cantidad));
      }
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
  const lineasActivas = (doc.details || []).filter(
    (d) => !d.estado || d.estado === 'ACTIVO',
  );
  if (lineasActivas.length === 0) {
    const ncAnulacion = await prisma.invoice.findFirst({
      where: {
        companyRuc,
        tipoDoc: '07',
        documentoAfectadoId,
        motivoCodigo: '01',
        estado: { in: ['ACEPTADO', 'ENVIADO'] },
      },
      select: { serie: true, correlativo: true },
    });
    if (ncAnulacion) {
      throw new Error(
        `Esta factura ya fue anulada con la nota de crédito `
          + `${ncAnulacion.serie}-${ncAnulacion.correlativo}.`,
      );
    }
    throw new Error(
      'El documento afectado ya no tiene ítems disponibles: fue anulado o acreditado por completo.',
    );
  }

  const acreditadas = new Map();
  const lineasPorSaleDetail = new Map();

  for (const lineaBody of lineasBody) {
    const saleDetailId = String(lineaBody?.sale_detail_id || lineaBody?.saleDetailId || '').trim();
    const cantidadAcreditar = toNumber(lineaBody?.cantidad);

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

    const catalogItemId = String(
      lineaBody?.catalog_item_id || lineaBody?.catalogItemId || '',
    ).trim();
    if (!catalogItemId) {
      throw new Error(
        'Cada línea de la nota de crédito debe referenciar una línea del documento afectado '
          + '(sale_detail_id), incluidas las de producto/servicio puntual.',
      );
    }

    const limite = limites.get(catalogItemId);
    if (!limite) {
      throw new Error(
        `El producto "${lineaBody?.nombre || catalogItemId}" no está disponible en el documento afectado. `
          + 'La nota de crédito solo puede incluir ítems activos de esa factura o boleta.',
      );
    }

    const prev = acreditadas.get(catalogItemId) || 0;
    acreditadas.set(catalogItemId, round4(prev + cantidadAcreditar));

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

/** Línea GRE sin catálogo (compra OCR / bienes libres) — montos 0. */
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

/**
 * Línea puntual de factura/boleta/ND sin catálogo (servicio u producto único).
 * Calcula IGV como un ítem normal; no descuenta inventario.
 */
function saleDetailDesdeLineaVentaLibre(linea, cantidad, precioOverride = null) {
  const nombre = String(linea.nombre || linea.descripcion || '').trim();
  if (!nombre) {
    throw new Error('La línea libre requiere nombre o descripción.');
  }
  const kind = String(linea.kind || linea.tipo || '').trim().toUpperCase();
  const unidadDefault = kind === 'SERVICE' ? 'ZZ' : 'NIU';
  const unidad = String(linea.unidad || unidadDefault).trim() || unidadDefault;
  const afectacion = String(
    linea.afectacion_igv || linea.afectacionIgv || linea.tip_afe_igv || '10',
  ).trim() || '10';
  const precio = precioOverride != null && precioOverride !== ''
    ? toNumber(precioOverride)
    : toNumber(linea.precio_unitario ?? linea.precioUnitario, 0);
  if (!(precio > 0)) {
    throw new Error(`La línea "${nombre}" requiere precio unitario mayor a 0.`);
  }

  const calc = calcularLinea(
    {
      nombre,
      descripcion: String(linea.descripcion || nombre).trim() || nombre,
      unidad,
      precioUnitario: precio,
      afectacionIgv: afectacion,
    },
    cantidad,
    precio,
  );

  return {
    catalogItemId: null,
    catalogItem: null,
    codigo: String(linea.codigo || '').trim().slice(0, 64) || null,
    codigoSunat: String(linea.codigo_sunat || linea.codigoSunat || '')
      .replace(/\D/g, '')
      .slice(0, 32) || null,
    ...calc,
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
    precio_compra: snapshotPrecioCompra(detail),
    producto_serie_id: detail.productoSerieId,
    estado: detail.estado || 'ACTIVO',
    almacen_id: detail.almacenId || null,
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
  const tipo = String(invoice.tipoDoc || '').padStart(2, '0');
  const meta = invoice.guiaMetaJson && typeof invoice.guiaMetaJson === 'object'
    ? invoice.guiaMetaJson
    : {};

  let documentos = documentosRelacionadosRows(invoice)
    .map((row) => toApiDocumentoRelacionado(row))
    .filter(Boolean);

  // Compat lectura: facturas_vinculadas / guia_remitente / meta.documentos_relacionados.
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
  if (!documentos.length && Array.isArray(meta.documentos_relacionados)) {
    documentos = meta.documentos_relacionados
      .filter((d) => d && (d.serie || d.correlativo))
      .map((d) => ({
        id: d.id || undefined,
        tipo_doc: d.tipo_doc || d.tipoDoc,
        serie: d.serie,
        correlativo: d.correlativo || d.numero,
        emisor_tipo_doc: d.emisor_tipo_doc || d.emisorTipoDoc || '6',
        emisor_numero_doc: d.emisor_numero_doc || d.emisorNumeroDoc || d.emisor,
        emisor_razon_social: d.emisor_razon_social || d.emisorRazonSocial,
      }));
  }

  // Factura/boleta: solo exponer relacionados (GRE, etc.) para PDF/UI.
  if (tipo === '01' || tipo === '03') {
    if (!documentos.length) return {};
    return {
      facturas: documentos,
      documentos_relacionados: documentos,
    };
  }

  if (!['09', '31'].includes(tipo)) return {};

  const envio = meta.envio && typeof meta.envio === 'object' ? meta.envio : undefined;

  if (!documentos.length && meta.guia_remitente?.serie && meta.guia_remitente?.correlativo) {
    documentos = [{
      id: meta.guia_remitente.id || undefined,
      tipo_doc: meta.guia_remitente.tipo_doc || '09',
      serie: meta.guia_remitente.serie,
      correlativo: meta.guia_remitente.correlativo,
      emisor_tipo_doc: meta.guia_remitente.emisor_tipo_doc || '6',
      emisor_numero_doc: meta.guia_remitente.emisor_numero_doc
        || meta.remitente?.numero_doc
        || invoice.companyRuc,
    }];
  }

  const guiaRemitente = meta.guia_remitente?.serie
    ? {
      tipo_doc: meta.guia_remitente.tipo_doc || '09',
      serie: meta.guia_remitente.serie,
      correlativo: meta.guia_remitente.correlativo,
      id: meta.guia_remitente.id || undefined,
    }
    : undefined;

  return {
    envio,
    facturas: documentos.length ? documentos : undefined,
    documentos_relacionados: documentos.length ? documentos : undefined,
    remitente: meta.remitente || undefined,
    guia_remitente: guiaRemitente,
    pagador_flete: meta.pagador_flete || meta.envio?.pagador_flete || undefined,
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

function buildNotasCreditoFacturaApiFields(invoice, options = {}) {
  const tipoDocStr = String(invoice.tipoDoc || '');
  if (!['01', '03'].includes(tipoDocStr)) return {};

  const notas = options.notasCreditoPorFactura?.get?.(invoice.id) || [];
  const detalles = invoice.details || [];
  const lineasActivas = detalles.filter((d) => !d.estado || d.estado === 'ACTIVO').length;

  const out = { lineas_activas_nc: lineasActivas };

  if (notas.length) {
    out.notas_credito_vinculadas = notas;
    const anulacion = notas.find((nc) => String(nc.motivo_codigo || '').trim() === '01');
    if (anulacion) {
      out.documento_anulado = true;
      out.nota_anulacion = `${anulacion.serie}-${anulacion.correlativo}`;
    }
  } else if (detalles.length > 0 && lineasActivas === 0) {
    out.sin_lineas_activas_nc = true;
  }

  return out;
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
  const esGuiaRemitenteInventario = tipoDocStr === '09';
  const esNotaCreditoInventario = tipoDocStr === '07';
  const movimientoSalidaId = (esVentaInventario || esGuiaRemitenteInventario)
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
    metodo_pago_id: invoice.metodoPagoId || undefined,
    metodo_pago: invoice.metodoPago
      ? {
          id: invoice.metodoPago.id,
          nombre: invoice.metodoPago.nombre,
          tipo: invoice.metodoPago.tipo,
          valor: invoice.metodoPago.valor,
        }
      : undefined,
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
    ...(esGuiaRemitenteInventario && movimientoSalidaId
      ? {
          inventario_estado: 'DESCONTADO',
          movimiento_salida_id: movimientoSalidaId,
        }
      : {}),
    ...(esNotaCreditoInventario
      ? {
          inventario_estado: movimientoEntradaNcId ? 'DEVUELTO' : 'PENDIENTE',
          movimiento_entrada_id: movimientoEntradaNcId || undefined,
        }
      : {}),
    ...buildNotasCreditoFacturaApiFields(invoice, options),
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
    (typeof emisorData?.error === 'string' ? emisorData.error : null) ||
    emisorData?.error?.mensaje ||
    emisorData?.error?.descripcion ||
    emisorData?.descripcion ||
    emisorData?.mensaje ||
    emisorData?.message ||
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
      cliente: true,
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
  let documentoAfectadoIdPrecheck = null;

  if (tipoConfig.tipoDoc === '09') {
    const docsBody = parseDocumentosRelacionadosBody(body);
    const tieneDocs = docsBody.length > 0;
    const clienteRow = await prisma.cliente.findFirst({
      where: { companyRuc, tipoDoc: receptor.tipoDoc, numeroDoc: receptor.numeroDoc },
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
      // CPE vinculado sin detalle en BD (lista sin ítems / stub): bienes genéricos para el XML.
      saleDetails = [
        saleDetailDesdeLineaLibre(
          { descripcion: 'BIENES TRASLADADOS', unidad: 'NIU', cantidad: 1 },
          1,
        ),
      ];
      guiaMetaJson = buildEnvioMeta(body, company, clienteRow);
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
    const clienteRow = await prisma.cliente.findFirst({
      where: { companyRuc, tipoDoc: receptor.tipoDoc, numeroDoc: receptor.numeroDoc },
          });
    const guiaRemitente = parseGuiaRemitenteRef(body);
    const docsBody = parseDocumentosRelacionadosBody(body);
    const refsRelacionados = docsBody.length > 0
      ? docsBody
      : (guiaRemitente
        ? [{
            ...guiaRemitente,
            emisor_tipo_doc: remitente.tipoDoc,
            emisor_numero_doc: remitente.numeroDoc,
            emisor_razon_social: remitente.razonSocial,
          }]
        : []);
    const envioMeta = buildEnvioMeta(
      {
        ...body,
        envio: {
          ...(body.envio && typeof body.envio === 'object' ? body.envio : {}),
          // GRE-T: emisor = transportista público.
          mod_traslado: body.envio?.mod_traslado || body.envio?.modTraslado || '01',
        },
      },
      company,
      clienteRow,
    );
    guiaMetaJson = {
      ...envioMeta,
      remitente: {
        tipo_doc: remitente.tipoDoc,
        numero_doc: remitente.numeroDoc,
        razon_social: remitente.razonSocial,
      },
    };
    if (refsRelacionados.length > 0) {
      const { docs } = await resolveDocumentosRelacionados(
        companyRuc,
        company,
        refsRelacionados.map((ref) => ({
          ...ref,
          emisor_tipo_doc: ref.emisor_tipo_doc || ref.emisorTipoDoc || remitente.tipoDoc,
          emisor_numero_doc: ref.emisor_numero_doc || ref.emisorNumeroDoc || ref.emisor || remitente.numeroDoc,
          emisor_razon_social: ref.emisor_razon_social || ref.emisorRazonSocial || remitente.razonSocial,
        })),
        remitente,
      );
      documentosRelacionadosCreate = docs;
    }
  } else {
    if (lineas.length === 0) {
      throw new Error('Debe incluir al menos una línea.');
    }

    let lineasParaDetalle = lineas;
    let ncDetailsById = new Map();
    if (tipoConfig.tipoDoc === '07' || tipoConfig.tipoDoc === '08') {
      documentoAfectadoIdPrecheck = await resolveDocumentoAfectadoId(
        companyRuc,
        body.documento_afectado || body.documentoAfectado,
      );
      // Web (escalar_montos_por_precio): NC y ND usan las líneas del documento
      // afectado. La app móvil de ND sigue el mapeo histórico (líneas libres).
      const webEscalaPrecio = body.escalar_montos_por_precio === true
        || body.escalarMontosPorPrecio === true;
      if (tipoConfig.tipoDoc === '07' || webEscalaPrecio) {
        const enriched = await enrichLineasNotaCreditoDesdeDocumento(
          companyRuc,
          documentoAfectadoIdPrecheck,
          lineas,
        );
        lineasParaDetalle = enriched.lineas;
        ncDetailsById = enriched.detailsById;
      }
    }

    const catalogMap = await loadCatalogItems(companyRuc, lineasParaDetalle);
    saleDetails = ncDetailsById.size > 0
      ? mapLineasNotaCreditoToSaleDetails(lineasParaDetalle, catalogMap, ncDetailsById, {
        escalarPorPrecio: body.escalar_montos_por_precio === true
          || body.escalarMontosPorPrecio === true,
      })
      : mapLineasToSaleDetails(lineasParaDetalle, catalogMap, {
        omitSeriesValidation: tipoConfig.tipoDoc === '07',
      });
    if (tipoConfig.tipoDoc === '08') {
      saleDetails = saleDetails.map((d) => ({
        ...d,
        productoSerieId: null,
        almacenId: null,
      }));
    }
    almacenId = String(body.almacen_id || body.almacenId || '').trim() || null;
    // Compat: si la venta trae almacén global y la línea de catálogo no envió almacen_id, hereda.
    if (almacenId) {
      saleDetails = saleDetails.map((d) => (
        d.catalogItemId && !d.almacenId ? { ...d, almacenId } : d
      ));
    } else {
      // Si solo vino almacén por línea, úsalo también a nivel de comprobante (inventario).
      const desdeLinea = saleDetails.map((d) => String(d.almacenId || '').trim()).find(Boolean);
      if (desdeLinea) {
        almacenId = desdeLinea;
      }
    }

    // Factura/boleta: vincular GRE u otros CPE (p. ej. guía de terceros).
    if (['01', '03'].includes(tipoConfig.tipoDoc)) {
      const docsBody = parseDocumentosRelacionadosBody(body);
      if (docsBody.length) {
        const { docs } = await resolveDocumentosRelacionados(
          companyRuc,
          company,
          docsBody,
          receptor,
        );
        documentosRelacionadosCreate = docs;
      }
    }
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
  const corregirId = String(body.comprobante_id || body.comprobanteId || '').trim();
  let existente = null;
  if (corregirId) {
    if (!['01', '03'].includes(tipoConfig.tipoDoc)) {
      throw Object.assign(new Error('Solo se corrige una factura o boleta rechazada.'), { status: 400 });
    }
    existente = await prisma.invoice.findFirst({
      where: { id: corregirId, companyRuc, tipoDoc: tipoConfig.tipoDoc },
    });
    if (!existente || String(existente.estado || '').toUpperCase().indexOf('RECHAZ') < 0) {
      throw Object.assign(new Error('Solo se puede corregir una factura o boleta rechazada.'), { status: 400 });
    }
  }

  const correlativo = existente
    ? existente.correlativo
    : await getNextCorrelativo(
    companyRuc,
    tipoConfig.tipoDoc,
    tipoConfig.serie,
    {
      correlativoInicio: tipoConfig.correlativoInicio,
      correlativoDigitos: tipoConfig.correlativoDigitos,
    },
  );

  let documentoAfectadoId = documentoAfectadoIdPrecheck || null;
  let motivoCodigo = null;
  let motivoNota = (body.motivo_nota || body.motivoNota || '').trim() || null;

  if (tipoConfig.tipoDoc === '07' || tipoConfig.tipoDoc === '08') {
    if (!documentoAfectadoId) {
      documentoAfectadoId = await resolveDocumentoAfectadoId(
        companyRuc,
        body.documento_afectado || body.documentoAfectado,
      );
    }
    motivoCodigo = String(body.motivo_codigo || body.motivoCodigo || '01').trim();
    if (!motivoNota) throw new Error('motivo_nota es obligatorio para notas.');
  }

  if (tipoConfig.tipoDoc === '07') {
    await validateNotaCreditoLineas(companyRuc, documentoAfectadoId, saleDetails, lineas);
  }

  if (tipoConfig.tipoDoc === '07' && motivoCodigo === '02') {
    const nuevaFactura = parseNuevaFacturaNota(body);
    if (!nuevaFactura) {
      throw new Error(
        'Para anulación por error en el RUC indica la nueva factura electrónica (serie y número).',
      );
    }
    guiaMetaJson = { ...(guiaMetaJson && typeof guiaMetaJson === 'object' ? guiaMetaJson : {}), nueva_factura: nuevaFactura };
  }

  const { parseSunatDatos, sunatParaBoleta } = require('../services/sunatDatosEmitir');
  let sunatParsed = ['01', '03'].includes(tipoConfig.tipoDoc) && (
    body.forma_pago || body.formaPago || body.sunat_datos || body.detraccion
  )
    ? parseSunatDatos(body)
    : null;
  if (sunatParsed && !sunatParsed.ok) {
    throw Object.assign(new Error(sunatParsed.error), { status: 400 });
  }
  if (sunatParsed?.ok && tipoConfig.tipoDoc === '03') {
    sunatParsed = { ok: true, datos: sunatParaBoleta(sunatParsed.datos) };
  }
  if (sunatParsed?.ok && tipoConfig.tipoDoc === '01') {
    const detraccionModel = require('./detraccionModel');
    const filas = await detraccionModel.listar();
    const detError = detraccionModel.aplicarCatalogo(filas, sunatParsed.datos);
    if (detError) throw Object.assign(new Error(detError), { status: 400 });
  }
  if (sunatParsed?.datos?.bloqueos?.length && tipoConfig.tipoDoc === '01') {
    throw Object.assign(new Error(
      `Marcaste Sí en: ${sunatParsed.datos.bloqueos.join(', ')}. Esa opción no se envía todavía a SUNAT. Elige No.`,
    ), { status: 400 });
  }
  if (sunatParsed?.ok) {
    guiaMetaJson = {
      ...(guiaMetaJson && typeof guiaMetaJson === 'object' ? guiaMetaJson : {}),
      sunat_emision: sunatParsed.datos,
    };
  }

  const invoiceId = existente ? existente.id : randomUUID();
  const archivosJson = parseArchivosBody(body);

  let metodoPagoId = null;
  if (['01', '03'].includes(tipoConfig.tipoDoc)) {
    const rawMetodo = String(body.metodo_pago_id || body.metodoPagoId || '').trim();
    if (rawMetodo) {
      const mp = await prisma.metodoPago.findFirst({
        where: { id: rawMetodo, companyRuc, activo: true },
        select: { id: true },
      });
      if (!mp) {
        throw Object.assign(new Error('Método de pago no válido o inactivo.'), { status: 400 });
      }
      metodoPagoId = mp.id;
    }
  }

  await prisma.$transaction(async (tx) => {
    const data = {
      id: invoiceId,
      companyRuc,
      tipoDoc: tipoConfig.tipoDoc,
      serie: tipoConfig.serie,
      correlativo,
      fechaEmision: toStoredTimestamp(),
      tipoMoneda: sunatParsed?.ok ? sunatParsed.datos.tipo_moneda : 'PEN',
      formaPago: sunatParsed?.ok
        ? (sunatParsed.datos.forma_pago === 'credito' ? 'Credito' : 'Contado')
        : 'Contado',
      fecVencimiento: sunatParsed?.ok && sunatParsed.datos.fecha_pago
        ? sunatParsed.datos.fecha_pago
        : undefined,
      tipoOperacion: sunatParsed?.ok ? sunatParsed.datos.tipo_operacion : undefined,
      metodoPagoId: metodoPagoId || undefined,
      observacion: (body.observaciones || body.observacion || '').trim() || null,
      mtoOperGravadas: montos.mtoOperGravadas,
      mtoOperExoneradas: montos.mtoOperExoneradas,
      mtoOperInafectas: montos.mtoOperInafectas,
      mtoIgv: montos.mtoIgv,
      totalImpuestos: montos.totalImpuestos,
      subTotal: montos.subTotal,
      mtoImpVenta: montos.mtoImpVenta,
      guiaMetaJson: guiaMetaJson || undefined,
      motivoCodigo: motivoCodigo || undefined,
      motivoNota: motivoNota || undefined,
      documentoAfectadoId: documentoAfectadoId || undefined,
      estado: 'BORRADOR',
      clienteId: clienteId || undefined,
      almacenId: almacenId || undefined,
      details: {
        create: saleDetails.map(toSaleDetailCreateInput),
      },
    };
    if (archivosJson && Object.keys(archivosJson).length) {
      data.archivosJson = archivosJson;
    }

    try {
      if (existente) {
        const { id, ...updateData } = data;
        updateData.serie = existente.serie;
        updateData.correlativo = existente.correlativo;
        updateData.fechaEmision = existente.fechaEmision;
        await tx.saleDetail.deleteMany({ where: { invoiceId: existente.id } });
        await tx.invoice.update({ where: { id: existente.id }, data: updateData });
      } else {
        await tx.invoice.create({ data });
      }
    } catch (err) {
      if (err?.name === 'PrismaClientValidationError' || err?.code?.startsWith?.('P')) {
        const detalle = String(err.message || '')
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean)
          .slice(0, 6)
          .join(' · ');
        const wrapped = new Error(
          `No se pudo guardar el comprobante (Prisma). ${detalle || err.message}`,
        );
        wrapped.cause = err;
        throw wrapped;
      }
      throw err;
    }
    if (documentosRelacionadosCreate.length) {
      await syncDocumentosRelacionados(tx, invoiceId, documentosRelacionadosCreate);
    }
  }, { timeout: 30000 });

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

/** NC aceptadas/enviadas vinculadas a facturas/boletas (para UI: “ya anulada”, etc.). */
async function loadNotasCreditoPorFacturaIds(companyRuc, facturaIds) {
  const ids = [...new Set((facturaIds || []).filter(Boolean))];
  if (!ids.length) return new Map();

  const rows = await prisma.invoice.findMany({
    where: {
      companyRuc,
      tipoDoc: '07',
      documentoAfectadoId: { in: ids },
      estado: { in: ['ACEPTADO', 'ENVIADO'] },
    },
    select: {
      id: true,
      documentoAfectadoId: true,
      serie: true,
      correlativo: true,
      motivoCodigo: true,
      motivoNota: true,
      estado: true,
    },
    orderBy: { fechaEmision: 'desc' },
  });

  const map = new Map();
  for (const row of rows) {
    const key = row.documentoAfectadoId;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push({
      id: row.id,
      serie: row.serie,
      correlativo: row.correlativo,
      motivo_codigo: row.motivoCodigo,
      motivo_nota: row.motivoNota,
      estado: resolveEstadoApi(row),
    });
  }
  return map;
}

async function findAllByCompany(
  companyRuc,
  { desde = null, hasta = null, apiBaseUrl = null, skip = null, take = null } = {},
) {
  const paginated = Number.isFinite(skip) && Number.isFinite(take);

  // fecha_emision se guarda como epoch-ms string (p. ej. "17557…"), NO como ISO.
  // Filtrar con gte/lte lexicográfico vs YYYY-MM-DD excluye casi todos los emitidos.
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

  const total = filtered.length;
  const pageRows = paginated
    ? filtered.slice(skip, skip + take)
    : filtered;

  const facturaMap = await loadFacturaRefMap(companyRuc, collectFacturaIdsFromGuias(pageRows));
  const ventaIds = pageRows
    .filter((row) => ['01', '03'].includes(row.tipoDoc))
    .map((row) => row.id);
  const guiaIds = pageRows
    .filter((row) => row.tipoDoc === '09')
    .map((row) => row.id);
  const ncIds = pageRows
    .filter((row) => row.tipoDoc === '07')
    .map((row) => row.id);
  const [salidaByVentaId, salidaByGuiaId, entradaByInvoiceId, notasCreditoPorFactura] = await Promise.all([
    loadSalidasPorComprobanteIds(companyRuc, ventaIds),
    loadSalidasPorGuiaRemisionIds(companyRuc, guiaIds),
    loadEntradasPorReferenciaIds(companyRuc, ncIds),
    loadNotasCreditoPorFacturaIds(companyRuc, ventaIds),
  ]);
  const salidaByInvoiceId = new Map([...salidaByVentaId, ...salidaByGuiaId]);

  const items = pageRows.map((row) =>
    toApiInvoice(row, {
      apiBaseUrl,
      companyRuc,
      includeSunatPayload: false,
      facturaMap,
      salidaByInvoiceId,
      entradaByInvoiceId,
      notasCreditoPorFactura,
    }),
  );

  if (paginated) return { items, total };
  return items;
}

const GRE_EVENTO_TIPOS = ['09', '31'];
const GRE_EVENTO_ESTADOS = ['ACEPTADO', 'ENVIADO'];
const GRE_EVENTO_LIST_SELECT = {
  id: true,
  tipoDoc: true,
  serie: true,
  correlativo: true,
  estado: true,
  fechaEmision: true,
  cliente: { select: { razonSocial: true, numeroDoc: true, tipoDoc: true } },
};
const GRE_EVENTO_DETAIL_SELECT = {
  ...GRE_EVENTO_LIST_SELECT,
  guiaMetaJson: true,
  details: {
    select: {
      descripcion: true,
      nombre: true,
      cantidad: true,
      unidad: true,
      catalogItemId: true,
    },
  },
};

function buildGreEventoWhere(companyRuc, q) {
  const where = {
    companyRuc: String(companyRuc || '').trim(),
    tipoDoc: { in: GRE_EVENTO_TIPOS },
    estado: { in: GRE_EVENTO_ESTADOS },
  };
  const term = String(q || '').trim();
  if (!term) return where;
  const digits = term.replace(/\D/g, '');
  const parts = term.split(/[\s-]+/).map((p) => p.trim()).filter(Boolean);
  const or = [
    { serie: { contains: term } },
    { correlativo: { contains: term } },
    { cliente: { razonSocial: { contains: term } } },
  ];
  if (digits) or.push({ cliente: { numeroDoc: { contains: digits } } });
  if (parts.length >= 2) {
    or.push({
      AND: [
        { serie: { contains: parts[0] } },
        { correlativo: { contains: parts[1] } },
      ],
    });
  }
  where.OR = or;
  return where;
}

function toGuiaEventoPickerItem(row, { detalle = false } = {}) {
  if (!row) return null;
  const dest = row.cliente || {};
  const item = {
    id: row.id,
    tipo_doc: String(row.tipoDoc || '').padStart(2, '0'),
    serie: row.serie,
    correlativo: row.correlativo,
    estado: row.estado,
    destinatario: dest.razonSocial || '',
    destinatario_doc: dest.numeroDoc || '',
    destinatario_tipo_doc: dest.tipoDoc || '6',
  };
  if (!detalle) return item;
  const meta = row.guiaMetaJson && typeof row.guiaMetaJson === 'object' ? row.guiaMetaJson : {};
  const envio = meta.envio && typeof meta.envio === 'object' ? meta.envio : {};
  const rem = meta.remitente || {};
  item.remitente = rem.razon_social || rem.nombre || '';
  item.remitente_doc = rem.numero_doc || rem.ruc || '';
  item.remitente_tipo_doc = rem.tipo_doc || '6';
  item.envio = envio;
  item.lineas = (row.details || []).map((d) => ({
    descripcion: d.descripcion || d.nombre || 'Ítem',
    nombre: d.nombre || d.descripcion || 'Ítem',
    cantidad: d.cantidad,
    unidad: d.unidad || 'NIU',
    catalog_item_id: d.catalogItemId || '',
  }));
  return item;
}

/**
 * GRE 09/31 aceptadas o enviadas para el selector de GRE por evento.
 * Pagina en MySQL (skip/take), sin cargar el resto de comprobantes.
 */
async function findGuiasParaEventoPaginated(companyRuc, { skip = 0, take = 10, q = '' } = {}) {
  const ruc = String(companyRuc || '').trim();
  if (!ruc) return { items: [], total: 0 };
  const where = buildGreEventoWhere(ruc, q);
  const start = Math.max(0, Number(skip) || 0);
  const size = Math.min(Math.max(1, Number(take) || 10), 100);
  const [total, rows] = await Promise.all([
    prisma.invoice.count({ where }),
    prisma.invoice.findMany({
      where,
      select: GRE_EVENTO_LIST_SELECT,
      orderBy: [{ fechaEmision: 'desc' }, { correlativo: 'desc' }],
      skip: start,
      take: size,
    }),
  ]);
  return {
    total,
    items: rows.map((row) => toGuiaEventoPickerItem(row)),
  };
}

async function findGuiaParaEventoById(companyRuc, id) {
  const ruc = String(companyRuc || '').trim();
  const guiaId = String(id || '').trim();
  if (!ruc || !guiaId) return null;
  const row = await prisma.invoice.findFirst({
    where: {
      id: guiaId,
      companyRuc: ruc,
      tipoDoc: { in: GRE_EVENTO_TIPOS },
      estado: { in: GRE_EVENTO_ESTADOS },
    },
    select: GRE_EVENTO_DETAIL_SELECT,
  });
  return toGuiaEventoPickerItem(row, { detalle: true });
}

/** Busca GRE 09/31 aceptada o enviada por serie/correlativo (baja manual). */
async function findGreAceptadaBySerie(companyRuc, { tipoDoc, serie, correlativo } = {}) {
  const ruc = String(companyRuc || '').trim();
  const s = String(serie || '').trim().toUpperCase();
  const digits = String(correlativo || '').replace(/\D/g, '');
  if (!ruc || !s || !digits) return null;
  const tipo = String(tipoDoc || '').padStart(2, '0');
  const variants = Array.from(new Set([
    digits,
    digits.replace(/^0+/, '') || '0',
    digits.padStart(8, '0'),
  ]));
  const where = {
    companyRuc: ruc,
    serie: s,
    correlativo: { in: variants },
    estado: { in: GRE_EVENTO_ESTADOS },
    tipoDoc: GRE_EVENTO_TIPOS.includes(tipo) ? tipo : { in: GRE_EVENTO_TIPOS },
  };
  return prisma.invoice.findFirst({
    where,
    select: { id: true, tipoDoc: true, serie: true, correlativo: true, estado: true },
    orderBy: { fechaEmision: 'desc' },
  });
}

/**
 * Facturas/boletas emitidas para elegir como documento afectado de una nota.
 * Devuelve una página liviana (sin detalles ni SUNAT) para el selector del panel web.
 */
async function findVentasParaNotaPaginated(
  companyRuc,
  { skip = 0, take = 10, q = '', clienteDoc = '', conLineasActivas = false } = {},
) {
  const ruc = String(companyRuc || '').trim();
  if (!ruc) return { items: [], total: 0 };

  const doc = String(clienteDoc || '').replace(/\D/g, '');
  const rows = await prisma.invoice.findMany({
    where: {
      companyRuc: ruc,
      tipoDoc: { in: ['01', '03'] },
      ...(doc ? { cliente: { numeroDoc: doc } } : {}),
      // Sin líneas por acreditar ya no se puede emitir otra nota de crédito.
      ...(conLineasActivas ? { details: { some: { estado: 'ACTIVO' } } } : {}),
    },
    select: {
      id: true,
      tipoDoc: true,
      serie: true,
      correlativo: true,
      fechaEmision: true,
      tipoMoneda: true,
      mtoImpVenta: true,
      estado: true,
      cliente: {
        select: { razonSocial: true, numeroDoc: true, tipoDoc: true },
      },
    },
  });

  const term = String(q || '').trim().toLowerCase();
  let filtered = rows;
  if (term) {
    filtered = rows.filter((row) => {
      const ref = `${row.serie || ''}-${row.correlativo || ''}`.toLowerCase();
      const nombre = String(row.cliente?.razonSocial || '').toLowerCase();
      const doc = String(row.cliente?.numeroDoc || '').toLowerCase();
      return ref.includes(term) || nombre.includes(term) || doc.includes(term);
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

  const start = Math.max(0, Number(skip) || 0);
  const size = Math.min(Math.max(1, Number(take) || 10), 100);

  return {
    total: filtered.length,
    items: filtered.slice(start, start + size).map((row) => ({
      id: row.id,
      tipo_doc: row.tipoDoc,
      serie: row.serie,
      correlativo: row.correlativo,
      fecha_emision: row.fechaEmision,
      tipo_moneda: row.tipoMoneda,
      mto_imp_venta: row.mtoImpVenta,
      estado: row.estado,
      cliente_razon_social: row.cliente?.razonSocial || '',
      cliente_numero_doc: row.cliente?.numeroDoc || '',
      cliente_tipo_doc: row.cliente?.tipoDoc || '6',
    })),
  };
}

/**
 * Líneas activas de una factura/boleta emitida, para armar notas por ítem
 * (descuento por ítem) desde el panel web.
 */
async function findLineasVentaParaNota(companyRuc, invoiceId) {
  const ruc = String(companyRuc || '').trim();
  const id = String(invoiceId || '').trim();
  if (!ruc || !id) return null;

  const invoice = await prisma.invoice.findFirst({
    where: { id, companyRuc: ruc, tipoDoc: { in: ['01', '03'] } },
    select: {
      id: true,
      tipoDoc: true,
      serie: true,
      correlativo: true,
      tipoMoneda: true,
      almacenId: true,
      details: {
        select: {
          id: true,
          codigo: true,
          descripcion: true,
          nombre: true,
          cantidad: true,
          unidad: true,
          mtoPrecioUnitario: true,
          catalogItemId: true,
          almacenId: true,
          estado: true,
          almacen: { select: { nombre: true } },
          productoSerie: { select: { numeroSerie: true, estado: true } },
          catalogItem: {
            select: { kind: true, manejaStock: true, manejaSerie: true },
          },
        },
      },
    },
  });
  if (!invoice) return null;

  // La NC solo devuelve stock si la venta descontó almacén (movimiento SALIDA vigente).
  const salida = await prisma.movimiento.findFirst({
    where: {
      companyRuc: ruc,
      comprobanteId: invoice.id,
      tipo: 'SALIDA',
      estado: { not: 'ANULADA' },
    },
    select: { id: true, almacenId: true, almacen: { select: { nombre: true } } },
  });

  const lineas = (invoice.details || [])
    .filter((d) => !d.estado || d.estado === 'ACTIVO')
    .map((d) => {
      const item = d.catalogItem;
      const inventariable = Boolean(
        d.catalogItemId
        && item
        && item.kind !== 'SERVICE'
        && (item.manejaStock || item.manejaSerie),
      );
      const almacenId = d.almacenId || invoice.almacenId || salida?.almacenId || '';
      // Con series solo retorna si la unidad sigue entregada al cliente.
      const serieRetornable = !item?.manejaSerie
        || !d.productoSerie
        || d.productoSerie.estado === 'ENTREGADO';
      return {
        id: d.id,
        codigo: d.codigo || '',
        descripcion: d.descripcion || d.nombre || 'Ítem',
        cantidad: toNumber(d.cantidad, 1),
        unidad: d.unidad || 'NIU',
        precio_unitario: toNumber(d.mtoPrecioUnitario, 0),
        catalog_item_id: d.catalogItemId || '',
        almacen_id: almacenId,
        almacen_nombre: d.almacen?.nombre || salida?.almacen?.nombre || '',
        numero_serie: d.productoSerie?.numeroSerie || '',
        maneja_serie: Boolean(item?.manejaSerie),
        retorna_almacen: Boolean(inventariable && salida && almacenId && serieRetornable),
      };
    });

  return {
    id: invoice.id,
    tipo_doc: invoice.tipoDoc,
    ref: `${invoice.serie || ''}-${invoice.correlativo || ''}`,
    tipo_moneda: invoice.tipoMoneda || 'PEN',
    almacen_id: salida?.almacenId || invoice.almacenId || '',
    almacen_nombre: salida?.almacen?.nombre || '',
    salida_registrada: Boolean(salida),
    lineas,
  };
}

/** Compras/recibidos: CPE que otras empresas emitieron hacia mi RUC
 * (destinatario/cliente), o GRE donde figuro como transportista/remitente. */
async function findComprasByCompany(companyRuc, { desde = null, hasta = null, apiBaseUrl = null } = {}) {
  const receptorRuc = String(companyRuc || '').trim();
  if (!receptorRuc) return [];

  const [asDestinatario, greCandidatas] = await Promise.all([
    prisma.invoice.findMany({
      where: {
        companyRuc: { not: receptorRuc },
        cliente: { numeroDoc: receptorRuc },
        estado: { in: ['ACEPTADO', 'ENVIADO'] },
        tipoDoc: { in: ['01', '03', '07', '08', '09', '31'] },
      },
      include: INVOICE_INCLUDE,
    }),
    prisma.invoice.findMany({
      where: {
        companyRuc: { not: receptorRuc },
        tipoDoc: { in: ['09', '31'] },
        estado: { in: ['ACEPTADO', 'ENVIADO'] },
        NOT: { cliente: { numeroDoc: receptorRuc } },
      },
      include: INVOICE_INCLUDE,
    }),
  ]);

  const byId = new Map();
  for (const row of asDestinatario) byId.set(row.id, row);
  for (const row of greCandidatas) {
    if (invoiceGreIncluyeRuc(row, receptorRuc)) byId.set(row.id, row);
  }
  const rows = [...byId.values()];

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

/** GRE 09: transportista en meta; GRE 31: remitente en meta. */
function invoiceGreIncluyeRuc(invoice, ruc) {
  const target = String(ruc || '').replace(/\D/g, '');
  if (!target || !invoice) return false;
  const tipo = String(invoice.tipoDoc || '').padStart(2, '0');
  if (tipo !== '09' && tipo !== '31') return false;
  const meta = invoice.guiaMetaJson && typeof invoice.guiaMetaJson === 'object'
    ? invoice.guiaMetaJson
    : {};
  const envio = meta.envio && typeof meta.envio === 'object' ? meta.envio : {};
  const transportistaDoc = String(
    envio.transportista?.num_doc
      || envio.transportista?.numero_doc
      || envio.transportista?.ruc
      || '',
  ).replace(/\D/g, '');
  const remitenteDoc = String(
    meta.remitente?.numero_doc
      || meta.remitente?.num_doc
      || meta.remitente?.ruc
      || '',
  ).replace(/\D/g, '');
  if (tipo === '09' && transportistaDoc === target) return true;
  if (tipo === '31' && remitenteDoc === target) return true;
  return false;
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
  });

  return { ...invoice, company };
}

/**
 * Emisor (company_ruc), receptor (cliente.numeroDoc) o parte GRE
 * (transportista / remitente en guia_meta) pueden acceder.
 */
async function findByIdForCompanyAccess(id, companyRuc) {
  const ruc = String(companyRuc || '').trim();
  if (!ruc) return null;

  let invoice = await prisma.invoice.findFirst({
    where: {
      id,
      OR: [
        { companyRuc: ruc },
        { cliente: { numeroDoc: ruc } },
      ],
    },
    include: INVOICE_INCLUDE,
  });
  if (!invoice) {
    const gre = await prisma.invoice.findFirst({
      where: {
        id,
        tipoDoc: { in: ['09', '31'] },
        companyRuc: { not: ruc },
      },
      include: INVOICE_INCLUDE,
    });
    if (gre && invoiceGreIncluyeRuc(gre, ruc)) invoice = gre;
  }
  if (!invoice) return null;

  // Company del emisor: el PDF muestra quién facturó.
  const company = await prisma.company.findFirst({
    where: { ruc: invoice.companyRuc },
  });

  return { ...invoice, company };
}

async function ensurePdfAtEmission(invoice, estado, apiBaseUrl) {
  // El PDF ya no se persiste (R2/disco): se regenera al descargar.
  // Se deja la función por compatibilidad; no escribe nada.
  if (!invoice || estado === 'BORRADOR') return null;
  return null;
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

  // Solo XML + CDR en storage. pdf_url queda null; el cliente usa el endpoint que regenera.

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
  const estado = resolveEstadoApi(invoice);

  // PDF A4/ticket: siempre regenerar con el diseño unificado (PDFKit).
  if (tipo === 'pdf') {
    if (estado === 'BORRADOR') return null;
    const buffer = await comprobantePdfService.generarPdfBuffer({ ...invoice, estado }, formato);
    if (!buffer) return null;
    return { buffer, contentType: 'application/pdf', ext: 'pdf' };
  }

  const stored = await comprobanteArchivosService.getArchivoBuffer(invoice, tipo);
  if (stored) return stored;

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
  if (!salidaByInvoiceId && tipo === '09') {
    salidaByInvoiceId = await loadSalidasPorGuiaRemisionIds(companyRuc, [invoice.id]);
  }
  if (!entradaByInvoiceId && tipo === '07') {
    entradaByInvoiceId = await loadEntradasPorReferenciaIds(companyRuc, [invoice.id]);
  }
  let notasCreditoPorFactura = options.notasCreditoPorFactura || null;
  if (!notasCreditoPorFactura && ['01', '03'].includes(tipo)) {
    notasCreditoPorFactura = await loadNotasCreditoPorFacturaIds(companyRuc, [invoice.id]);
  }
  return toApiInvoice(invoice, {
    ...options,
    companyRuc,
    facturaMap,
    salidaByInvoiceId,
    entradaByInvoiceId,
    notasCreditoPorFactura,
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

/**
 * Eliminación en lote para el panel web (borra de la BD, con devolución de stock si aplica).
 * @param {string} companyRuc
 * @param {string[]} ids
 */
async function deleteManyForCompany(companyRuc, ids = []) {
  const uniqueIds = [...new Set(
    (Array.isArray(ids) ? ids : [])
      .map((id) => String(id || '').trim())
      .filter(Boolean),
  )].slice(0, 100);

  if (!uniqueIds.length) {
    return { eliminados: 0, fallidos: [], items: [] };
  }

  const rows = await prisma.invoice.findMany({
    where: { companyRuc, id: { in: uniqueIds } },
    include: INVOICE_INCLUDE,
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const fallidos = [];
  const items = [];
  const comprobanteInventarioService = require('../services/comprobanteInventarioService');

  for (const id of uniqueIds) {
    const invoice = byId.get(id);
    if (!invoice) {
      fallidos.push({ id, message: 'No encontrado' });
      continue;
    }
    try {
      let inventario = null;
      try {
        inventario = await comprobanteInventarioService.revertirSalidaPorComprobante(invoice);
      } catch (_e) {
        inventario = { revertido: false, motivo: 'error_revertir' };
      }

      await prisma.invoice.updateMany({
        where: { documentoAfectadoId: id },
        data: { documentoAfectadoId: null },
      });
      await prisma.productoSerie.updateMany({
        where: { companyRuc, comprobanteId: id },
        data: { comprobanteId: null },
      });
      await prisma.invoice.delete({ where: { id } });

      items.push({
        id: invoice.id,
        serie: invoice.serie,
        correlativo: invoice.correlativo,
        estado: invoice.estado,
        inventario,
      });
    } catch (err) {
      fallidos.push({ id, message: err.message || 'No se pudo eliminar' });
    }
  }

  return {
    eliminados: items.length,
    fallidos,
    items,
  };
}

/** Aplica cambios del body mobile a un comprobante rechazado antes de reemitir. */
async function updateRejectedFromMobileRequest(id, companyRuc, body) {
  const invoice = await prisma.invoice.findFirst({
    where: { id, companyRuc, estado: 'RECHAZADO' },
    include: INVOICE_INCLUDE,
  });
  if (!invoice) return null;

  if (invoice.tipoDoc === '07') {
    const prevMeta = invoice.guiaMetaJson && typeof invoice.guiaMetaJson === 'object'
      ? invoice.guiaMetaJson
      : {};
    const motivoCodigo = String(body.motivo_codigo || body.motivoCodigo || invoice.motivoCodigo || '').trim();
    const guiaMetaJson = { ...prevMeta };
    if (motivoCodigo === '02') {
      const nuevaFactura = parseNuevaFacturaNota(body);
      if (nuevaFactura) guiaMetaJson.nueva_factura = nuevaFactura;
    }
    await prisma.invoice.update({
      where: { id },
      data: {
        guiaMetaJson,
        motivoCodigo: motivoCodigo || null,
        motivoNota: (body.motivo_nota || body.motivoNota || invoice.motivoNota || '').trim() || null,
        observacion: (body.observaciones || body.observacion || '').trim() || invoice.observacion,
      },
    });
    return findByIdForEmission(id, companyRuc);
  }

  if (!['09', '31'].includes(invoice.tipoDoc)) return invoice;

  const company = await findCompany(companyRuc);
  const clienteRow = invoice.cliente
    || (invoice.clienteId
      ? await prisma.cliente.findFirst({
          where: { id: invoice.clienteId },
                  })
      : null);

  const prevMeta = invoice.guiaMetaJson && typeof invoice.guiaMetaJson === 'object'
    ? invoice.guiaMetaJson
    : {};
  const envioMeta = buildEnvioMeta(body, company, clienteRow);

  const pagadorFlete = envioMeta.pagador_flete || prevMeta.pagador_flete || null;

  const guiaMetaJson = {
    envio: envioMeta.envio,
    ...(pagadorFlete ? { pagador_flete: pagadorFlete } : {}),
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
  findGuiasParaEventoPaginated,
  findGuiaParaEventoById,
  findGreAceptadaBySerie,
  findVentasParaNotaPaginated,
  findLineasVentaParaNota,
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
  deleteManyForCompany,
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
  invoiceGreIncluyeRuc,
  calcularLinea,
  snapshotPrecioCompra,
  INVOICE_INCLUDE,
};

const { randomUUID } = require('crypto');
const prisma = require('../config/prisma');
const companyModel = require('../models/companyModel');
const clienteModel = require('../models/clienteModel');
const catalogItemModel = require('../models/catalogItemModel');
const comprobanteModel = require('../models/comprobanteModel');
const { isProductionEntorno } = require('./credencialesSunatService');
const { getAccessToken, getSireAccessToken } = require('./sunatOauthService');
const { toStoredTimestamp } = require('../utils/fechas');
const {
  parseUblCompraXml,
  extractCpeArchivosFromPayload,
  extractCpeArchivosFromBuffer,
  decodePdfBase64,
} = require('./ublCompraParser');
const comprobanteArchivosService = require('./comprobanteArchivosService');
const { extractHashFromXml } = require('../utils/xmlHash');
const greScraperService = require('./greScraperService');

const ENVIOS_SP_URLS = [
  process.env.SUNAT_SSPP_URL || '',
  // En el JWT el recurso enviossp vive en api-cpe, no en api.sunat.gob.pe.
  'https://api-cpe.sunat.gob.pe/v1/contribuyente/enviossp',
  'https://api.sunat.gob.pe/v1/contribuyente/enviossp',
].filter(Boolean);

/**
 * Trae un CPE recibido (SSPP) y lo registra en `invoices`:
 *  - company_ruc = RUC del emisor (proveedor)
 *  - cliente     = nosotros (receptor)
 * Guarda en tabla `compras` (sentido RECIBIDO), sin mezclar con emitidos en `invoices`.
 *
 * Persiste el XML oficial (y el PDF solo si viene original / pdf_base64) en R2/Cloudflare.
 * No regenera ni altera el PDF del emisor.
 *
 * Solo producción. Requiere client_id / client_secret.
 */
async function traerYRegistrarCompra(companyRuc, body = {}, options = {}) {
  const company = await companyModel.findByRuc(companyRuc);
  if (!company) {
    const err = new Error('Empresa no encontrada.');
    err.status = 404;
    throw err;
  }

  if (!isProductionEntorno(company.entorno)) {
    const err = new Error(
      'SSPP Receptor solo está disponible con entorno producción (companies.entorno = prod).',
    );
    err.status = 403;
    throw err;
  }

  let xml = null;
  let pdfBuffer = decodePdfBase64(body.pdf_base64 || body.pdfBase64 || body.pdf) || null;
  const xmlB64 = body.xml_base64 || body.xmlBase64 || body.xml;
  if (xmlB64) {
    const raw = String(xmlB64).replace(/^data:[^;]+;base64,/, '').trim();
    if (raw.startsWith('<')) {
      xml = raw;
    } else {
      const archivos = await extractCpeArchivosFromBuffer(
        Buffer.from(raw.replace(/\s/g, ''), 'base64'),
      );
      xml = archivos.xml;
      if (!pdfBuffer && archivos.pdf) pdfBuffer = archivos.pdf;
    }
  } else {
    const descargado = await descargarCpeDesdeSunat(company, body);
    xml = descargado.xml;
    if (!pdfBuffer && descargado.pdf) pdfBuffer = descargado.pdf;
  }

  if (!xml) {
    const err = new Error(
      'SUNAT no devolvió un XML utilizable. Verifica emisor/serie/número/fecha/monto o pega xml_base64.',
    );
    err.status = 502;
    throw err;
  }

  const parsed = parseUblCompraXml(xml);
  if (body.tipo_doc || body.tipoDoc) {
    parsed.tipo_doc = String(body.tipo_doc || body.tipoDoc).trim() || parsed.tipo_doc;
  }

  return registrarInvoiceRecibido(company, parsed, {
    fuente: xmlB64 ? 'xml_manual' : 'sspp',
    reemplazarResumen: true,
    xml,
    pdfBuffer,
    apiBaseUrl: options.apiBaseUrl || null,
  });
}

/**
 * Intenta bajar el XML UBL del CPE vía SSPP Receptor.
 * Devuelve { parsed, xml, pdf } o null (sin lanzar) si SUNAT no lo entrega.
 */
async function intentarParsedDesdeSspp(company, params = {}) {
  try {
    const { xml, pdf } = await descargarCpeDesdeSunat(company, params);
    if (!xml) return null;
    return {
      parsed: parseUblCompraXml(xml),
      xml,
      pdf: pdf || null,
    };
  } catch (err) {
    console.warn(
      `[sspp] No hay XML ${params.serie || ''}-${params.correlativo || ''}:`,
      err.message,
    );
    return null;
  }
}

function esDetalleResumenImportado(invoice) {
  const obs = String(invoice?.observacion || '');
  if (/SIRE RCE/i.test(obs) && !/SSPP|XML/i.test(obs)) return true;
  const details = invoice?.details || [];
  if (!details.length) return true;
  if (details.length > 1) return false;
  const n = String(details[0].nombre || details[0].descripcion || '').trim();
  return (
    n.startsWith('Compra ·')
    || n.startsWith('Servicio ·')
    || /^\d{2}-[A-Z0-9]+-/i.test(n)
  );
}

function fuenteEsXml(fuente) {
  return fuente === 'sspp' || fuente === 'xml_manual' || fuente === 'sire_sspp';
}

async function buildSaleDetailsFromLineas(receptorCompany, emisorRuc, parsed, emisorNombre) {
  const lineasParsed = Array.isArray(parsed.lineas) ? [...parsed.lineas] : [];
  if (!lineasParsed.length && Number(parsed.mto_imp_venta) > 0) {
    const tipoEtiqueta = etiquetaTipoDocCpe(parsed.tipo_doc);
    const proveedor = emisorNombre || emisorRuc;
    const docRef = `${parsed.serie}-${parsed.correlativo}`;
    const nombre = `Compra · ${proveedor}`.slice(0, 255);
    lineasParsed.push({
      nombre,
      descripcion: `${nombre} · ${tipoEtiqueta} ${docRef}`.slice(0, 500),
      cantidad: 1,
      unidad: 'NIU',
      precio_unitario: Number(parsed.mto_imp_venta),
      codigo: `CMP-${emisorRuc}-${parsed.serie}-${parsed.correlativo}`.slice(0, 64),
      kind: 'PRODUCT',
    });
  }

  const saleDetails = [];
  for (const l of lineasParsed) {
    const cantidad = Number(l.cantidad) || 1;
    const precio = Number(l.precio_unitario) || 0;
    const valorVenta = Math.round(cantidad * (precio / 1.18) * 10000) / 10000;
    const igv = Math.round((cantidad * precio - valorVenta) * 10000) / 10000;
    const nombreLinea = String(l.nombre || l.descripcion || 'Compra').trim().slice(0, 255);
    const descripcionLinea = String(l.descripcion || nombreLinea).trim().slice(0, 500);

    let catalogItemId = null;
    const codigoLinea = String(l.codigo || l.cod_producto || '')
      .trim()
      .slice(0, 64) || null;
    const codigoSunatLinea = String(l.codigo_sunat || l.codigoSunat || '')
      .trim()
      .replace(/\D/g, '')
      .slice(0, 32) || null;
    if (!catalogItemModel.esLineaServicioCompra(l)) {
      try {
        const catalogItem = await catalogItemModel.findOrCreateForCompraLinea(receptorCompany.ruc, {
          nombre: nombreLinea,
          descripcion: descripcionLinea,
          unidad: l.unidad || 'NIU',
          precio_unitario: precio,
          codigo: codigoLinea,
          codigo_sunat: codigoSunatLinea,
          kind: l.kind,
        });
        catalogItemId = catalogItem?.id || null;
      } catch (err) {
        console.warn('[recibido] No se pudo enlazar catálogo:', err.message);
      }
    }

    saleDetails.push({
      catalogItemId,
      codigo: codigoLinea,
      codigoSunat: codigoSunatLinea,
      descripcion: descripcionLinea,
      nombre: nombreLinea,
      cantidad,
      unidad: l.unidad || 'NIU',
      mtoPrecioUnitario: precio,
      tipAfeIgv: '10',
      mtoValorUnitario: Math.round((precio / 1.18) * 10000) / 10000,
      mtoValorVenta: valorVenta,
      mtoBaseIgv: valorVenta,
      mtoIgv: igv,
      totalFactura: Math.round(cantidad * precio * 10000) / 10000,
      porcentajeIgv: 18,
      estado: 'ACTIVO',
    });
  }
  return saleDetails;
}

/**
 * emisor → company_ruc | receptor (nosotros) → cliente del emisor
 * Opciones: xml (string UBL), pdfBuffer (PDF original del emisor, sin regenerar),
 * apiBaseUrl, fuente, reemplazarResumen.
 */
async function registrarInvoiceRecibido(
  receptorCompany,
  parsed,
  {
    fuente,
    reemplazarResumen = false,
    xml = null,
    pdfBuffer = null,
    apiBaseUrl = null,
    forcePdf = false,
  } = {},
) {
  const compraModel = require('../models/compraModel');
  const emisorRuc = String(parsed.proveedor?.numero_doc || '').replace(/\D/g, '');
  const emisorNombre = String(parsed.proveedor?.razon_social || emisorRuc).trim();
  if (emisorRuc.length !== 11) {
    const err = new Error('El XML no tiene RUC emisor válido.');
    err.status = 400;
    throw err;
  }
  if (emisorRuc === receptorCompany.ruc) {
    const err = new Error('El emisor del comprobante no puede ser tu propio RUC.');
    err.status = 400;
    throw err;
  }

  const receptorEnXml = String(parsed.receptor?.numero_doc || '').replace(/\D/g, '');
  const tipoDocParsed = String(parsed.tipo_doc || '').padStart(2, '0');
  const esGre = tipoDocParsed === '09' || tipoDocParsed === '31';
  const fuenteGreScraper = String(fuente || '').toLowerCase() === 'gre_scraper'
    || String(parsed.origen || '').toUpperCase() === 'GRE_SCRAPER';
  const transportistaXml = String(
    parsed.transportista?.numero_doc
      || parsed.guia_meta?.envio?.transportista?.num_doc
      || parsed.guia_meta?.envio?.transportista?.numero_doc
      || '',
  ).replace(/\D/g, '');
  const remitenteXml = String(
    parsed.remitente?.numero_doc
      || parsed.guia_meta?.remitente?.numero_doc
      || parsed.guia_meta?.remitente?.num_doc
      || '',
  ).replace(/\D/g, '');
  const soyDestinatario = !receptorEnXml || receptorEnXml === receptorCompany.ruc;
  const soyTransportista = esGre && transportistaXml === receptorCompany.ruc;
  const soyRemitenteGreT = esGre && tipoDocParsed === '31' && remitenteXml === receptorCompany.ruc;
  const rolRecibido = String(parsed.guia_meta?.rol_recibido || '').toUpperCase();
  const aplicaGreScraper = fuenteGreScraper && esGre && emisorRuc !== receptorCompany.ruc
    && ['DESTINATARIO', 'TRANSPORTISTA', 'REMITENTE', 'RECIBIDO'].includes(rolRecibido);
  if (!soyDestinatario && !soyTransportista && !soyRemitenteGreT && !aplicaGreScraper) {
    const err = new Error(
      esGre
        ? `La guía no te incluye como destinatario, transportista ni remitente `
          + `(XML receptor ${receptorEnXml || '—'}; tu RUC ${receptorCompany.ruc}).`
        : `El XML es para el receptor ${receptorEnXml}, no para tu RUC ${receptorCompany.ruc}.`,
    );
    err.status = 400;
    throw err;
  }

  // Guardar en `compras` (no invoices) para no mezclar con emitidos.
  let result = await compraModel.upsertRecibidoFromParsed(receptorCompany, parsed, {
    fuente,
    reemplazarResumen,
  });

  const compra = result.compra;
  const synthetic = {
    id: compra.id,
    companyRuc: receptorCompany.ruc,
    tipoDoc: compra.tipoDoc,
    serie: compra.serie,
    correlativo: compra.correlativo,
    cliente: { tipoDoc: '6', numeroDoc: emisorRuc },
    xmlUrlDirecto: compra.xmlUrl,
    pdfUrl: compra.pdfUrl,
  };

  const filePatch = {};
  if (xml) {
    try {
      const savedXml = await comprobanteArchivosService.persistBuffer(
        synthetic,
        Buffer.from(String(xml), 'utf8'),
        'xml',
        apiBaseUrl,
      );
      if (savedXml?.url) filePatch.xmlUrl = savedXml.url;
      const hash = extractHashFromXml(String(xml));
      if (hash) filePatch.hashCpe = hash;
    } catch (err) {
      console.warn('[compra-recibido] XML:', err.message);
    }
  }
  if (pdfBuffer?.length && (!compra.pdfUrl || forcePdf)) {
    try {
      const savedPdf = await comprobanteArchivosService.persistBuffer(
        { ...synthetic, pdfUrl: compra.pdfUrl },
        pdfBuffer,
        'pdf',
        apiBaseUrl,
      );
      if (savedPdf?.url) filePatch.pdfUrl = savedPdf.url;
    } catch (err) {
      console.warn('[compra-recibido] PDF:', err.message);
    }
  }

  if (Object.keys(filePatch).length) {
    const updated = await prisma.compra.update({
      where: { id: compra.id },
      data: filePatch,
    });
    result = {
      ...result,
      compra: updated,
      invoice: compraModel.toApiInvoiceShape(updated),
    };
  }

  return {
    success: true,
    creado: result.creado,
    enriquecido: result.enriquecido,
    duplicado: result.duplicado,
    mensaje: result.creado
      ? 'Compra recibida registrada en tabla compras.'
      : (result.enriquecido
        ? 'Compra recibida enriquecida (ya existía).'
        : 'El CPE ya estaba en compras (sin duplicar).'),
    invoice: result.invoice,
    compra: result.invoice,
    fuente,
    archivos: {
      xml_url: result.compra.xmlUrl || null,
      pdf_url: result.compra.pdfUrl || null,
      pdf_original: Boolean(pdfBuffer?.length),
    },
  };
}

async function findInvoiceRecibidoExistente(emisorRuc, parsed) {
  const corr = String(parsed.correlativo || '').replace(/\D/g, '');
  const candidatos = [...new Set([
    String(parsed.correlativo || '').trim(),
    corr,
    corr ? corr.replace(/^0+/, '') || '0' : '',
    corr ? corr.padStart(8, '0') : '',
  ].filter(Boolean))];

  return prisma.invoice.findFirst({
    where: {
      companyRuc: emisorRuc,
      tipoDoc: parsed.tipo_doc,
      serie: parsed.serie,
      correlativo: candidatos.length === 1 ? candidatos[0] : { in: candidatos },
    },
    include: {
      cliente: true,
      details: true,
    },
  });
}

/**
 * Sube XML (y PDF original si hay) a R2/disco y actualiza columnas de `invoices`.
 * No inventa PDF: solo guarda bytes del emisor/SOL.
 */
async function persistArchivosRecibido(invoice, {
  xml = null,
  pdfBuffer = null,
  apiBaseUrl = null,
  forcePdf = false,
} = {}) {
  if (!invoice?.id) return invoice;
  const data = {};

  if (xml) {
    try {
      const savedXml = await comprobanteArchivosService.persistBuffer(
        invoice,
        Buffer.from(String(xml), 'utf8'),
        'xml',
        apiBaseUrl,
      );
      if (savedXml?.url) data.xmlUrlDirecto = savedXml.url;
      const hash = extractHashFromXml(String(xml));
      if (hash) data.hash = hash;
    } catch (err) {
      console.warn('[recibido] No se pudo guardar XML:', err.message);
    }
  }

  if (pdfBuffer?.length && (forcePdf || !invoice.pdfUrl)) {
    try {
      const savedPdf = await comprobanteArchivosService.persistBuffer(
        invoice,
        pdfBuffer,
        'pdf',
        apiBaseUrl,
      );
      if (savedPdf?.url) data.pdfUrl = savedPdf.url;
    } catch (err) {
      console.warn('[recibido] No se pudo guardar PDF original:', err.message);
    }
  }

  if (!Object.keys(data).length) return invoice;

  return prisma.invoice.update({
    where: { id: invoice.id },
    data,
    include: {
      cliente: true,
      details: true,
    },
  });
}

function etiquetaTipoDocCpe(tipo) {
  const t = String(tipo || '').padStart(2, '0');
  return (
    {
      '01': 'Factura',
      '03': 'Boleta',
      '07': 'Nota de crédito',
      '08': 'Nota de débito',
      '09': 'Guía de remisión',
      31: 'Guía transportista',
    }[t] || `Documento ${t}`
  );
}

function toRecibidoApi(invoice, emisorNombre) {
  const seller = {
    ruc: invoice.companyRuc,
    nombre: emisorNombre || invoice.companyRuc,
    nombreComercial: emisorNombre || null,
  };
  return comprobanteModel.toApiCompraInvoice(invoice, seller, {
    companyRuc: invoice.cliente?.numeroDoc,
    includeSunatPayload: false,
  });
}

/** Evita crear 2 stubs del mismo RUC si hay syncs concurrentes en el mismo proceso. */
const companyStubLocks = new Map();

/**
 * Stub mínimo del emisor para nombres en listados (GET /compras).
 * No es un tenant activo: sin credenciales, activo=false.
 * Idempotente: si el RUC ya existe (aunque haya corrida concurrente), no crea otro.
 */
async function ensureCompanyStub(emisorRuc, nombre) {
  const ruc = String(emisorRuc || '').replace(/\D/g, '').slice(0, 11);
  if (!ruc || ruc.length !== 11) {
    const err = new Error('emisor_ruc inválido para stub de empresa.');
    err.status = 400;
    throw err;
  }

  const pending = companyStubLocks.get(ruc);
  if (pending) return pending;

  const job = (async () => {
    const nombreLimpio = String(nombre || ruc).trim().slice(0, 255) || ruc;

    const pickCanonical = (rows) => {
      if (!rows?.length) return null;
      // Preferir tenant real (activo) sobre stub; si empatan, el más antiguo.
      return [...rows].sort((a, b) => {
        const aAct = a.activo === true ? 0 : 1;
        const bAct = b.activo === true ? 0 : 1;
        if (aAct !== bAct) return aAct - bAct;
        return Number(a.id) - Number(b.id);
      })[0];
    };

    let existing = pickCanonical(
      await prisma.company.findMany({ where: { ruc }, take: 20 }),
    );
    if (existing) {
      if ((!existing.nombre || existing.nombre === ruc) && nombreLimpio !== ruc) {
        try {
          await prisma.company.update({
            where: { id: existing.id },
            data: { nombre: nombreLimpio },
          });
          existing = { ...existing, nombre: nombreLimpio };
        } catch (_) {
          /* ignore */
        }
      }
      return existing;
    }

    try {
      return await prisma.company.create({
        data: {
          ruc,
          nombre: nombreLimpio,
          tipoDoc: '6',
          numeroDoc: ruc,
          entorno: 'prod',
          activo: false,
          tieneCertificado: false,
        },
      });
    } catch (err) {
      // Carrera: otro sync creó el mismo RUC entre el find y el create.
      if (err?.code === 'P2002' || /Unique constraint|Duplicate entry/i.test(String(err?.message || ''))) {
        const again = pickCanonical(
          await prisma.company.findMany({ where: { ruc }, take: 20 }),
        );
        if (again) return again;
      }
      // Sin unique en BD aún: re-buscar por si otro proceso insertó igual.
      const again = pickCanonical(
        await prisma.company.findMany({ where: { ruc }, take: 20 }),
      );
      if (again) return again;
      throw err;
    }
  })().finally(() => {
    companyStubLocks.delete(ruc);
  });

  companyStubLocks.set(ruc, job);
  return job;
}

async function ensureClienteReceptor(emisorRuc, receptorCompany) {
  const tipoDoc = '6';
  const numeroDoc = String(receptorCompany.ruc).replace(/\D/g, '');
  const razonSocial = String(
    receptorCompany.nombre || receptorCompany.nombreComercial || numeroDoc,
  ).trim();

  const existing = await clienteModel.findByDocumento(emisorRuc, tipoDoc, numeroDoc);
  if (existing) return existing;

  try {
    return await clienteModel.create({
      companyRuc: emisorRuc,
      tipoDoc,
      numeroDoc,
      razonSocial,
    });
  } catch (err) {
    if (err?.code === 'P2002' || /Unique constraint/i.test(String(err?.message || ''))) {
      const again = await clienteModel.findByDocumento(emisorRuc, tipoDoc, numeroDoc);
      if (again) return again;
    }
    throw err;
  }
}

function fechaEmisionToStored(fecha) {
  if (!fecha) return toStoredTimestamp();
  const v = String(fecha).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) {
    const [y, m, d] = v.slice(0, 10).split('-').map(Number);
    const ms = Date.UTC(y, m - 1, d, 17, 0, 0);
    return toStoredTimestamp(ms);
  }
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(v)) {
    const [d, m, y] = v.split('/').map(Number);
    const ms = Date.UTC(y, m - 1, d, 17, 0, 0);
    return toStoredTimestamp(ms);
  }
  return toStoredTimestamp();
}

async function descargarCpeDesdeSunat(company, body) {
  const tipoDoc = String(body.tipo_doc || body.tipoDoc || body.codComp || '01').trim().padStart(2, '0');
  if (tipoDoc === '09' || tipoDoc === '31') {
    return descargarGreDesdeScraper(company, body);
  }

  const emisorRuc = String(
    body.emisor_ruc || body.emisorRuc || body.numRuc || '',
  ).replace(/\D/g, '');
  const serie = String(body.serie || body.numeroSerie || '').trim().toUpperCase();
  const correlativo = String(body.correlativo || body.numero || body.numeroCorrelativo || '')
    .replace(/\D/g, '');
  const fechaRaw = String(body.fecha_emision || body.fechaEmision || '').trim();
  const monto = body.monto ?? body.mto_imp_venta ?? body.mtoImpVenta ?? null;

  if (!emisorRuc || emisorRuc.length !== 11) {
    const err = new Error('emisor_ruc (11 dígitos) es obligatorio para SSPP.');
    err.status = 400;
    throw err;
  }
  if (!serie || !correlativo) {
    const err = new Error('serie y correlativo son obligatorios para SSPP.');
    err.status = 400;
    throw err;
  }

  const token = await getSsppAccessToken(company);

  const payload = {
    numRuc: emisorRuc,
    codComp: tipoDoc.padStart(2, '0'),
    numeroSerie: serie,
    numero: Number(correlativo) || correlativo,
    fechaEmision: toSunatFecha(fechaRaw),
  };
  if (monto != null && monto !== '') {
    payload.monto = String(Number(monto).toFixed(2));
  }

  const attempts = [];
  const urlsToTry = [
    ...ENVIOS_SP_URLS,
    `https://api-cpe.sunat.gob.pe/v1/contribuyente/contribuyentes/${company.ruc}/enviossp`,
    `https://api.sunat.gob.pe/v1/contribuyente/contribuyentes/${company.ruc}/enviossp`,
  ];
  for (const url of [...new Set(urlsToTry.filter(Boolean))]) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const text = await res.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = text;
      }
      attempts.push({
        url,
        status: res.status,
        ok: res.ok,
        message: data?.message || data?.error_description || null,
      });

      if (!res.ok) continue;

      const archivos = await extractCpeArchivosFromPayload(data);
      if (archivos.xml) return archivos;

      if (typeof data === 'string') {
        const fromStr = await extractCpeArchivosFromPayload(data);
        if (fromStr.xml) return fromStr;
      }
    } catch (e) {
      attempts.push({ url, error: e.message });
    }
  }

  const forbidden = attempts.some((a) => a.status === 403);
  const unauthorized = attempts.some((a) => a.status === 401);
  const err = new Error(
    forbidden
      ? 'SUNAT SSPP (Envíos SP) respondió Forbidden (403). El recurso aparece en tu token, '
        + 'pero el API aún no deja consultar. Suele ser propagación en SOL, o el servicio '
        + 'solo aplica a ciertos perfiles. Mientras: descarga el XML/PDF en SOL (Comprobantes recibidos) '
        + 'y súbelo con POST /compras/sspp/traer (xml_base64 y opcional pdf_base64).'
      : unauthorized
        ? 'SUNAT SSPP respondió no autorizado. Revisa que el client_id tenga «Envíos SP» y que '
          + 'el client_id/secret en la empresa sea el de SOL. Alternativa: xml_base64.'
        : 'SSPP no devolvió XML con los parámetros enviados. '
          + 'Revisa emisor/serie/número/fecha/monto o envía xml_base64.',
  );
  err.status = forbidden || unauthorized ? 401 : 502;
  err.attempts = attempts;
  err.request = { ...payload, numero: String(payload.numero) };
  throw err;
}

/** GRE recibidas: scraper SOL (puerto 3001), no API SSPP. */
async function descargarGreDesdeScraper(company, body) {
  const { xml, pdf } = await greScraperService.descargarGreDocumento(company, body);
  if (xml) return { xml, pdf: pdf || null };

  const err = new Error(
    'Scraper GRE no devolvió XML para la guía indicada. '
      + 'Verifica emisor/serie/número/fecha o sincroniza el periodo completo (POST /compras/sincronizar).',
  );
  err.status = 502;
  throw err;
}

/** @deprecated Usar descargarCpeDesdeSunat; se mantiene por compatibilidad. */
async function descargarXmlDesdeSunat(company, body) {
  const { xml } = await descargarCpeDesdeSunat(company, body);
  return xml;
}

function toSunatFecha(value) {
  if (!value) return undefined;
  const v = String(value).trim();
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(v)) return v;
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) {
    const [y, m, d] = v.slice(0, 10).split('-');
    return `${d}/${m}/${y}`;
  }
  return v;
}

/**
 * Token SSPP: preferir password+SOL con scope api-cpe (donde está enviossp en el JWT).
 * Fallback: client_credentials.
 */
async function getSsppAccessToken(company) {
  const scopes = [
    process.env.SUNAT_SSPP_SCOPE,
    'https://api-cpe.sunat.gob.pe',
    process.env.SUNAT_API_SCOPE,
    'https://api.sunat.gob.pe/v1/contribuyente/contribuyentes',
  ].filter(Boolean);

  let lastErr = null;
  if (company.solUser && company.solPass) {
    for (const scope of scopes) {
      try {
        return await getSireAccessToken({
          clientId: company.clientId,
          clientSecret: company.clientSecret,
          ruc: company.ruc,
          solUser: company.solUser,
          solPass: company.solPass,
          scope,
        });
      } catch (e) {
        lastErr = e;
      }
    }
  }

  for (const scope of scopes) {
    try {
      return await getAccessToken({
        clientId: company.clientId,
        clientSecret: company.clientSecret,
        scope,
      });
    } catch (e) {
      lastErr = e;
    }
  }

  const err = new Error(
    'SUNAT rechazó el token para SSPP (Envíos SP). '
      + 'Verifica client_id/secret y usuario SOL en la empresa. '
      + `Detalle: ${lastErr?.message || 'sin detalle'}`,
  );
  err.status = 401;
  err.cause = lastErr;
  throw err;
}

module.exports = {
  traerYRegistrarCompra,
  registrarInvoiceRecibido,
  intentarParsedDesdeSspp,
  descargarCpeDesdeSunat,
  descargarXmlDesdeSunat,
  isProductionEntorno,
};

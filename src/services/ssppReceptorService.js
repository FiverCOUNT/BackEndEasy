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
  extractXmlFromPayload,
  extractXmlFromBuffer,
} = require('./ublCompraParser');
const comprobantePdfService = require('./comprobantePdfService');
const comprobanteArchivosService = require('./comprobanteArchivosService');

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
 * Así sale en GET /compras como sentido RECIBIDO y en GRE motivo compra.
 *
 * Solo producción. Requiere client_id / client_secret.
 */
async function traerYRegistrarCompra(companyRuc, body = {}) {
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
  const xmlB64 = body.xml_base64 || body.xmlBase64 || body.xml;
  if (xmlB64) {
    const raw = String(xmlB64).replace(/^data:[^;]+;base64,/, '').trim();
    if (raw.startsWith('<')) {
      xml = raw;
    } else {
      xml = await extractXmlFromBuffer(Buffer.from(raw.replace(/\s/g, ''), 'base64'));
    }
  } else {
    xml = await descargarXmlDesdeSunat(company, body);
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
  });
}

/**
 * Intenta bajar el XML UBL del CPE vía SSPP Receptor.
 * Devuelve parsed o null (sin lanzar) si SUNAT no lo entrega.
 */
async function intentarParsedDesdeSspp(company, params = {}) {
  try {
    const xml = await descargarXmlDesdeSunat(company, params);
    if (!xml) return null;
    return parseUblCompraXml(xml);
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
 */
async function registrarInvoiceRecibido(
  receptorCompany,
  parsed,
  { fuente, reemplazarResumen = false } = {},
) {
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
  if (receptorEnXml && receptorEnXml !== receptorCompany.ruc) {
    const err = new Error(
      `El XML es para el receptor ${receptorEnXml}, no para tu RUC ${receptorCompany.ruc}.`,
    );
    err.status = 400;
    throw err;
  }

  const existente = await prisma.invoice.findFirst({
    where: {
      companyRuc: emisorRuc,
      tipoDoc: parsed.tipo_doc,
      serie: parsed.serie,
      correlativo: parsed.correlativo,
    },
    include: {
      cliente: { include: { address: true } },
      details: true,
    },
  });
  if (existente) {
    const puedeEnriquecer = reemplazarResumen
      && fuenteEsXml(fuente)
      && esDetalleResumenImportado(existente)
      && Array.isArray(parsed.lineas)
      && parsed.lineas.length > 0;
    if (puedeEnriquecer) {
      const saleDetails = await buildSaleDetailsFromLineas(
        receptorCompany,
        emisorRuc,
        parsed,
        emisorNombre,
      );
      await prisma.saleDetail.deleteMany({ where: { invoiceId: existente.id } });
      const updated = await prisma.invoice.update({
        where: { id: existente.id },
        data: {
          subTotal: parsed.sub_total ?? existente.subTotal,
          mtoIgv: parsed.mto_igv ?? existente.mtoIgv,
          mtoImpVenta: parsed.mto_imp_venta ?? existente.mtoImpVenta,
          mtoOperGravadas: parsed.sub_total ?? existente.mtoOperGravadas,
          totalImpuestos: parsed.mto_igv ?? existente.totalImpuestos,
          tipoMoneda: parsed.tipo_moneda || existente.tipoMoneda,
          observacion: `Importado SIRE+SSPP · receptor ${receptorCompany.ruc}`,
          details: { create: saleDetails },
        },
        include: {
          cliente: { include: { address: true } },
          details: true,
        },
      });
      return {
        success: true,
        creado: false,
        enriquecido: true,
        duplicado: false,
        mensaje: 'Detalle SIRE reemplazado con líneas del XML (SSPP).',
        invoice: toRecibidoApi(updated, emisorNombre),
        fuente,
      };
    }
    return {
      success: true,
      creado: false,
      duplicado: true,
      mensaje: 'El CPE ya estaba registrado (company_ruc=emisor, cliente=tú).',
      invoice: toRecibidoApi(existente, emisorNombre),
      fuente,
    };
  }

  await ensureCompanyStub(emisorRuc, emisorNombre);

  const cliente = await ensureClienteReceptor(emisorRuc, receptorCompany);
  const fechaStored = fechaEmisionToStored(parsed.fecha_emision);
  const invoiceId = randomUUID();
  const saleDetails = await buildSaleDetailsFromLineas(
    receptorCompany,
    emisorRuc,
    parsed,
    emisorNombre,
  );

  const created = await prisma.invoice.create({
    data: {
      id: invoiceId,
      companyRuc: emisorRuc,
      tipoDoc: parsed.tipo_doc,
      serie: parsed.serie,
      correlativo: parsed.correlativo,
      fechaEmision: fechaStored,
      tipoMoneda: parsed.tipo_moneda || 'PEN',
      subTotal: parsed.sub_total,
      mtoIgv: parsed.mto_igv,
      mtoImpVenta: parsed.mto_imp_venta,
      mtoOperGravadas: parsed.sub_total,
      totalImpuestos: parsed.mto_igv,
      estado: 'ACEPTADO',
      sunatEstadoDirecto: 'ACEPTADA',
      observacion: (() => {
        if (fuente === 'sire_sspp') {
          return `Importado SIRE+SSPP · receptor ${receptorCompany.ruc}`;
        }
        if (fuente === 'sire_rce') {
          return `Importado SIRE RCE · receptor ${receptorCompany.ruc}`;
        }
        if (fuente === 'xml_manual') {
          return `Importado XML · receptor ${receptorCompany.ruc}`;
        }
        return `Importado SSPP · receptor ${receptorCompany.ruc}`;
      })(),
      clienteId: cliente.id,
      details: {
        create: saleDetails,
      },
    },
    include: {
      cliente: { include: { address: true } },
      details: true,
    },
  });

  const withEmisor = {
    ...created,
    company: {
      ruc: emisorRuc,
      nombre: emisorNombre,
      nombreComercial: emisorNombre,
      address: null,
    },
  };
  let pdfUrl = null;
  try {
    const buffer = await comprobantePdfService.generarPdfBuffer(withEmisor, 'a4');
    if (buffer?.length) {
      const saved = await comprobanteArchivosService.persistGeneratedPdf(created, buffer, null);
      pdfUrl = saved?.url || null;
      if (pdfUrl) {
        await prisma.invoice.update({
          where: { id: invoiceId },
          data: { pdfUrl },
        });
      }
    }
  } catch (err) {
    console.warn('[recibido] No se pudo generar PDF:', err.message);
  }

  return {
    success: true,
    creado: true,
    invoice: toRecibidoApi({ ...created, pdfUrl }, emisorNombre),
    fuente,
  };
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

/**
 * Stub mínimo del emisor para nombres en listados (GET /compras).
 * No es un tenant activo: sin credenciales, is_active=false.
 */
async function ensureCompanyStub(emisorRuc, nombre) {
  const existing = await companyModel.findByRuc(emisorRuc);
  if (existing) {
    if ((!existing.nombre || existing.nombre === emisorRuc) && nombre && nombre !== emisorRuc) {
      try {
        await prisma.company.update({
          where: { id: existing.id },
          data: { nombre: nombre.slice(0, 255) },
        });
      } catch (_) {
        /* ignore */
      }
    }
    return existing;
  }

  return prisma.company.create({
    data: {
      ruc: emisorRuc,
      nombre: (nombre || emisorRuc).slice(0, 255),
      tipoDoc: '6',
      numeroDoc: emisorRuc,
      entorno: 'prod',
      activo: false,
      isActive: false,
      tieneCertificado: false,
    },
  });
}

async function ensureClienteReceptor(emisorRuc, receptorCompany) {
  const tipoDoc = '6';
  const numeroDoc = String(receptorCompany.ruc).replace(/\D/g, '');
  const razonSocial = String(
    receptorCompany.nombre || receptorCompany.nombreComercial || numeroDoc,
  ).trim();

  const existing = await clienteModel.findByDocumento(emisorRuc, tipoDoc, numeroDoc);
  if (existing) return existing;

  return clienteModel.create({
    companyRuc: emisorRuc,
    tipoDoc,
    numeroDoc,
    razonSocial,
  });
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

async function descargarXmlDesdeSunat(company, body) {
  const emisorRuc = String(
    body.emisor_ruc || body.emisorRuc || body.numRuc || '',
  ).replace(/\D/g, '');
  const tipoDoc = String(body.tipo_doc || body.tipoDoc || body.codComp || '01').trim();
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

      const xml = await extractXmlFromPayload(data);
      if (xml) return xml;

      if (typeof data === 'string') {
        const fromStr = await extractXmlFromPayload(data);
        if (fromStr) return fromStr;
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
        + 'solo aplica a ciertos perfiles. Mientras: descarga el XML en SOL (Comprobantes recibidos) '
        + 'y súbelo con POST /compras/sspp/traer (xml_base64).'
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
  descargarXmlDesdeSunat,
  isProductionEntorno,
};

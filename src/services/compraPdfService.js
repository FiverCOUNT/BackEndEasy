/**
 * PDF de compras recibidas: misma representación formal A4 que comprobantes emitidos
 * (cabecera emisor/proveedor, adquiriente, detalle, totales, QR).
 * No sirve el PDF crudo de SUNAT en el área Compras; eso queda en pdf_url si existe.
 */
const comprobantePdfService = require('./comprobantePdfService');
const { displayName } = require('../models/companyModel');

async function fetchPdfOriginal(url) {
  if (!url) return null;
  try {
    const res = await fetch(String(url));
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 4 && buf.slice(0, 5).toString('utf8').startsWith('%PDF')) return buf;
    return null;
  } catch {
    return null;
  }
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Mapea compra API → forma Invoice que usa comprobantePdfService / comprobantePdfGre.
 * Emisor = proveedor; cliente/adquiriente = receptor (tu empresa).
 */
function compraToInvoiceShape(compra, receptorCompany = null) {
  const tipo = String(compra.tipo_doc || compra.tipoDoc || '').padStart(2, '0');
  const proveedor = compra.company || {};
  const receptorNombre = receptorCompany
    ? (displayName(receptorCompany) || receptorCompany.nombre || receptorCompany.ruc)
    : (compra.client?.nombre || compra.company_ruc || '—');
  const receptorRuc = receptorCompany?.ruc || compra.company_ruc || compra.client?.numero_doc || '';
  const receptorDir = receptorCompany
    ? [
      receptorCompany.direccion,
      receptorCompany.distrito,
      receptorCompany.provincia,
      receptorCompany.departamento,
    ].filter(Boolean).join(', ')
    : '';

  const lineas = Array.isArray(compra.details) ? compra.details : [];
  const details = lineas.map((line, idx) => {
    const cant = toNum(line.cantidad) || 1;
    const pu = toNum(
      line.mto_precio_unitario
      ?? line.mtoPrecioUnitario
      ?? line.precio_unitario
      ?? line.precioUnitario,
    );
    const valorVenta = toNum(
      line.mto_valor_venta
      ?? line.mtoValorVenta
      ?? line.total
      ?? (cant * pu),
    );
    const igv = toNum(line.mto_igv ?? line.mtoIgv);
    return {
      id: line.id || `${compra.id || 'c'}-${idx}`,
      codigo: line.codigo || undefined,
      codigo_sunat: line.codigo_sunat || line.codigoSunat || undefined,
      descripcion: line.descripcion || line.nombre || 'Ítem',
      nombre: line.nombre || line.descripcion || 'Ítem',
      cantidad: cant,
      unidad: line.unidad || 'NIU',
      tip_afe_igv: line.tip_afe_igv || line.tipAfeIgv || '10',
      mto_precio_unitario: pu,
      mtoPrecioUnitario: pu,
      mto_valor_venta: valorVenta,
      mtoValorVenta: valorVenta,
      mto_igv: igv,
      mtoIgv: igv,
      numero_serie: line.numero_serie || line.numeroSerie,
      producto_serie: line.producto_serie || line.productoSerie,
    };
  });

  const subTotal = toNum(compra.sub_total ?? compra.subTotal ?? compra.mto_oper_gravadas);
  const mtoIgv = toNum(compra.mto_igv ?? compra.mtoIgv);
  const total = toNum(compra.mto_imp_venta ?? compra.mtoImpVenta);
  const moneda = compra.tipo_moneda || compra.tipoMoneda || 'PEN';

  // GRE: destinatario = guia_meta.destinatario (DeliveryCustomerParty), NUNCA el transportista.
  const esGre = tipo === '09' || tipo === '31';
  const metaDest = compra.guia_meta?.destinatario || compra.guiaMetaJson?.destinatario || {};
  const clienteDest = (metaDest.numero_doc || metaDest.numeroDoc)
    ? metaDest
    : (compra.client || compra.cliente || {});
  const destDoc = String(clienteDest.numero_doc || clienteDest.numeroDoc || '').replace(/\D/g, '');
  const destNombre = clienteDest.razon_social || clienteDest.razonSocial
    || clienteDest.nombre || destDoc;
  const cliente = esGre && destDoc.length >= 8
    ? {
      tipoDoc: String(clienteDest.tipo_doc || clienteDest.tipoDoc || '6'),
      tipo_doc: String(clienteDest.tipo_doc || clienteDest.tipoDoc || '6'),
      numeroDoc: destDoc,
      numero_doc: destDoc,
      razonSocial: destNombre,
      razon_social: destNombre,
      direccion: clienteDest.direccion || '',
    }
    : {
      tipoDoc: '6',
      tipo_doc: '6',
      numeroDoc: receptorRuc,
      numero_doc: receptorRuc,
      razonSocial: receptorNombre,
      razon_social: receptorNombre,
      direccion: receptorDir,
    };

  return {
    ...compra,
    tipoDoc: tipo,
    tipo_doc: tipo,
    serie: compra.serie,
    correlativo: compra.correlativo,
    fechaEmision: compra.fecha_emision || compra.fechaEmision,
    fecha_emision: compra.fecha_emision || compra.fechaEmision,
    tipoMoneda: moneda,
    tipo_moneda: moneda,
    observacion: compra.observacion,
    estado: compra.estado || 'ACEPTADO',
    hash: compra.hash || compra.hashCpe || compra.hash_cpe,
    hashCpe: compra.hash || compra.hashCpe || compra.hash_cpe,
    mtoOperGravadas: subTotal,
    mto_oper_gravadas: subTotal,
    mtoOperExoneradas: toNum(compra.mto_oper_exoneradas ?? compra.mtoOperExoneradas),
    mtoOperInafectas: toNum(compra.mto_oper_inafectas ?? compra.mtoOperInafectas),
    mtoIgv,
    mto_igv: mtoIgv,
    mtoImpVenta: total,
    mto_imp_venta: total,
    subTotal,
    sub_total: subTotal,
    company: {
      ruc: proveedor.ruc || proveedor.numero_doc || '',
      nombre: proveedor.nombre || proveedor.razon_social || proveedor.ruc || 'Proveedor',
      nombreComercial: proveedor.nombreComercial || proveedor.nombre_comercial || null,
      direccion: proveedor.direccion || null,
      ubigeo: proveedor.ubigeo || null,
      distrito: proveedor.distrito || null,
      provincia: proveedor.provincia || null,
      departamento: proveedor.departamento || null,
      nroMtc: proveedor.nroMtc || proveedor.nro_mtc || null,
      logoUrl: proveedor.logoUrl || proveedor.logo_url || null,
    },
    cliente,
    client: cliente,
    details,
    guia_meta: compra.guia_meta || compra.guiaMetaJson,
    guiaMetaJson: compra.guia_meta || compra.guiaMetaJson,
    envio: compra.envio,
    documentos_relacionados: compra.documentos_relacionados || compra.facturas,
    facturas: compra.facturas || compra.documentos_relacionados,
    motivo_codigo: compra.motivo_codigo || compra.motivoCodigo,
    motivo_nota: compra.motivo_nota || compra.motivoNota,
    documento_afectado: compra.documento_afectado || compra.documentoAfectado,
  };
}

/**
 * @param {object} compraShape forma API de compraModel.toApiInvoiceShape
 * @param {object|null} receptorCompany company del receptor (tu empresa)
 * @param {{ preferOriginal?: boolean }} options Solo true si se pide el PDF crudo SUNAT.
 */
async function generarPdfBuffer(compraShape, receptorCompany = null, options = {}) {
  const preferOriginal = options.preferOriginal === true;
  const compra = compraShape || {};

  if (preferOriginal) {
    const pdfUrl = compra.pdf_url || compra.pdfUrl;
    const original = await fetchPdfOriginal(pdfUrl);
    if (original) return original;
  }

  const invoice = compraToInvoiceShape(compra, receptorCompany);
  return comprobantePdfService.generarPdfBuffer(invoice, 'a4');
}

module.exports = {
  generarPdfBuffer,
  compraToInvoiceShape,
};

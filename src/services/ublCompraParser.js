const { XMLParser } = require('fast-xml-parser');
const JSZip = require('jszip');

/**
 * Parsea XML UBL (Invoice / CreditNote / DebitNote) a un body compatible con compraModel.create.
 */
function parseUblCompraXml(xmlString) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: true,
    trimValues: true,
  });
  const root = parser.parse(String(xmlString || ''));
  const doc = root.Invoice || root.CreditNote || root.DebitNote;
  if (!doc) {
    const err = new Error('El XML no es un CPE UBL (Invoice/CreditNote/DebitNote).');
    err.status = 400;
    throw err;
  }

  const tipoDoc = String(
    doc.InvoiceTypeCode?.['#text']
      || doc.InvoiceTypeCode
      || (root.CreditNote ? '07' : root.DebitNote ? '08' : '01'),
  ).trim() || '01';

  const idFull = String(doc.ID?.['#text'] || doc.ID || '').trim();
  let serie = '';
  let correlativo = '';
  if (idFull.includes('-')) {
    const [s, c] = idFull.split('-');
    serie = String(s || '').trim().toUpperCase();
    correlativo = String(c || '').replace(/\D/g, '');
  }

  const fechaEmision = String(doc.IssueDate?.['#text'] || doc.IssueDate || '').trim() || null;
  const tipoMoneda = String(
    doc.DocumentCurrencyCode?.['#text'] || doc.DocumentCurrencyCode || 'PEN',
  ).trim() || 'PEN';

  const supplier = doc.AccountingSupplierParty?.Party || {};
  const supplierId = firstPartyId(supplier);
  const proveedorNumeroDoc = String(supplierId?.ID?.['#text'] || supplierId?.ID || '')
    .replace(/\D/g, '');
  const proveedorRazonSocial = String(
    supplier.PartyLegalEntity?.RegistrationName?.['#text']
      || supplier.PartyLegalEntity?.RegistrationName
      || supplier.PartyName?.Name?.['#text']
      || supplier.PartyName?.Name
      || '',
  ).trim();

  const customer = doc.AccountingCustomerParty?.Party || {};
  const customerId = firstPartyId(customer);
  const receptorNumeroDoc = String(customerId?.ID?.['#text'] || customerId?.ID || '')
    .replace(/\D/g, '');
  const receptorRazonSocial = String(
    customer.PartyLegalEntity?.RegistrationName?.['#text']
      || customer.PartyLegalEntity?.RegistrationName
      || customer.PartyName?.Name?.['#text']
      || customer.PartyName?.Name
      || '',
  ).trim();

  const monetary = Array.isArray(doc.LegalMonetaryTotal)
    ? doc.LegalMonetaryTotal[0]
    : doc.LegalMonetaryTotal;
  const taxTotal = Array.isArray(doc.TaxTotal) ? doc.TaxTotal[0] : doc.TaxTotal;

  const mtoImpVenta = toNum(
    monetary?.PayableAmount?.['#text'] ?? monetary?.PayableAmount,
  );
  const subTotal = toNum(
    monetary?.LineExtensionAmount?.['#text']
      ?? monetary?.LineExtensionAmount
      ?? monetary?.TaxExclusiveAmount?.['#text']
      ?? monetary?.TaxExclusiveAmount,
  );
  const mtoIgv = toNum(taxTotal?.TaxAmount?.['#text'] ?? taxTotal?.TaxAmount);

  const linesRaw = Array.isArray(doc.InvoiceLine)
    ? doc.InvoiceLine
    : (doc.InvoiceLine ? [doc.InvoiceLine] : []);
  const creditLines = Array.isArray(doc.CreditNoteLine)
    ? doc.CreditNoteLine
    : (doc.CreditNoteLine ? [doc.CreditNoteLine] : []);
  const debitLines = Array.isArray(doc.DebitNoteLine)
    ? doc.DebitNoteLine
    : (doc.DebitNoteLine ? [doc.DebitNoteLine] : []);
  const lines = linesRaw.length ? linesRaw : (creditLines.length ? creditLines : debitLines);

  const lineas = lines.map((line) => {
    const qty = toNum(
      line.InvoicedQuantity?.['#text']
        ?? line.InvoicedQuantity
        ?? line.CreditedQuantity?.['#text']
        ?? line.CreditedQuantity
        ?? line.DebitedQuantity?.['#text']
        ?? line.DebitedQuantity
        ?? 0,
    );
    const unidad = String(
      line.InvoicedQuantity?.['@_unitCode']
        || line.CreditedQuantity?.['@_unitCode']
        || line.DebitedQuantity?.['@_unitCode']
        || 'NIU',
    ).trim() || 'NIU';
    const item = line.Item || {};
    const descripcion = String(
      item.Description?.['#text']
        || item.Description
        || item.Name?.['#text']
        || item.Name
        || 'Ítem',
    ).trim();
    const codigo = String(
      item.SellersItemIdentification?.ID?.['#text']
        || item.SellersItemIdentification?.ID
        || '',
    ).trim() || null;
    const codigoSunatRaw = String(
      item.CommodityClassification?.ItemClassificationCode?.['#text']
        || item.CommodityClassification?.ItemClassificationCode
        || '',
    ).trim();
    const codigoSunat = /^\d{8}$/.test(codigoSunatRaw.replace(/\D/g, ''))
      ? codigoSunatRaw.replace(/\D/g, '').slice(0, 8)
      : null;
    const precio = precioUnitarioDesdeLineaUbl(line);
    const kind = String(unidad || '').toUpperCase() === 'ZZ'
      || String(unidad || '').toUpperCase() === 'ZZZ'
      ? 'SERVICE'
      : 'PRODUCT';
    return {
      codigo,
      codigo_sunat: codigoSunat,
      nombre: descripcion.slice(0, 255),
      descripcion,
      cantidad: qty || 1,
      unidad,
      precio_unitario: precio || 0,
      kind,
    };
  }).filter((l) => l.descripcion);

  if (!serie || !correlativo) {
    const err = new Error(`XML sin serie/correlativo válido (ID=${idFull || 'vacío'}).`);
    err.status = 400;
    throw err;
  }
  if (!proveedorNumeroDoc || proveedorNumeroDoc.length !== 11) {
    const err = new Error('XML sin RUC de emisor (proveedor) de 11 dígitos.');
    err.status = 400;
    throw err;
  }
  if (!lineas.length) {
    const err = new Error('El XML no tiene líneas de detalle utilizables.');
    err.status = 400;
    throw err;
  }

  return {
    tipo_doc: tipoDoc,
    serie,
    correlativo,
    fecha_emision: fechaEmision,
    tipo_moneda: tipoMoneda,
    proveedor: {
      tipo_doc: '6',
      numero_doc: proveedorNumeroDoc,
      razon_social: proveedorRazonSocial || proveedorNumeroDoc,
    },
    receptor: {
      tipo_doc: '6',
      numero_doc: receptorNumeroDoc || null,
      razon_social: receptorRazonSocial || null,
    },
    sub_total: subTotal,
    mto_igv: mtoIgv,
    mto_imp_venta: mtoImpVenta,
    lineas,
    origen: 'SSPP',
    en_camino: false,
  };
}

function firstPartyId(party) {
  const ids = party?.PartyIdentification;
  if (!ids) return null;
  return Array.isArray(ids) ? ids[0] : ids;
}

/** Preferencia: precio unitario con IGV (código 01) → PriceAmount → otros. */
function precioUnitarioDesdeLineaUbl(line) {
  const refs = line?.PricingReference?.AlternativeConditionPrice;
  const list = Array.isArray(refs) ? refs : (refs ? [refs] : []);
  const conIgv = list.find((r) => {
    const code = String(r?.PriceTypeCode?.['#text'] || r?.PriceTypeCode || '').trim();
    return code === '01';
  });
  const anyRef = conIgv || list[0];
  return toNum(
    anyRef?.PriceAmount?.['#text']
      ?? anyRef?.PriceAmount
      ?? line?.Price?.PriceAmount?.['#text']
      ?? line?.Price?.PriceAmount
      ?? line?.LineExtensionAmount?.['#text']
      ?? line?.LineExtensionAmount,
  );
}

function toNum(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function extractXmlFromPayload(payload) {
  if (!payload) return null;
  if (typeof payload === 'string') {
    const trimmed = payload.trim();
    if (trimmed.startsWith('<')) return trimmed;
    if (/^[A-Za-z0-9+/=\r\n]+$/.test(trimmed) && trimmed.length > 80) {
      const buf = Buffer.from(trimmed.replace(/\s/g, ''), 'base64');
      return extractXmlFromBuffer(buf);
    }
    return null;
  }
  if (typeof payload === 'object') {
    const candidates = [
      payload.xml,
      payload.archivo_xml,
      payload.arcXml,
      payload.contenido,
      payload.contenidoXml,
      payload.archivo?.arcGreZip,
      payload.archivo?.contenido,
      payload.archivo?.xml,
      payload.data?.xml,
      payload.data?.archivo,
    ];
    for (const c of candidates) {
      const xml = await extractXmlFromPayload(c);
      if (xml) return xml;
    }
  }
  return null;
}

async function extractXmlFromBuffer(buf) {
  if (!buf?.length) return null;
  const head = buf.slice(0, 4).toString('utf8');
  if (head.startsWith('<') || head.startsWith('\ufeff<')) {
    return buf.toString('utf8');
  }
  // ZIP (PK)
  if (buf[0] === 0x50 && buf[1] === 0x4b) {
    const zip = await JSZip.loadAsync(buf);
    const names = Object.keys(zip.files).filter((n) => /\.xml$/i.test(n));
    const preferred = names.find((n) => !/cdr|response|r-/i.test(n)) || names[0];
    if (!preferred) return null;
    return zip.files[preferred].async('string');
  }
  // try base64 text inside buffer
  const asText = buf.toString('utf8').trim();
  if (asText.startsWith('<')) return asText;
  return null;
}

module.exports = {
  parseUblCompraXml,
  extractXmlFromPayload,
  extractXmlFromBuffer,
};

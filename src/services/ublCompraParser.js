const { XMLParser } = require('fast-xml-parser');
const JSZip = require('jszip');

/**
 * Parsea XML UBL (Invoice / CreditNote / DebitNote / DespatchAdvice GRE) a body de compra.
 */
function parseUblCompraXml(xmlString) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: true,
    trimValues: true,
    // Códigos SUNAT ('01', ubigeos, DNI con ceros) deben quedar tal cual vienen en el XML.
    parseTagValue: false,
  });
  const root = parser.parse(String(xmlString || ''));
  if (root.DespatchAdvice) {
    return parseDespatchAdviceXml(root.DespatchAdvice);
  }

  const doc = root.Invoice || root.CreditNote || root.DebitNote;
  if (!doc) {
    const err = new Error('El XML no es un CPE UBL (Invoice/CreditNote/DebitNote/DespatchAdvice).');
    err.status = 400;
    throw err;
  }

  const tipoDoc = String(
    doc.InvoiceTypeCode?.['#text']
      || doc.InvoiceTypeCode
      || (root.CreditNote ? '07' : root.DebitNote ? '08' : '01'),
  ).trim() || '01';

  const idFull = String(doc.ID?.['#text'] || doc.ID || '').trim();
  const { serie, correlativo } = splitSerieCorrelativo(idFull);

  const fechaEmision = String(doc.IssueDate?.['#text'] || doc.IssueDate || '').trim() || null;
  const tipoMoneda = String(
    doc.DocumentCurrencyCode?.['#text'] || doc.DocumentCurrencyCode || 'PEN',
  ).trim() || 'PEN';

  const supplier = doc.AccountingSupplierParty?.Party || {};
  const supplierId = firstPartyId(supplier);
  const proveedorNumeroDoc = String(supplierId?.ID?.['#text'] || supplierId?.ID || '')
    .replace(/\D/g, '');
  const proveedorRazonSocial = partyName(supplier);

  const customer = doc.AccountingCustomerParty?.Party || {};
  const customerId = firstPartyId(customer);
  const receptorNumeroDoc = String(customerId?.ID?.['#text'] || customerId?.ID || '')
    .replace(/\D/g, '');
  const receptorRazonSocial = partyName(customer);

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

function parseDespatchAdviceXml(doc) {
  const tipoDoc = String(
    doc.DespatchAdviceTypeCode?.['#text'] || doc.DespatchAdviceTypeCode || '09',
  ).trim().padStart(2, '0');

  const idFull = String(doc.ID?.['#text'] || doc.ID || '').trim();
  const { serie, correlativo } = splitSerieCorrelativo(idFull);
  const fechaEmision = String(doc.IssueDate?.['#text'] || doc.IssueDate || '').trim() || null;

  const remitenteParty = doc.DespatchSupplierParty?.Party || {};
  const remitenteId = firstPartyId(remitenteParty);
  const remitenteRuc = String(remitenteId?.ID?.['#text'] || remitenteId?.ID || '').replace(/\D/g, '');
  const remitenteNombre = partyName(remitenteParty);

  const destinatarioParty = doc.DeliveryCustomerParty?.Party || {};
  const destinatarioId = firstPartyId(destinatarioParty);
  const destinatarioRuc = String(destinatarioId?.ID?.['#text'] || destinatarioId?.ID || '')
    .replace(/\D/g, '');
  const destinatarioNombre = partyName(destinatarioParty);

  const shipment = doc.Shipment || {};
  const stages = Array.isArray(shipment.ShipmentStage)
    ? shipment.ShipmentStage
    : (shipment.ShipmentStage ? [shipment.ShipmentStage] : []);
  const stage = stages[0] || {};
  // UBL GRE: CarrierParty suele ser el Party directo (sin hijo <cac:Party>).
  const carrier = stage.CarrierParty?.Party || stage.CarrierParty || {};
  const carrierId = firstPartyId(carrier);
  const transportistaRuc = String(carrierId?.ID?.['#text'] || carrierId?.ID || '').replace(/\D/g, '');
  const transportistaNombre = partyName(carrier);
  const nroMtc = String(
    carrier.PartyLegalEntity?.CompanyID?.['#text']
      || carrier.PartyLegalEntity?.CompanyID
      || '',
  ).trim() || undefined;

  const pesoTotal = toNum(
    shipment.GrossWeightMeasure?.['#text'] ?? shipment.GrossWeightMeasure,
  );
  const undPeso = String(
    shipment.GrossWeightMeasure?.['@_unitCode'] || 'KGM',
  ).trim() || 'KGM';

  const vehiculo = vehiculoFromUbl(shipment, stage);
  const conductor = conductorFromUbl(stage);

  const delivery = shipment.Delivery || {};
  const partidaAddr = delivery.Despatch?.DespatchAddress || {};
  const llegadaAddr = delivery.DeliveryAddress || {};
  const fechaTraslado = String(
    stage.LoadingTransportEvent?.OccurrenceDate?.['#text']
      || stage.LoadingTransportEvent?.OccurrenceDate
      || stage.TransitPeriod?.StartDate?.['#text']
      || stage.TransitPeriod?.StartDate
      || fechaEmision
      || '',
  ).trim().slice(0, 10) || null;

  const despatchLines = Array.isArray(doc.DespatchLine)
    ? doc.DespatchLine
    : (doc.DespatchLine ? [doc.DespatchLine] : []);

  const lineas = despatchLines.map((line) => {
    const qty = toNum(line.DeliveredQuantity?.['#text'] ?? line.DeliveredQuantity ?? 1);
    const unidad = String(line.DeliveredQuantity?.['@_unitCode'] || 'NIU').trim() || 'NIU';
    const item = line.Item || {};
    const descripcion = String(
      item.Description?.['#text'] || item.Description || item.Name?.['#text'] || item.Name || 'Bien',
    ).trim();
    const codigo = String(
      item.SellersItemIdentification?.ID?.['#text']
        || item.SellersItemIdentification?.ID
        || '',
    ).trim() || null;
    return {
      nombre: descripcion.slice(0, 255),
      descripcion,
      cantidad: qty || 1,
      unidad,
      precio_unitario: 0,
      tip_afe_igv: '30',
      kind: 'PRODUCT',
      ...(codigo ? { codigo: codigo.slice(0, 64) } : {}),
    };
  }).filter((l) => l.descripcion);

  // Emisor del CPE: en la GRE remitente (09) es el remitente; en la transportista (31),
  // el transportista. El firmante del XML sirve de respaldo en ambos casos.
  const firmante = firmanteFromUbl(doc);
  const emisorRuc = tipoDoc === '31'
    ? (transportistaRuc || firmante.ruc || remitenteRuc)
    : (remitenteRuc || firmante.ruc);
  const emisorNombre = emisorRuc === remitenteRuc
    ? (remitenteNombre || firmante.nombre)
    : (emisorRuc === transportistaRuc
      ? (transportistaNombre || firmante.nombre)
      : firmante.nombre);

  if (!serie || !correlativo) {
    const err = new Error(`GRE sin serie/correlativo válido (ID=${idFull || 'vacío'}).`);
    err.status = 400;
    throw err;
  }
  if (!emisorRuc || emisorRuc.length !== 11) {
    const err = new Error('GRE sin RUC emisor válido.');
    err.status = 400;
    throw err;
  }
  if (!lineas.length) {
    const err = new Error('La GRE no tiene líneas de detalle.');
    err.status = 400;
    throw err;
  }

  const docsRel = (() => {
    const raw = doc.AdditionalDocumentReference;
    const list = Array.isArray(raw) ? raw : (raw ? [raw] : []);
    return list.map((ref) => {
      const idFull = String(ref?.ID?.['#text'] || ref?.ID || '').trim();
      const { serie: docSerie, correlativo: docCorr } = splitSerieCorrelativo(idFull);
      const tipoRaw = String(
        ref?.DocumentTypeCode?.['#text'] ?? ref?.DocumentTypeCode ?? '',
      ).trim();
      const tipoDocRel = tipoRaw.padStart(2, '0').slice(-2) || '01';
      const issuer = ref?.IssuerParty?.PartyIdentification
        || ref?.IssuerParty?.Party?.PartyIdentification;
      const issuerNode = Array.isArray(issuer) ? issuer[0] : issuer;
      const emisorRucDoc = String(issuerNode?.ID?.['#text'] || issuerNode?.ID || '')
        .replace(/\D/g, '');
      if (!docSerie || !docCorr) return null;
      return {
        tipo_doc: tipoDocRel,
        serie: docSerie,
        correlativo: docCorr,
        emisor_tipo_doc: '6',
        emisor_numero_doc: emisorRucDoc || undefined,
        emisor_razon_social: undefined,
        descripcion: String(ref?.DocumentType?.['#text'] || ref?.DocumentType || '').trim() || undefined,
      };
    }).filter(Boolean);
  })();

  const guiaMeta = {
    envio: {
      cod_traslado: String(shipment.HandlingCode?.['#text'] || shipment.HandlingCode || '01').trim(),
      mod_traslado: String(stage.TransportModeCode?.['#text'] || stage.TransportModeCode || '02').trim(),
      fecha_traslado: fechaTraslado,
      peso_total: pesoTotal,
      und_peso_total: undPeso,
      partida: addressFromUbl(partidaAddr),
      llegada: addressFromUbl(llegadaAddr),
      transportista: transportistaRuc
        ? {
            tipo_doc: '6',
            num_doc: transportistaRuc,
            numero_doc: transportistaRuc,
            razon_social: transportistaNombre || transportistaRuc,
            nro_mtc: nroMtc,
          }
        : undefined,
      nro_mtc: nroMtc,
      vehiculo,
      conductor,
    },
    remitente: remitenteRuc
      ? { tipo_doc: '6', numero_doc: remitenteRuc, razon_social: remitenteNombre || remitenteRuc }
      : undefined,
    destinatario: destinatarioRuc
      ? { tipo_doc: '6', numero_doc: destinatarioRuc, razon_social: destinatarioNombre || destinatarioRuc }
      : undefined,
    documentos_relacionados: docsRel.length ? docsRel : undefined,
    fuente_xml: 'gre_scraper',
  };

  return {
    tipo_doc: tipoDoc,
    serie,
    correlativo,
    fecha_emision: fechaEmision,
    tipo_moneda: 'PEN',
    proveedor: {
      tipo_doc: '6',
      numero_doc: emisorRuc,
      razon_social: emisorNombre || emisorRuc,
    },
    receptor: destinatarioRuc
      ? { tipo_doc: '6', numero_doc: destinatarioRuc, razon_social: destinatarioNombre || destinatarioRuc }
      : undefined,
    sub_total: 0,
    mto_igv: 0,
    mto_imp_venta: 0,
    guia_meta: guiaMeta,
    lineas,
    origen: 'GRE_SCRAPER',
    en_camino: false,
  };
}

function splitSerieCorrelativo(idFull) {
  const raw = String(idFull || '').trim();
  if (!raw.includes('-')) return { serie: '', correlativo: '' };
  const idx = raw.indexOf('-');
  const serie = raw.slice(0, idx).trim().toUpperCase();
  const correlativo = raw.slice(idx + 1).replace(/\D/g, '').replace(/^0+/, '') || '0';
  return { serie, correlativo };
}

function addressFromUbl(addr) {
  if (!addr || typeof addr !== 'object') return undefined;
  const ubigeo = String(addr.ID?.['#text'] || addr.ID || '').replace(/\D/g, '').slice(0, 6);
  const line = String(
    addr.AddressLine?.Line?.['#text'] || addr.AddressLine?.Line || '',
  ).trim();
  if (!ubigeo && !line) return undefined;
  return {
    ubigeo: ubigeo || undefined,
    direccion: line || undefined,
  };
}

/** Firmante del CPE (cac:Signature/cac:SignatoryParty): siempre el emisor. */
function firmanteFromUbl(doc) {
  const firmas = doc?.Signature;
  const firma = Array.isArray(firmas) ? firmas[0] : firmas;
  const party = firma?.SignatoryParty || {};
  const id = firstPartyId(party);
  return {
    ruc: String(id?.ID?.['#text'] || id?.ID || '').replace(/\D/g, ''),
    nombre: String(
      party?.PartyName?.Name?.['#text']
        || party?.PartyName?.Name
        || party?.PartyLegalEntity?.RegistrationName?.['#text']
        || party?.PartyLegalEntity?.RegistrationName
        || '',
    ).trim(),
  };
}

/** Placa: RoadTransport del tramo o TransportEquipment del envío (GRE-T). */
function vehiculoFromUbl(shipment, stage) {
  const handling = Array.isArray(shipment?.TransportHandlingUnit)
    ? shipment.TransportHandlingUnit[0]
    : shipment?.TransportHandlingUnit;
  const equipos = handling?.TransportEquipment;
  const equipo = Array.isArray(equipos) ? equipos[0] : equipos;
  const placa = String(
    stage?.TransportMeans?.RoadTransport?.LicensePlateID?.['#text']
      || stage?.TransportMeans?.RoadTransport?.LicensePlateID
      || equipo?.ID?.['#text']
      || equipo?.ID
      || '',
  ).trim().toUpperCase();
  if (!placa) return undefined;
  return { placa };
}

function conductorFromUbl(stage) {
  const drivers = stage?.DriverPerson;
  const driver = Array.isArray(drivers) ? drivers[0] : drivers;
  if (!driver) return undefined;
  const numDoc = String(driver.ID?.['#text'] || driver.ID || '').trim();
  if (!numDoc) return undefined;
  const tipoDoc = String(driver.ID?.['@_schemeID'] || '1').trim() || '1';
  const nombre = [
    String(driver.FirstName?.['#text'] || driver.FirstName || '').trim(),
    String(driver.FamilyName?.['#text'] || driver.FamilyName || '').trim(),
  ].filter(Boolean).join(' ').trim();
  const licencia = String(
    driver.IdentityDocumentReference?.ID?.['#text']
      || driver.IdentityDocumentReference?.ID
      || '',
  ).trim();
  return {
    tipo_doc: tipoDoc,
    num_doc: numDoc,
    numero_doc: numDoc,
    nombre: nombre || numDoc,
    ...(licencia ? { licencia } : {}),
  };
}

function partyName(party) {
  return String(
    party?.PartyLegalEntity?.RegistrationName?.['#text']
      || party?.PartyLegalEntity?.RegistrationName
      || party?.PartyName?.Name?.['#text']
      || party?.PartyName?.Name
      || '',
  ).trim();
}

function firstPartyId(party) {
  const ids = party?.PartyIdentification;
  if (!ids) return null;
  return Array.isArray(ids) ? ids[0] : ids;
}

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

function decodePdfBase64(value) {
  if (!value) return null;
  const raw = String(value).replace(/^data:[^;]+;base64,/, '').replace(/\s/g, '').trim();
  if (!raw || raw.startsWith('<')) return null;
  try {
    const buf = Buffer.from(raw, 'base64');
    return buf.length ? buf : null;
  } catch {
    return null;
  }
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
  if (buf[0] === 0x50 && buf[1] === 0x4b) {
    const zip = await JSZip.loadAsync(buf);
    const names = Object.keys(zip.files).filter((n) => /\.xml$/i.test(n));
    const preferred = names.find((n) => !/cdr|response|r-/i.test(n)) || names[0];
    if (!preferred) return null;
    return zip.files[preferred].async('string');
  }
  const asText = buf.toString('utf8').trim();
  if (asText.startsWith('<')) return asText;
  return null;
}

async function extractPdfFromBuffer(buf) {
  if (!buf?.length) return null;
  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) {
    return buf;
  }
  if (buf[0] === 0x50 && buf[1] === 0x4b) {
    const zip = await JSZip.loadAsync(buf);
    const names = Object.keys(zip.files).filter((n) => /\.pdf$/i.test(n));
    const preferred = names.find((n) => !/cdr|response|r-/i.test(n)) || names[0];
    if (!preferred) return null;
    return zip.files[preferred].async('nodebuffer');
  }
  return null;
}

async function extractCpeArchivosFromPayload(payload) {
  const xml = await extractXmlFromPayload(payload);
  let pdf = null;
  if (payload && typeof payload === 'object') {
    pdf = decodePdfBase64(
      payload.pdf_base64 || payload.pdfBase64 || payload.pdf || payload.archivo_pdf,
    );
    if (!pdf && payload.archivo) {
      pdf = decodePdfBase64(payload.archivo.pdf || payload.archivo.pdf_base64);
    }
  }
  return { xml, pdf };
}

async function extractCpeArchivosFromBuffer(buf) {
  const xml = await extractXmlFromBuffer(buf);
  const pdf = await extractPdfFromBuffer(buf);
  return { xml, pdf: pdf || null };
}

module.exports = {
  parseUblCompraXml,
  extractXmlFromPayload,
  extractXmlFromBuffer,
  extractCpeArchivosFromPayload,
  extractCpeArchivosFromBuffer,
  decodePdfBase64,
};

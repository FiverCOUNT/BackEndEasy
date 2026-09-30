/**
 * GRE recibidas del scraper SOL → compras.
 * Solo guías que OTROS emitieron hacia tu RUC.
 * Ítems (bienes) → lineas JSON. Documentos relacionados → guia_meta JSON.
 * Sin FK a invoices, SaleDetail, catálogo ni line_invoice_invoice.
 */
const { XMLParser } = require('fast-xml-parser');
const { tipoDocFromGuiaRow, parseNumeracionGre } = require('./greScraperService');
const { parseUblCompraXml } = require('./ublCompraParser');

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function normalizeCorrelativo(value) {
  const n = digits(value);
  return n.replace(/^0+/, '') || '0';
}

function resolveSerieCorrelativo(guia) {
  const parsed = parseNumeracionGre(guia?.numeracion);
  const serie = String(guia?.serie || guia?.raw?.numSerie || parsed.serie || '')
    .trim()
    .toUpperCase();
  const correlativo = normalizeCorrelativo(
    guia?.numero ?? guia?.raw?.numCpe ?? parsed.correlativo,
  );
  return { serie, correlativo };
}

function resolveTipoDoc(guia) {
  const cod = String(guia?.cod_cpe || guia?.raw?.codCpe || '').padStart(2, '0');
  if (cod === '09' || cod === '31') return cod;
  const hint = tipoDocFromGuiaRow(guia);
  return hint || '09';
}

function emisorRucFromGuia(guia) {
  if (typeof guia?.emisor === 'string') return digits(guia.emisor);
  return digits(guia?.emisor?.ruc || guia?.ruc_emisor);
}

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

/** Destinatario real de la GRE (nunca el RUC con el que consultamos el portal). */
function destinatarioFromGuia(guia, receptorRuc) {
  const yo = digits(receptorRuc);
  const raw = guia?.raw && typeof guia.raw === 'object' ? guia.raw : {};
  const candidatos = [
    guia?.destinatario,
    {
      ruc: guia?.ruc_receptor || raw.rucReceptor || raw.ruc_receptor,
      razon_social: guia?.destinatario?.razon_social
        || raw.desReceptor
        || raw.nombreReceptor
        || raw.razSocReceptor,
    },
  ];
  for (const c of candidatos) {
    const ruc = digits(c?.ruc || c?.numero_doc || c?.num_doc);
    if (ruc.length === 11 && ruc !== yo) {
      const nombre = String(c?.razon_social || c?.nombre || ruc).trim();
      return { ruc, nombre: nombre || ruc };
    }
  }
  // Último recurso: rucReceptor del raw aunque coincida (mejor que inventar).
  const fallback = digits(raw.rucReceptor || guia?.ruc_receptor);
  if (fallback.length === 11) {
    return {
      ruc: fallback,
      nombre: String(raw.desReceptor || raw.nombreReceptor || fallback).trim() || fallback,
    };
  }
  return { ruc: '', nombre: '' };
}

function rolRecibidoGreScraper(guia, receptorRuc) {
  const target = digits(receptorRuc);
  const dest = destinatarioFromGuia(guia, receptorRuc).ruc;
  const transp = digits(guia?.transportista?.ruc || guia?.raw?.rucTransportista);
  const remitente = digits(guia?.remitente?.ruc || guia?.raw?.rucRemitente);
  const tipo = resolveTipoDoc(guia);

  if (dest && dest === target) return 'DESTINATARIO';
  if (transp && transp === target) return 'TRANSPORTISTA';
  if (tipo === '31' && remitente === target) return 'REMITENTE';
  // Si yo no soy destinatario pero la guía me aplica, soy transportista (consulta GRE recibidas).
  if (dest && dest !== target && target) return 'TRANSPORTISTA';
  return 'RECIBIDO';
}

/**
 * ¿Esta guía es recibida para mi RUC?
 * Sí: aparezco como destinatario, transportista o remitente (GRE-T de otro).
 * No: yo soy el emisor (esa GRE es emitida por mí → va a comprobantes emitidos).
 */
function guiaAplicaParaReceptor(guia, receptorRuc) {
  const target = digits(receptorRuc);
  if (!target) return false;

  const emisor = emisorRucFromGuia(guia);
  if (emisor === target) return false;

  const dest = destinatarioFromGuia(guia, receptorRuc).ruc;
  const transp = digits(guia?.transportista?.ruc || guia?.raw?.rucTransportista);
  const remitente = digits(guia?.remitente?.ruc || guia?.raw?.rucRemitente);
  const tipo = resolveTipoDoc(guia);

  if (dest === target || transp === target) return true;
  if (tipo === '31' && remitente === target) return true;

  // Consulta «GRE recibidas» del portal/API ya acotada a nuestro RUC.
  // Si no somos el emisor, es recibida (roles se completan desde el XML).
  return Boolean(emisor && emisor !== target);
}

function esGreEmitidaPorMi(guia, receptorRuc) {
  const target = digits(receptorRuc);
  const emisor = emisorRucFromGuia(guia);
  return Boolean(target && emisor === target);
}

function lineasFromBienes(guia) {
  const bienes = Array.isArray(guia?.bienes) ? guia.bienes : [];
  return bienes.map((b) => {
    const descripcion = String(b?.descripcion || 'Bien').trim();
    // GRE SUNAT no trae precios; si el scraper manda alguno, lo respetamos.
    const precio = Number(
      b?.precio_unitario
      ?? b?.precioUnitario
      ?? b?.precio
      ?? b?.valor_unitario
      ?? b?.valorUnitario
      ?? 0,
    ) || 0;
    return {
      nombre: descripcion.slice(0, 255),
      descripcion,
      cantidad: Number(b?.cantidad) || 1,
      unidad: String(b?.unidad || 'NIU').trim() || 'NIU',
      precio_unitario: precio,
      tip_afe_igv: '30',
      codigo: b?.item != null ? String(b.item).slice(0, 64) : undefined,
      kind: 'PRODUCT',
    };
  }).filter((l) => l.descripcion && l.cantidad > 0);
}

/** Referencia externa (factura del proveedor, otra GRE…). Solo JSON, sin id de invoices. */
function normalizeDocumentoExterno(doc) {
  if (!doc || typeof doc !== 'object') return null;
  const idFull = String(doc.id || doc.numero || doc.numeracion || '').trim();
  let serie = String(doc.serie || '').trim().toUpperCase();
  let correlativo = normalizeCorrelativo(doc.correlativo ?? doc.numero ?? doc.numCpe);
  if (!serie && idFull.includes('-')) {
    const idx = idFull.indexOf('-');
    serie = idFull.slice(0, idx).trim().toUpperCase();
    correlativo = normalizeCorrelativo(idFull.slice(idx + 1));
  }
  if (!serie || !correlativo) return null;
  return {
    tipo_doc: String(doc.tipo_doc || doc.tipoDoc || doc.cod_cpe || doc.codCpe || '01').padStart(2, '0'),
    serie,
    correlativo,
    emisor_tipo_doc: String(doc.emisor_tipo_doc || doc.emisorTipoDoc || '6'),
    emisor_numero_doc: digits(doc.emisor_numero_doc || doc.emisorNumeroDoc || doc.emisor?.ruc || doc.ruc_emisor) || undefined,
    emisor_razon_social: doc.emisor_razon_social || doc.emisor?.razon_social || undefined,
    externo: true,
  };
}

function documentosRelacionadosFromGuia(guia, xml) {
  const candidatos = guia?.documentos_relacionados
    || guia?.documentos
    || guia?.facturas_vinculadas;
  if (Array.isArray(candidatos) && candidatos.length) {
    return candidatos.map(normalizeDocumentoExterno).filter(Boolean);
  }
  return extractDocumentosRelacionadosFromXml(xml);
}

function extractDocumentosRelacionadosFromXml(xmlString) {
  if (!xmlString || !String(xmlString).includes('<')) return [];
  try {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      removeNSPrefix: true,
      trimValues: true,
      parseTagValue: false,
    });
    const root = parser.parse(String(xmlString));
    const doc = root.DespatchAdvice || root.Invoice;
    if (!doc) return [];
    const refs = doc.AdditionalDocumentReference;
    const list = Array.isArray(refs) ? refs : (refs ? [refs] : []);
    return list.map((ref) => {
      const idFull = String(ref.ID?.['#text'] || ref.ID || '').trim();
      let serie = '';
      let correlativo = '';
      if (idFull.includes('-')) {
        const idx = idFull.indexOf('-');
        serie = idFull.slice(0, idx).trim().toUpperCase();
        correlativo = normalizeCorrelativo(idFull.slice(idx + 1));
      }
      const emisorParty = ref.IssuerParty?.PartyIdentification;
      const emisorId = Array.isArray(emisorParty) ? emisorParty[0] : emisorParty;
      return normalizeDocumentoExterno({
        tipo_doc: ref.DocumentTypeCode?.['#text'] || ref.DocumentTypeCode || '01',
        serie,
        correlativo,
        emisor_numero_doc: emisorId?.ID?.['#text'] || emisorId?.ID,
      });
    }).filter(Boolean);
  } catch {
    return [];
  }
}

function buildGuiaMetaFromScraper(guia, receptorRuc, xml = null) {
  const emisorRuc = emisorRucFromGuia(guia);
  const emisorNombre = String(guia?.emisor?.razon_social || emisorRuc || '').trim();
  const destInfo = destinatarioFromGuia(guia, receptorRuc);
  const destRuc = destInfo.ruc;
  const destNombre = destInfo.nombre;
  const transpRuc = digits(guia?.transportista?.ruc || guia?.raw?.rucTransportista);
  const transpNombre = String(guia?.transportista?.razon_social || transpRuc || '').trim();
  const placa = String(guia?.vehiculo?.placa || '').trim();
  const condDoc = String(guia?.conductor?.documento || '').trim();
  const condNombre = [
    guia?.conductor?.nombres,
    guia?.conductor?.apellidos,
  ].filter(Boolean).join(' ').trim();

  const documentosRelacionados = documentosRelacionadosFromGuia(guia, xml);

  return {
    envio: {
      fecha_traslado: guia?.fecha_traslado || null,
      peso_total: guia?.peso_bruto != null && guia?.peso_bruto !== ''
        ? Number(guia.peso_bruto)
        : null,
      und_peso_total: String(guia?.peso_unidad || 'KGM').trim() || 'KGM',
      partida: guia?.punto_partida?.direccion || guia?.punto_partida?.ubigeo
        ? {
            ubigeo: guia.punto_partida.ubigeo || undefined,
            direccion: guia.punto_partida.direccion || undefined,
          }
        : undefined,
      llegada: guia?.punto_llegada?.direccion || guia?.punto_llegada?.ubigeo
        ? {
            ubigeo: guia.punto_llegada.ubigeo || undefined,
            direccion: guia.punto_llegada.direccion || undefined,
          }
        : undefined,
      transportista: transpRuc
        ? {
            tipo_doc: '6',
            num_doc: transpRuc,
            numero_doc: transpRuc,
            razon_social: transpNombre || transpRuc,
            nro_mtc: guia?.transportista?.mtc || undefined,
          }
        : undefined,
      nro_mtc: guia?.transportista?.mtc || undefined,
      vehiculo: placa ? { placa } : undefined,
      conductor: condDoc
        ? {
            tipo_doc: '1',
            num_doc: condDoc,
            nombre: condNombre || condDoc,
          }
        : undefined,
    },
    remitente: emisorRuc
      ? { tipo_doc: '6', numero_doc: emisorRuc, razon_social: emisorNombre || emisorRuc }
      : undefined,
    destinatario: destRuc
      ? { tipo_doc: '6', numero_doc: destRuc, razon_social: destNombre || destRuc }
      : undefined,
    rol_recibido: rolRecibidoGreScraper(guia, receptorRuc),
    estado_sunat: guia?.estado ? String(guia.estado).trim() : undefined,
    fecha_cdr: guia?.fecha_cdr || undefined,
    numeracion: guia?.numeracion || undefined,
    tipo_gre: guia?.tipo_gre || undefined,
    fuente: 'gre_scraper',
    ...(documentosRelacionados?.length
      ? { documentos_relacionados: documentosRelacionados }
      : {}),
    scraper_raw: guia?.raw && typeof guia.raw === 'object' ? guia.raw : undefined,
  };
}

function vacio(value) {
  return value == null || value === '';
}

/** XML manda campo por campo, pero sin borrar lo que solo trae el scraper (placa, conductor…). */
function mergeEnvioXmlSobreScraper(envioScraper, envioXml) {
  const base = envioScraper && typeof envioScraper === 'object' ? { ...envioScraper } : {};
  if (!envioXml || typeof envioXml !== 'object') return base;
  for (const [clave, valorXml] of Object.entries(envioXml)) {
    if (vacio(valorXml)) continue;
    const valorPrev = base[clave];
    if (
      valorXml && typeof valorXml === 'object' && !Array.isArray(valorXml)
      && valorPrev && typeof valorPrev === 'object' && !Array.isArray(valorPrev)
    ) {
      const sub = { ...valorPrev };
      for (const [k, v] of Object.entries(valorXml)) {
        if (!vacio(v)) sub[k] = v;
      }
      base[clave] = sub;
      continue;
    }
    base[clave] = valorXml;
  }
  return base;
}

function rolRecibidoDesdeMeta(meta, receptorRuc) {
  const target = digits(receptorRuc);
  const dest = digits(meta?.destinatario?.numero_doc);
  const transp = digits(
    meta?.envio?.transportista?.num_doc
      || meta?.envio?.transportista?.numero_doc,
  );
  if (dest === target) return 'DESTINATARIO';
  if (transp === target) return 'TRANSPORTISTA';
  return meta?.rol_recibido || 'RECIBIDO';
}

/**
 * @param {object} guia — fila de scraper /guias
 * @param {{ ruc: string }} receptorCompany
 * @param {string|null} [xml] — XML UBL opcional (documentos relacionados del XML)
 */
function guiaJsonToParsed(guia, receptorCompany, xml = null) {
  const { serie, correlativo } = resolveSerieCorrelativo(guia);
  const tipoDoc = resolveTipoDoc(guia);
  const emisorRuc = emisorRucFromGuia(guia);
  const emisorNombre = String(
    guia?.emisor?.razon_social || guia?.emisor?.nombre || emisorRuc || '',
  ).trim();
  const destInfo = destinatarioFromGuia(guia, receptorCompany.ruc);
  let destRuc = destInfo.ruc;
  let destNombre = destInfo.nombre;

  let lineas = lineasFromBienes(guia);
  let guiaMeta = buildGuiaMetaFromScraper(guia, receptorCompany.ruc, xml);

  if (xml) {
    try {
      const fromXml = parseUblCompraXml(xml);
      if (fromXml.guia_meta && typeof fromXml.guia_meta === 'object') {
        const xmlDest = fromXml.guia_meta.destinatario;
        const xmlDestRuc = digits(xmlDest?.numero_doc || xmlDest?.num_doc);
        // XML manda: destinatario = DeliveryCustomerParty (nunca el transportista).
        guiaMeta = {
          ...guiaMeta,
          ...fromXml.guia_meta,
          envio: mergeEnvioXmlSobreScraper(guiaMeta.envio, fromXml.guia_meta.envio),
          destinatario: xmlDestRuc.length === 11
            ? xmlDest
            : guiaMeta.destinatario,
          documentos_relacionados: fromXml.guia_meta.documentos_relacionados
            || guiaMeta.documentos_relacionados,
          scraper_raw: guiaMeta.scraper_raw,
          fuente: 'gre_scraper',
        };
        if (xmlDestRuc.length === 11) {
          destRuc = xmlDestRuc;
          destNombre = String(xmlDest?.razon_social || destRuc).trim();
        }
      }
      if (fromXml.lineas?.length) {
        lineas = fromXml.lineas;
      }
      guiaMeta.rol_recibido = rolRecibidoDesdeMeta(guiaMeta, receptorCompany.ruc);
    } catch {
      guiaMeta.rol_recibido = rolRecibidoGreScraper(guia, receptorCompany.ruc);
    }
  } else {
    guiaMeta.rol_recibido = rolRecibidoGreScraper(guia, receptorCompany.ruc);
  }

  // Nunca guardar como destinatario al RUC que importa como transportista.
  const yo = digits(receptorCompany.ruc);
  const transp = digits(
    guiaMeta.envio?.transportista?.numero_doc
      || guiaMeta.envio?.transportista?.num_doc,
  );
  if (yo && digits(guiaMeta.destinatario?.numero_doc) === yo && transp === yo) {
    const rawDest = digits(guia?.raw?.rucReceptor || guia?.ruc_receptor);
    if (rawDest.length === 11 && rawDest !== yo) {
      guiaMeta.destinatario = {
        tipo_doc: '6',
        numero_doc: rawDest,
        razon_social: String(guia?.raw?.desReceptor || rawDest).trim() || rawDest,
      };
      destRuc = rawDest;
      destNombre = guiaMeta.destinatario.razon_social;
    } else {
      // Solo somos transportistas: mejor sin destinatario que con uno falso.
      delete guiaMeta.destinatario;
      destRuc = '';
      destNombre = '';
    }
    guiaMeta.rol_recibido = 'TRANSPORTISTA';
  }

  if (!lineas.length) {
    const docRef = `${serie}-${correlativo}`;
    lineas.push({
      nombre: `GRE ${tipoDoc === '31' ? 'transportista' : 'remitente'} · ${emisorNombre}`.slice(0, 255),
      descripcion: `GRE ${docRef}`.slice(0, 500),
      cantidad: 1,
      unidad: 'NIU',
      precio_unitario: 0,
      tip_afe_igv: '30',
    });
  }

  const { normalizeFechaEmision } = require('../utils/fechas');
  return {
    tipo_doc: tipoDoc,
    serie,
    correlativo,
    fecha_emision: normalizeFechaEmision(guia?.fecha_emision || guia?.fecha_traslado) || null,
    tipo_moneda: 'PEN',
    proveedor: {
      tipo_doc: '6',
      numero_doc: emisorRuc,
      razon_social: emisorNombre || emisorRuc,
    },
    receptor: destRuc
      ? { tipo_doc: '6', numero_doc: destRuc, razon_social: destNombre || destRuc }
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

function decodeXmlFromGuia(guia) {
  if (!guia?.xml_base64) return null;
  try {
    const xml = Buffer.from(String(guia.xml_base64).replace(/\s/g, ''), 'base64').toString('utf8');
    return xml.startsWith('<') ? xml : null;
  } catch {
    return null;
  }
}

/** PDF oficial SUNAT (representación impresa) si el scraper lo bajó. */
function decodePdfFromGuia(guia) {
  const b64 = guia?.pdf_base64 || guia?.pdfBase64;
  if (!b64) return null;
  try {
    const buf = Buffer.from(String(b64).replace(/\s/g, ''), 'base64');
    if (!buf.length) return null;
    const head = buf.slice(0, 5).toString('utf8');
    if (head.startsWith('%PDF')) return buf;
    // Algunos navegadores entregan ZIP con el PDF dentro
    return buf;
  } catch {
    return null;
  }
}

module.exports = {
  guiaJsonToParsed,
  guiaAplicaParaReceptor,
  esGreEmitidaPorMi,
  decodeXmlFromGuia,
  decodePdfFromGuia,
  resolveSerieCorrelativo,
  resolveTipoDoc,
};

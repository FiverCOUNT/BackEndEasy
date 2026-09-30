/**
 * PDF / ticket GRE (09 remitente, 31 transportista).
 * Layout alineado a la representación impresa SUNAT (sin precios).
 */
const { motivoPorCodigo } = require('../utils/greRemitenteCatalog');
const { parseStoredTimestamp } = require('../utils/fechas');
const { tieneIndicadorVehiculoM1L, truthyFlag } = require('../utils/greEnvioIndicadoresSunat');
const { dibujarEmisorConLogo } = require('./comprobantePdfHeader');

const TIPO_DOC_LABEL = {
  '01': 'Factura',
  '03': 'Boleta',
  '09': 'Guía remisión remitente',
  '31': 'Guía remisión transportista',
};

const TIPO_DOC_PERSONA = {
  1: 'DOCUMENTO NACIONAL DE IDENTIDAD',
  4: 'CARNET DE EXTRANJERÍA',
  6: 'REGISTRO ÚNICO DE CONTRIBUYENTES',
  7: 'PASAPORTE',
  0: 'DOC. TRIB. NO DOMICILIADO',
};

const UNIDAD_LABEL = {
  NIU: 'UNIDAD',
  ZZ: 'SERVICIO',
  KGM: 'KILO',
  LTR: 'LITRO',
  MTR: 'METRO',
  TNE: 'TONELADA',
};

const SUNAT_PIE = 'Esta es una representación impresa del comprobante electrónico, generada en el Sistema de la SUNAT. '
  + 'El Emisor Electrónico puede verificarla utilizando su clave SOL; el Adquirente o Usuario puede consultar '
  + 'su validez en SUNAT Virtual: www.sunat.gob.pe, en Opciones sin Clave SOL / Consulta de Validez del CPE.';

const BLUE = '#1565C0';
const NAVY = '#0B1F33';
const MUTED = '#64748B';

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function unidadMedidaCompleta(unidad) {
  const cod = String(unidad || 'NIU').trim().toUpperCase() || 'NIU';
  return `${UNIDAD_LABEL[cod] || cod} (${cod})`;
}

function labelTipoPersona(tipoDoc) {
  return TIPO_DOC_PERSONA[String(tipoDoc || '6')] || 'DOCUMENTO';
}

function formatFechaCorta(value) {
  if (!value) return '—';
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const [y, m, d] = raw.slice(0, 10).split('-');
    return `${d}/${m}/${y}`;
  }
  const ms = parseStoredTimestamp(value);
  if (ms == null) return raw;
  return new Date(ms).toLocaleDateString('es-PE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'America/Lima',
  });
}

function formatFechaHora(value) {
  const ms = parseStoredTimestamp(value);
  if (ms == null) return formatFechaCorta(value);
  return new Date(ms).toLocaleString('es-PE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/Lima',
  });
}

function direccionTexto(addr) {
  if (!addr || typeof addr !== 'object') return '';
  const partes = [
    addr.direccion || addr.address || '',
    [addr.distrito, addr.provincia, addr.departamento].filter(Boolean).join(' - '),
    addr.ubigeo ? `(${addr.ubigeo})` : '',
  ].filter(Boolean);
  return partes.join(' ');
}

function tuceDeVehiculo(v) {
  if (!v || typeof v !== 'object') return '';
  const directo = String(
    v.nro_circulacion || v.nroCirculacion || v.tuce || '',
  ).trim();
  if (directo) return directo;
  const permisos = Array.isArray(v.permisos) ? v.permisos : [];
  const row = permisos.find((p) => {
    const tipo = String(p?.tipo || '').toUpperCase();
    return tipo.includes('TUCE') || tipo.includes('HABILIT');
  });
  return String(row?.numero || row?.nro || '').trim();
}

function docsRelacionados(invoice) {
  const lines = invoice?.lineInvoices || [];
  const fromLines = lines
    .map((line) => line?.invoice2)
    .filter(Boolean)
    .map((inv) => ({
      tipo_doc: inv.tipoDoc,
      serie: inv.serie,
      correlativo: inv.correlativo,
      emisor_ruc: inv.companyRuc,
    }));
  if (fromLines.length) return fromLines;

  const api = invoice.documentos_relacionados || invoice.facturas || [];
  if (Array.isArray(api) && api.length) {
    return api.map((d) => ({
      tipo_doc: d.tipo_doc || d.tipoDoc,
      serie: d.serie,
      correlativo: d.correlativo,
      emisor_ruc: d.emisor_numero_doc || d.emisorNumeroDoc || d.company_ruc,
      emisor_razon: d.emisor_razon_social || d.emisorRazonSocial,
    }));
  }
  return [];
}

function extractGre(invoice) {
  const tipo = String(invoice.tipoDoc || invoice.tipo_doc || '').padStart(2, '0');
  const meta = invoice.guiaMetaJson && typeof invoice.guiaMetaJson === 'object'
    ? invoice.guiaMetaJson
    : (invoice.guia_meta || {});
  const envio = (meta.envio && typeof meta.envio === 'object')
    ? meta.envio
    : (invoice.envio && typeof invoice.envio === 'object' ? invoice.envio : {});

  const company = invoice.company || {};
  const cliente = invoice.cliente || invoice.client || {};
  const motivo = motivoPorCodigo(envio.cod_traslado || envio.codTraslado || invoice.motivoCodigo);
  const mod = String(envio.mod_traslado || envio.modTraslado || '02');
  const vehiculo = envio.vehiculo && typeof envio.vehiculo === 'object' ? envio.vehiculo : {};
  const conductor = envio.conductor && typeof envio.conductor === 'object' ? envio.conductor : {};
  const transportista = envio.transportista && typeof envio.transportista === 'object'
    ? envio.transportista
    : null;
  const vehSec = Array.isArray(vehiculo.secundarios) ? vehiculo.secundarios : [];
  const condSec = Array.isArray(conductor.secundarios) ? conductor.secundarios : [];
  const docs = docsRelacionados(invoice);
  const registrarVeh = envio.registrar_vehiculos_conductores === true
    || envio.registrarVehiculosConductores === true
    || Boolean(vehiculo.placa || conductor.numero_doc || conductor.num_doc);
  const trasladoM1L = truthyFlag(envio.traslado_vehiculo_m1_l)
    || truthyFlag(envio.trasladoVehiculoM1L)
    || tieneIndicadorVehiculoM1L(envio);

  const obs = String(invoice.observacion || meta.observacion || '');
  const porEvento = truthyFlag(envio.gre_por_evento)
    || truthyFlag(envio.grePorEvento)
    || Boolean(String(envio.tipo_evento || envio.tipoEvento || '').trim())
    || /gre\s+por\s+evento/i.test(obs);
  let tipoEvento = String(envio.tipo_evento || envio.tipoEvento || '').trim();
  let descEvento = String(envio.descripcion_evento || envio.descripcionEvento || '').trim();
  if (porEvento && (!tipoEvento || !descEvento)) {
    const m = obs.match(/GRE\s+por\s+evento\s+(\d+)\s*[·.]\s*([^—\-]+)/i);
    if (m) {
      if (!tipoEvento) tipoEvento = m[1];
      if (!descEvento) descEvento = String(m[2] || '').trim();
    }
  }

  // SUNAT SOL: caja "Guía de Remisión Electrónica" + "Remitente/Transportista - por Eventos".
  const tituloLinea1 = 'GUÍA DE REMISIÓN ELECTRÓNICA';
  const tituloLinea2 = porEvento
    ? (tipo === '31' ? 'TRANSPORTISTA - POR EVENTOS' : 'REMITENTE - POR EVENTOS')
    : (tipo === '31' ? 'TRANSPORTISTA' : 'REMITENTE');
  const tituloDoc = porEvento
    ? `${tituloLinea1} ${tituloLinea2}`
    : (tipo === '31'
      ? 'GUÍA DE REMISIÓN ELECTRÓNICA TRANSPORTISTA'
      : 'GUÍA DE REMISIÓN ELECTRÓNICA REMITENTE');

  return {
    tipo,
    porEvento,
    tipoEvento,
    descEvento,
    tituloLinea1,
    tituloLinea2,
    tituloDoc,
    company,
    cliente,
    envio,
    meta,
    motivo,
    mod,
    vehiculo,
    conductor,
    transportista,
    vehSec,
    condSec,
    docs,
    registrarVeh,
    trasladoM1L,
    partida: envio.partida || {},
    llegada: envio.llegada || {},
    peso: envio.peso_total ?? envio.pesoTotal ?? '',
    undPeso: envio.und_peso_total || envio.undPesoTotal || 'KGM',
    fechaTraslado: envio.fecha_traslado || envio.fechaTraslado || '',
    fechaEntrega: envio.fecha_entrega_transportista || envio.fechaEntregaTransportista || '',
    nroMtc: envio.nro_mtc || envio.nroMtc || transportista?.nro_mtc || transportista?.nroMtc || '',
    observacion: obs,
    remitente: meta.remitente || null,
    numero: formatSerieNumero(invoice.serie, invoice.correlativo),
  };
}

function formatSerieNumero(serie, correlativo) {
  const s = String(serie || '').trim();
  const c = String(correlativo || '').trim();
  if (!s && !c) return '—';
  if (!s) return c;
  if (!c) return s;
  return `${s}-${c}`;
}

function columnasBienes(pageW) {
  // Más ancho a Código de Bien (series largas); columnas vacías más angostas.
  const fijos = [
    { key: 'n', label: 'N°', w: 16, align: 'center' },
    { key: 'bien', label: 'Bien\nnormalizado', w: 42, align: 'center' },
    { key: 'cod', label: 'Código\nde Bien', w: 88, align: 'left' },
    { key: 'sunat', label: 'Código\nproducto\nSUNAT', w: 40, align: 'center' },
    { key: 'partida', label: 'Partida\narancelaria', w: 36, align: 'center' },
    { key: 'gtin', label: 'Código\nGTIN', w: 32, align: 'center' },
  ];
  const fin = [
    { key: 'und', label: 'Unidad\nde medida', w: 52, align: 'center' },
    { key: 'cant', label: 'Cantidad', w: 38, align: 'right' },
  ];
  const usado = [...fijos, ...fin].reduce((s, c) => s + c.w, 0);
  const descW = Math.max(80, pageW - usado);
  return [
    ...fijos,
    { key: 'desc', label: 'Descripción\nDetallada', w: descW, align: 'left' },
    ...fin,
  ];
}

function celdasBien(line, idx) {
  const cantidad = toNumber(line.cantidad, 1);
  const serie = String(
    line.productoSerie?.numeroSerie
    || line.producto_serie?.numero_serie
    || line.numero_serie
    || line.numeroSerie
    || '',
  ).trim();
  const codigoCat = String(line.codigo || line.catalogItem?.codigo || '').trim();
  // Preferir serie de producto; si no, código de catálogo.
  const codigo = serie || codigoCat;
  return [
    String(idx + 1),
    'NO',
    codigo,
    String(line.codigoSunat || line.codigo_sunat || '').trim(),
    '',
    '',
    line.descripcion || line.nombre || 'Ítem',
    unidadMedidaCompleta(line.unidad),
    cantidad.toFixed(2),
  ];
}

function alturaFilaBienes(doc, cols, cells) {
  let maxH = 16;
  cells.forEach((cell, i) => {
    const col = cols[i];
    const text = String(cell || '');
    if (!text) return;
    const size = (col.key === 'cant' || col.key === 'und') ? 7 : (col.key === 'cod' ? 6 : 6.5);
    doc.font('Helvetica').fontSize(size);
    const h = Math.ceil(doc.heightOfString(text, {
      width: col.w - 5,
      align: col.align,
      lineGap: 0.5,
    })) + 6;
    if (h > maxH) maxH = h;
  });
  return maxH;
}

function ensureSpace(doc, need = 40) {
  if (doc.y + need > doc.page.height - 40) {
    doc.addPage({ size: 'A4', margin: 36 });
  }
}

function labelValue(doc, label, value, x, y, w) {
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(NAVY).text(label, x, y, { width: w, continued: false });
  const after = doc.y;
  doc.font('Helvetica').fontSize(8).fillColor('#111827')
    .text(String(value || '—'), x, after, { width: w });
  return doc.y;
}

/**
 * @param {PDFKit.PDFDocument} doc
 * @param {object} invoice
 * @param {{ logoBuffer?: Buffer|null }} [opts]
 */
function dibujarGreFormal(doc, invoice, opts = {}) {
  const gre = extractGre(invoice);
  const pageW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const leftX = doc.page.margins.left;
  const topY = doc.page.margins.top;
  const company = gre.company;
  const logoBuffer = opts.logoBuffer || null;

  // —— Cabecera: empresa (izq) | caja RUC (der) ——
  const boxW = 220;
  const boxX = leftX + pageW - boxW;
  const midW = Math.max(150, boxX - leftX - 12);
  const boxH = gre.porEvento ? 84 : 64;

  const headerBottom = dibujarEmisorConLogo(doc, {
    company,
    logoBuffer,
    x: leftX,
    y: topY,
    width: midW,
    logoSize: 40,
    nombreSize: 11,
    razonSize: 7.5,
    fillNombre: NAVY,
    fillRazon: '#334155',
  });

  doc.rect(boxX, topY, boxW, boxH).lineWidth(1.2).stroke('#111827');
  doc.font('Helvetica-Bold').fontSize(9).fillColor(NAVY)
    .text(`RUC N° ${company.ruc || '—'}`, boxX + 8, topY + 7, { width: boxW - 16, align: 'center' });
  if (gre.porEvento) {
    doc.font('Helvetica-Bold').fontSize(7)
      .text(gre.tituloLinea1, boxX + 8, topY + 22, { width: boxW - 16, align: 'center' });
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(BLUE)
      .text(gre.tituloLinea2, boxX + 8, topY + 35, { width: boxW - 16, align: 'center' });
    doc.font('Helvetica-Bold').fontSize(12).fillColor(NAVY)
      .text(`N° ${gre.numero}`, boxX + 8, topY + 54, { width: boxW - 16, align: 'center' });
  } else {
    doc.font('Helvetica-Bold').fontSize(7.5)
      .text(gre.tituloDoc, boxX + 8, topY + 24, { width: boxW - 16, align: 'center' });
    doc.font('Helvetica-Bold').fontSize(12)
      .text(`N° ${gre.numero}`, boxX + 8, topY + 42, { width: boxW - 16, align: 'center' });
  }
  doc.lineWidth(1);

  doc.y = Math.max(headerBottom, topY + boxH + 8) + 4;

  if (gre.porEvento) {
    dibujarGrePorEventoCuerpo(doc, invoice, gre, leftX, pageW, company);
    return;
  }

  doc.font('Helvetica').fontSize(8).fillColor('#111827')
    .text(`Fecha y hora de emisión: ${formatFechaHora(invoice.fechaEmision || invoice.fecha_emision)}`, leftX, doc.y);
  doc.moveDown(0.5);

  // —— Fechas / motivo | partida / llegada ——
  const colW = (pageW - 12) / 2;
  const blockY = doc.y;
  let yL = blockY;
  let yR = blockY;

  if (gre.mod === '01' && gre.fechaEntrega) {
    yL = labelValue(doc, 'Fecha de entrega de Bienes al transportista:', formatFechaCorta(gre.fechaEntrega), leftX, yL, colW) + 4;
  }
  yL = labelValue(doc, 'Fecha de inicio de Traslado:', formatFechaCorta(gre.fechaTraslado), leftX, yL, colW) + 4;
  yL = labelValue(doc, 'Motivo de Traslado:', gre.motivo?.titulo || gre.envio.cod_traslado || '—', leftX, yL, colW) + 4;

  yR = labelValue(doc, 'Punto de Partida:', direccionTexto(gre.partida) || '—', leftX + colW + 12, yR, colW) + 4;
  yR = labelValue(doc, 'Punto de llegada:', direccionTexto(gre.llegada) || '—', leftX + colW + 12, yR, colW) + 4;

  doc.y = Math.max(yL, yR) + 6;

  // —— Destinatario / proveedor / docs ——
  ensureSpace(doc, 50);
  const destNombre = gre.cliente.razonSocial || gre.cliente.razon_social || '—';
  const destDoc = gre.cliente.numeroDoc || gre.cliente.numero_doc || '';
  const destTipo = gre.cliente.tipoDoc || gre.cliente.tipo_doc || '6';
  doc.font('Helvetica-Bold').fontSize(8).fillColor(NAVY)
    .text('Datos del Destinatario:', leftX, doc.y, { continued: true });
  doc.font('Helvetica').fillColor('#111827')
    .text(` ${destNombre}${destDoc ? ` - ${labelTipoPersona(destTipo)} N° ${destDoc}` : ''}`);

  if (gre.remitente?.razon_social || gre.remitente?.numero_doc) {
    doc.font('Helvetica-Bold').fontSize(8).fillColor(NAVY)
      .text('Datos del Remitente:', leftX, doc.y, { continued: true });
    doc.font('Helvetica').fillColor('#111827')
      .text(` ${gre.remitente.razon_social || '—'}${gre.remitente.numero_doc ? ` - ${labelTipoPersona(gre.remitente.tipo_doc || '6')} N° ${gre.remitente.numero_doc}` : ''}`);
  }

  // Proveedor = emisor del doc relacionado (compra) si hay RUC distinto
  const proveedorDoc = gre.docs.find((d) => d.emisor_ruc && d.emisor_ruc !== company.ruc);
  if (proveedorDoc) {
    doc.font('Helvetica-Bold').fontSize(8).fillColor(NAVY)
      .text('Datos del Proveedor:', leftX, doc.y, { continued: true });
    doc.font('Helvetica').fillColor('#111827')
      .text(` ${proveedorDoc.emisor_razon || ''}${proveedorDoc.emisor_ruc ? ` - REGISTRO ÚNICO DE CONTRIBUYENTES N° ${proveedorDoc.emisor_ruc}` : ''}`.trim());
  }

  if (gre.docs.length) {
    const docsTxt = gre.docs.map((d) => {
      const tipo = TIPO_DOC_LABEL[String(d.tipo_doc || '').padStart(2, '0')] || 'Documento';
      const ref = formatSerieNumero(d.serie, d.correlativo);
      const ruc = d.emisor_ruc ? ` - RUC N° ${d.emisor_ruc}` : '';
      return `${tipo} N° ${ref}${ruc}`;
    }).join(' · ');
    doc.font('Helvetica-Bold').fontSize(8).fillColor(NAVY)
      .text('Documentos Relacionados:', leftX, doc.y, { continued: true });
    doc.font('Helvetica').fillColor('#111827').text(` ${docsTxt}`);
  }
  doc.moveDown(0.4);

  dibujarGreBienesYTraslado(doc, invoice, gre, leftX, pageW);
}

/** Layout alineado a SEE-SOL (GRE por eventos). */
function dibujarGrePorEventoCuerpo(doc, invoice, gre, leftX, pageW, company) {
  const tipoEvTxt = gre.descEvento
    || (gre.tipoEvento ? `Evento ${gre.tipoEvento}` : 'GRE por evento');

  ensureSpace(doc, 40);
  doc.font('Helvetica-Bold').fontSize(9).fillColor(BLUE).text('Datos de emisión', leftX, doc.y);
  doc.moveDown(0.15);
  doc.font('Helvetica-Bold').fontSize(8).fillColor(NAVY)
    .text('Tipo de Evento:', leftX, doc.y, { continued: true });
  doc.font('Helvetica').fillColor('#111827').text(` ${tipoEvTxt}`);
  doc.font('Helvetica').fontSize(7.5).fillColor(MUTED)
    .text(`Fecha y hora de emisión: ${formatFechaHora(invoice.fechaEmision || invoice.fecha_emision)}`);
  doc.moveDown(0.35);
  doc.fillColor('#111827');

  ensureSpace(doc, 36);
  doc.font('Helvetica-Bold').fontSize(9).fillColor(BLUE).text('Documentos relacionados', leftX, doc.y);
  doc.moveDown(0.15);
  if (gre.docs.length) {
    gre.docs.forEach((d) => {
      const t = String(d.tipo_doc || '').padStart(2, '0');
      const tipoGre = t === '31' ? 'GRE Transportista' : (t === '09' ? 'GRE Remitente' : (TIPO_DOC_LABEL[t] || 'Documento'));
      const ref = formatSerieNumero(d.serie, d.correlativo);
      const ruc = d.emisor_ruc || company.ruc || '';
      doc.font('Helvetica').fontSize(8).fillColor('#111827')
        .text(`${tipoGre} N° ${ref}${ruc ? ` - RUC ${ruc}` : ''}`, leftX, doc.y);
    });
  } else {
    doc.font('Helvetica').fontSize(8).fillColor('#111827').text('—', leftX, doc.y);
  }
  doc.moveDown(0.35);

  ensureSpace(doc, 36);
  doc.font('Helvetica-Bold').fontSize(9).fillColor(BLUE).text('Punto de partida', leftX, doc.y);
  doc.moveDown(0.15);
  doc.font('Helvetica').fontSize(8).fillColor('#111827')
    .text(direccionTexto(gre.partida) || '—', leftX, doc.y);
  doc.moveDown(0.35);

  ensureSpace(doc, 36);
  doc.font('Helvetica-Bold').fontSize(9).fillColor(BLUE).text('Punto de llegada', leftX, doc.y);
  doc.moveDown(0.15);
  doc.font('Helvetica').fontSize(8).fillColor('#111827')
    .text(direccionTexto(gre.llegada) || '—', leftX, doc.y);
  doc.moveDown(0.35);

  const destNombre = gre.cliente.razonSocial || gre.cliente.razon_social || '—';
  const destDoc = gre.cliente.numeroDoc || gre.cliente.numero_doc || '';
  const destTipo = gre.cliente.tipoDoc || gre.cliente.tipo_doc || '6';
  ensureSpace(doc, 30);
  doc.font('Helvetica-Bold').fontSize(9).fillColor(BLUE).text('Datos del Destinatario', leftX, doc.y);
  doc.moveDown(0.15);
  doc.font('Helvetica').fontSize(8).fillColor('#111827')
    .text(`${destNombre}${destDoc ? ` - ${labelTipoPersona(destTipo)} N° ${destDoc}` : ''}`, leftX, doc.y);
  doc.moveDown(0.35);

  if (gre.vehiculo.placa || gre.vehSec.length) {
    ensureSpace(doc, 40);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(BLUE).text('Datos de los vehículos', leftX, doc.y);
    doc.moveDown(0.15);
    if (gre.vehiculo.placa) {
      const tuce = tuceDeVehiculo(gre.vehiculo);
      doc.font('Helvetica').fontSize(8).fillColor('#111827')
        .text(`Principal: Nº de placa: ${gre.vehiculo.placa}${tuce ? `; Nº de TUCE: ${tuce}` : ''}`, leftX, doc.y);
    }
    gre.vehSec.forEach((v, i) => {
      const tuce = tuceDeVehiculo(v);
      doc.text(`Secundario ${i + 1}: Nº de placa: ${v?.placa || '—'}${tuce ? `; Nº de TUCE: ${tuce}` : ''}`);
    });
    doc.moveDown(0.35);
  }

  const condPrincipalNombre = gre.conductor.nombres || gre.conductor.nombre || gre.conductor.nombres_completos || '';
  const condPrincipalDoc = gre.conductor.numero_doc || gre.conductor.num_doc || '';
  if (condPrincipalDoc || gre.condSec.length) {
    ensureSpace(doc, 40);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(BLUE).text('Datos de los conductores', leftX, doc.y);
    doc.moveDown(0.15);
    if (condPrincipalDoc || condPrincipalNombre) {
      const tipo = gre.conductor.tipo_doc || gre.conductor.tipoDoc || '1';
      doc.font('Helvetica').fontSize(8).fillColor('#111827')
        .text(
          `Principal: ${labelTipoPersona(tipo)}: ${condPrincipalDoc || '—'} ${condPrincipalNombre || ''}`.trim(),
          leftX,
          doc.y,
        );
      if (gre.conductor.licencia) {
        doc.text(`Nº de licencia de conducir: ${gre.conductor.licencia}`);
      }
    }
    gre.condSec.forEach((c, i) => {
      const nom = c?.nombres || c?.nombre || '—';
      const docN = c?.numero_doc || c?.num_doc || '—';
      const tipo = c?.tipo_doc || '1';
      doc.text(`Secundario ${i + 1}: ${labelTipoPersona(tipo)}: ${docN} ${nom}`);
      if (c?.licencia) doc.text(`Nº de licencia de conducir: ${c.licencia}`);
    });
    doc.moveDown(0.35);
  }

  // Bienes / peso (SEE del contribuyente: sigue siendo un CPE completo).
  dibujarGreBienesYTraslado(doc, invoice, gre, leftX, pageW, { omitirVehiculoConductor: true });
}

function dibujarGreBienesYTraslado(doc, invoice, gre, leftX, pageW, opts = {}) {
  // —— Tabla bienes ——
  ensureSpace(doc, 80);
  doc.font('Helvetica-Bold').fontSize(9).fillColor(NAVY)
    .text('Bienes por transportar', leftX, doc.y);
  doc.moveDown(0.3);

  const cols = columnasBienes(pageW);
  let tableX = leftX;
  const headerY = doc.y;
  doc.font('Helvetica-Bold').fontSize(6);
  const headerPad = 3;
  const headerH = Math.max(
    28,
    ...cols.map((col) => Math.ceil(doc.heightOfString(col.label, {
      width: col.w - 4,
      align: 'center',
      lineGap: 0.5,
    })) + headerPad * 2),
  );
  doc.fillColor('#E5E7EB').rect(leftX, headerY, pageW, headerH).fill();
  doc.fillColor('#111827');
  doc.rect(leftX, headerY, pageW, headerH).stroke('#94A3B8');
  let hx = leftX;
  cols.forEach((col, ci) => {
    if (ci > 0) {
      doc.moveTo(hx, headerY).lineTo(hx, headerY + headerH).stroke('#CBD5E1');
    }
    hx += col.w;
  });
  tableX = leftX;
  cols.forEach((col) => {
    const textH = doc.heightOfString(col.label, { width: col.w - 4, align: 'center', lineGap: 0.5 });
    const ty = headerY + Math.max(headerPad, (headerH - textH) / 2);
    doc.text(col.label, tableX + 2, ty, {
      width: col.w - 4,
      align: 'center',
      lineGap: 0.5,
      height: headerH - 2,
    });
    tableX += col.w;
  });

  let rowY = headerY + headerH;
  const details = invoice.details || [];
  details.forEach((line, idx) => {
    const cells = celdasBien(line, idx);
    const rowHLine = alturaFilaBienes(doc, cols, cells);
    if (rowY + rowHLine > doc.page.height - 120) {
      doc.addPage({ size: 'A4', margin: 36 });
      rowY = doc.page.margins.top;
    }
    doc.rect(leftX, rowY, pageW, rowHLine).stroke('#94A3B8');
    // Líneas verticales entre columnas
    let vx = leftX;
    cols.forEach((col, ci) => {
      if (ci > 0) {
        doc.moveTo(vx, rowY).lineTo(vx, rowY + rowHLine).stroke('#CBD5E1');
      }
      vx += col.w;
    });
    tableX = leftX;
    cells.forEach((cell, cellIdx) => {
      const col = cols[cellIdx];
      const highlight = col.key === 'cant' || col.key === 'und';
      const isCod = col.key === 'cod';
      if (highlight) doc.font('Helvetica-Bold').fontSize(7).fillColor(BLUE);
      else if (isCod) doc.font('Helvetica').fontSize(6).fillColor('#111827');
      else doc.font('Helvetica').fontSize(6.5).fillColor('#111827');
      doc.text(String(cell || ''), tableX + 2.5, rowY + 3, {
        width: col.w - 5,
        align: col.align,
        lineGap: 0.5,
      });
      tableX += col.w;
    });
    doc.fillColor('#111827');
    rowY += rowHLine;
  });
  doc.y = rowY + 10;

  // —— Peso ——
  ensureSpace(doc, 40);
  doc.font('Helvetica-Bold').fontSize(8).fillColor(NAVY)
    .text('Unidad de Medida del Peso Bruto Total de la Carga:', leftX, doc.y, { continued: true });
  doc.font('Helvetica').fillColor('#111827').text(` ${gre.undPeso}`);
  doc.font('Helvetica-Bold').fontSize(8).fillColor(NAVY)
    .text('Peso Bruto Total de la Carga:', leftX, doc.y, { continued: true });
  doc.font('Helvetica').fillColor('#111827').text(` ${gre.peso || '—'}`);
  doc.moveDown(0.35);

  // —— Datos del traslado ——
  ensureSpace(doc, 60);
  doc.font('Helvetica-Bold').fontSize(9).fillColor(NAVY).text('Datos del traslado:', leftX, doc.y);
  doc.moveDown(0.2);
  doc.font('Helvetica').fontSize(8).fillColor('#111827')
    .text(`Modalidad de Traslado: ${gre.mod === '01' ? 'Público' : 'Privado'}`);
  doc.text('Indicador de transbordo programado: NO');
  doc.text(`Indicador de traslado en vehículos de categoría M1 o L: ${gre.trasladoM1L ? 'SI' : 'NO'}`);
  if (gre.mod === '01') {
    doc.text(`Indicador para registrar vehículos y conductores del transportista: ${gre.registrarVeh ? 'SI' : 'NO'}`);
  }
  doc.moveDown(0.35);

  // —— Transportista ——
  if (gre.mod === '01' && gre.transportista) {
    ensureSpace(doc, 40);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(NAVY).text('Datos del transportista:', leftX, doc.y);
    doc.moveDown(0.15);
    const t = gre.transportista;
    const tNombre = t.razon_social || t.razonSocial || '—';
    const tRuc = t.numero_doc || t.ruc || t.num_doc || '';
    doc.font('Helvetica').fontSize(8).fillColor('#111827')
      .text(`${tNombre}${tRuc ? ` - REGISTRO ÚNICO DE CONTRIBUYENTES N° ${tRuc}` : ''}`);
    if (gre.nroMtc) {
      doc.text(`Número de registro del MTC: ${gre.nroMtc}`);
    }
    doc.moveDown(0.35);
  }

  if (!opts.omitirVehiculoConductor) {
    // —— Vehículos ——
    if (gre.vehiculo.placa || gre.vehSec.length) {
      ensureSpace(doc, 50);
      doc.font('Helvetica-Bold').fontSize(9).fillColor(NAVY).text('Datos de los vehículos:', leftX, doc.y);
      doc.moveDown(0.15);
      if (gre.vehiculo.placa) {
        const tuce = tuceDeVehiculo(gre.vehiculo);
        doc.font('Helvetica').fontSize(8).fillColor('#111827')
          .text(`Principal: Número de placa: ${gre.vehiculo.placa}${tuce ? `; Número de TUCE o Certificado de Habilitación Vehicular: ${tuce}` : ''}`);
      }
      gre.vehSec.forEach((v, i) => {
        const placa = v?.placa || '—';
        const tuce = tuceDeVehiculo(v);
        doc.text(`Secundario ${i + 1}: Número de placa: ${placa}${tuce ? `; Número de TUCE o Certificado de Habilitación Vehicular: ${tuce}` : ''}`);
      });
      doc.moveDown(0.35);
    }

    // —— Conductores ——
    const condPrincipalNombre = gre.conductor.nombres || gre.conductor.nombre || gre.conductor.nombres_completos || '';
    const condPrincipalDoc = gre.conductor.numero_doc || gre.conductor.num_doc || '';
    if (condPrincipalDoc || gre.condSec.length) {
      ensureSpace(doc, 50);
      doc.font('Helvetica-Bold').fontSize(9).fillColor(NAVY).text('Datos de los conductores:', leftX, doc.y);
      doc.moveDown(0.15);
      if (condPrincipalDoc || condPrincipalNombre) {
        const tipo = gre.conductor.tipo_doc || gre.conductor.tipoDoc || '1';
        doc.font('Helvetica').fontSize(8).fillColor('#111827')
          .text(`Principal: ${condPrincipalNombre || '—'} - ${labelTipoPersona(tipo)} N° ${condPrincipalDoc || '—'}`);
        if (gre.conductor.licencia) {
          doc.text(`Número de licencia de conducir: ${gre.conductor.licencia}`);
        }
      }
      gre.condSec.forEach((c, i) => {
        const nom = c?.nombres || c?.nombre || c?.nombres_completos || '—';
        const docN = c?.numero_doc || c?.num_doc || '—';
        const tipo = c?.tipo_doc || '1';
        doc.text(`Secundario ${i + 1}: ${nom} - ${labelTipoPersona(tipo)} N° ${docN}`);
        if (c?.licencia) doc.text(`Número de licencia de conducir: ${c.licencia}`);
      });
      doc.moveDown(0.35);
    }
  }

  // —— Observaciones ——
  if (gre.observacion) {
    ensureSpace(doc, 30);
    doc.font('Helvetica-Bold').fontSize(8).fillColor(NAVY)
      .text('Observaciones:', leftX, doc.y, { continued: true });
    doc.font('Helvetica').fillColor('#111827').text(` ${gre.observacion}`);
  }

  // —— Pie SUNAT ——
  ensureSpace(doc, 50);
  doc.moveDown(0.6);
  doc.font('Helvetica').fontSize(6).fillColor(MUTED)
    .text(SUNAT_PIE, leftX, doc.y, { width: pageW, align: 'justify', lineGap: 1 });
  doc.fillColor('#111827');

  // QR se dibuja al final de la hoja
}

function dibujarQrAlFinal(doc, qrBuffer, leftX, pageW, opts = {}) {
  const qrSize = opts.size || 90;
  const label = opts.label || 'Código QR SUNAT';
  const need = qrSize + 28;
  if (doc.y + need > doc.page.height - 36) {
    doc.addPage({ size: 'A4', margin: 36 });
  }
  doc.moveDown(0.5);
  const qrX = leftX + Math.max(0, (pageW - qrSize) / 2);
  const qrY = doc.y;
  if (qrBuffer) {
    try {
      doc.image(qrBuffer, qrX, qrY, { width: qrSize, height: qrSize });
    } catch (_e) {
      doc.roundedRect(qrX, qrY, qrSize, qrSize, 4).stroke('#CBD5E1');
    }
  } else {
    doc.roundedRect(qrX, qrY, qrSize, qrSize, 4).stroke('#CBD5E1');
    doc.font('Helvetica').fontSize(7).fillColor(MUTED)
      .text('QR', qrX, qrY + qrSize / 2 - 4, { width: qrSize, align: 'center' });
  }
  doc.font('Helvetica-Bold').fontSize(7).fillColor(BLUE)
    .text(label, leftX, qrY + qrSize + 4, { width: pageW, align: 'center' });
  doc.fillColor('#111827');
  doc.y = qrY + qrSize + 18;
}

/**
 * Ticket térmico GRE — mismos datos, apilados.
 * @param {PDFKit.PDFDocument} doc
 * @param {object} invoice
 * @param {Buffer|null} qrBuffer
 * @param {{ y: number, margin: number, contentW: number }} ctx
 * @param {{ logoBuffer?: Buffer|null }} [opts]
 */
function dibujarGreTicket(doc, invoice, qrBuffer, ctx, opts = {}) {
  const gre = extractGre(invoice);
  let { y, margin, contentW } = ctx;
  const setY = (ny) => { y = ny; ctx.y = ny; };
  const logoBuffer = opts.logoBuffer || null;

  const textCenter = (t, size = 8, bold = false) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size).text(t, margin, y, {
      width: contentW,
      align: 'center',
    });
    setY(doc.y + 2);
  };
  const textLeft = (t, size = 8, bold = false, color = '#111827') => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size).fillColor(color)
      .text(t, margin, y, { width: contentW });
    doc.fillColor('#111827');
    setY(doc.y + 1);
  };
  const sep = () => {
    doc.moveTo(margin, y).lineTo(margin + contentW, y).strokeColor('#CBD5E1').stroke();
    setY(y + 6);
  };

  const company = gre.company;
  if (logoBuffer) {
    setY(dibujarEmisorConLogo(doc, {
      company,
      logoBuffer,
      x: margin,
      y,
      width: contentW,
      logoSize: 28,
      nombreSize: 9,
      razonSize: 7,
      align: 'center',
      fillNombre: NAVY,
      fillRazon: '#334155',
    }) + 2);
  } else {
    textCenter(company.nombreComercial || company.nombre || 'Emisor', 9, true);
  }
  textCenter(`RUC ${company.ruc || '—'}`, 8);
  sep();
  doc.fillColor(BLUE);
  if (gre.porEvento) {
    textCenter(gre.tituloLinea1, 7.5, true);
    textCenter(gre.tituloLinea2, 8, true);
  } else {
    textCenter(gre.tituloDoc, 7.5, true);
  }
  textCenter(`N° ${gre.numero}`, 10, true);
  doc.fillColor('#111827');
  textCenter(`Emisión: ${formatFechaHora(invoice.fechaEmision || invoice.fecha_emision)}`, 7);
  if (gre.porEvento) {
    const evLabel = gre.descEvento
      || (gre.tipoEvento ? `Evento ${gre.tipoEvento}` : 'GRE por evento');
    textLeft('DATOS DE EMISIÓN', 7, true, BLUE);
    textLeft(`Tipo de Evento: ${evLabel}`, 7.5, true, NAVY);
  }
  sep();

  if (gre.porEvento) {
    textLeft('DOCUMENTOS RELACIONADOS', 7, true, BLUE);
    if (gre.docs.length) {
      gre.docs.forEach((d) => {
        const t = String(d.tipo_doc || '').padStart(2, '0');
        const tipoGre = t === '31' ? 'GRE Transportista' : (t === '09' ? 'GRE Remitente' : 'Doc');
        textLeft(`${tipoGre} N° ${d.serie || ''}-${d.correlativo || ''}`, 7.5);
      });
    } else {
      textLeft('—', 7.5);
    }
    sep();
    textLeft('PUNTO DE PARTIDA', 7, true, BLUE);
    textLeft(direccionTexto(gre.partida) || '—', 7.5);
    textLeft('PUNTO DE LLEGADA', 7, true, BLUE);
    textLeft(direccionTexto(gre.llegada) || '—', 7.5);
    sep();
    textLeft('DESTINATARIO', 7, true, MUTED);
    textLeft(gre.cliente.razonSocial || gre.cliente.razon_social || '—', 8, true);
    if (gre.cliente.numeroDoc || gre.cliente.numero_doc) {
      textLeft(`${labelTipoPersona(gre.cliente.tipoDoc || gre.cliente.tipo_doc)}: ${gre.cliente.numeroDoc || gre.cliente.numero_doc}`, 7.5);
    }
    sep();
  } else {
    textLeft('TRASLADO', 7, true, MUTED);
    textLeft(`Inicio: ${formatFechaCorta(gre.fechaTraslado)}`, 8);
    if (gre.mod === '01' && gre.fechaEntrega) {
      textLeft(`Entrega transportista: ${formatFechaCorta(gre.fechaEntrega)}`, 8);
    }
    textLeft(`Motivo: ${gre.motivo?.titulo || gre.envio.cod_traslado || '—'}`, 8);
    textLeft(`Modalidad: ${gre.mod === '01' ? 'Público' : 'Privado'}`, 8);
    textLeft('Transbordo programado: NO', 7);
    textLeft(`Vehículos M1 o L: ${gre.trasladoM1L ? 'SI' : 'NO'}`, 7);
    if (gre.mod === '01') {
      textLeft(`Registrar veh./cond. transportista: ${gre.registrarVeh ? 'SI' : 'NO'}`, 7);
    }
    sep();

    textLeft('RUTA', 7, true, MUTED);
    textLeft(`Partida: ${direccionTexto(gre.partida) || '—'}`, 7.5);
    textLeft(`Llegada: ${direccionTexto(gre.llegada) || '—'}`, 7.5);
    sep();

    textLeft('DESTINATARIO', 7, true, MUTED);
    textLeft(gre.cliente.razonSocial || gre.cliente.razon_social || '—', 8, true);
    if (gre.cliente.numeroDoc || gre.cliente.numero_doc) {
      textLeft(`${labelTipoPersona(gre.cliente.tipoDoc || gre.cliente.tipo_doc)}: ${gre.cliente.numeroDoc || gre.cliente.numero_doc}`, 7.5);
    }

    if (gre.docs.length) {
      sep();
      textLeft('DOCS. RELACIONADOS', 7, true, MUTED);
      gre.docs.forEach((d) => {
        const tipo = TIPO_DOC_LABEL[String(d.tipo_doc || '').padStart(2, '0')] || 'Doc';
        textLeft(`${tipo} ${d.serie || ''}-${d.correlativo || ''}${d.emisor_ruc ? ` RUC ${d.emisor_ruc}` : ''}`, 7.5);
      });
    }
    sep();
  }

  textLeft('BIENES', 7, true, MUTED);
  (invoice.details || []).forEach((line, idx) => {
    textLeft(`${idx + 1}. ${line.descripcion || line.nombre || 'Ítem'}`, 8, true);
    const cant = toNumber(line.cantidad, 1);
    const qty = Number.isInteger(cant) ? String(cant) : cant.toFixed(2);
    doc.font('Helvetica-Bold').fontSize(8).fillColor(BLUE)
      .text(`${qty} ${unidadMedidaCompleta(line.unidad)}`, margin, y, { width: contentW });
    doc.fillColor('#111827');
    setY(doc.y + 3);
  });
  sep();

  textLeft(`Peso bruto: ${gre.peso || '—'} ${gre.undPeso}`, 8, true);
  sep();

  if (gre.mod === '01' && gre.transportista) {
    textLeft('TRANSPORTISTA', 7, true, MUTED);
    textLeft(gre.transportista.razon_social || gre.transportista.razonSocial || '—', 8, true);
    const tRuc = gre.transportista.numero_doc || gre.transportista.ruc || '';
    if (tRuc) textLeft(`RUC: ${tRuc}`, 7.5);
    if (gre.nroMtc) textLeft(`MTC: ${gre.nroMtc}`, 7.5);
    sep();
  }

  if (gre.vehiculo.placa || gre.vehSec.length) {
    textLeft('VEHÍCULOS', 7, true, MUTED);
    if (gre.vehiculo.placa) {
      const tuce = tuceDeVehiculo(gre.vehiculo);
      textLeft(`Principal: ${gre.vehiculo.placa}${tuce ? ` · TUCE ${tuce}` : ''}`, 7.5);
    }
    gre.vehSec.forEach((v, i) => {
      const tuce = tuceDeVehiculo(v);
      textLeft(`Sec. ${i + 1}: ${v?.placa || '—'}${tuce ? ` · TUCE ${tuce}` : ''}`, 7.5);
    });
    sep();
  }

  const condNombre = gre.conductor.nombres || gre.conductor.nombre || '';
  const condDoc = gre.conductor.numero_doc || gre.conductor.num_doc || '';
  if (condDoc || gre.condSec.length) {
    textLeft('CONDUCTORES', 7, true, MUTED);
    if (condDoc || condNombre) {
      textLeft(`Principal: ${condNombre || '—'}`, 7.5);
      textLeft(`Doc: ${condDoc}${gre.conductor.licencia ? ` · Lic. ${gre.conductor.licencia}` : ''}`, 7.5);
    }
    gre.condSec.forEach((c, i) => {
      textLeft(`Sec. ${i + 1}: ${c?.nombres || c?.nombre || '—'}`, 7.5);
      textLeft(`Doc: ${c?.numero_doc || c?.num_doc || '—'}${c?.licencia ? ` · Lic. ${c.licencia}` : ''}`, 7.5);
    });
    sep();
  }

  if (gre.observacion) {
    textLeft('OBSERVACIONES', 7, true, MUTED);
    textLeft(gre.observacion, 7.5);
    sep();
  }

  doc.font('Helvetica').fontSize(5).fillColor(MUTED)
    .text(SUNAT_PIE, margin, y, { width: contentW, align: 'center', lineGap: 1 });
  setY(doc.y + 6);
  doc.fillColor('#111827');
  sep();

  // QR siempre al final del ticket
  if (qrBuffer) {
    const qrSize = 72;
    const qrX = margin + (contentW - qrSize) / 2;
    try {
      doc.image(qrBuffer, qrX, y, { width: qrSize, height: qrSize });
      setY(y + qrSize + 4);
      textCenter('Código QR SUNAT', 5.5);
    } catch (_e) {
      /* ignore */
    }
  }
  doc.fillColor('#111827');
}

function esGre(invoice) {
  const tipo = String(invoice?.tipoDoc || invoice?.tipo_doc || '').padStart(2, '0');
  return tipo === '09' || tipo === '31';
}

/** Estimación de alto del ticket GRE (páginas térmicas de altura fija). */
function measureGreTicketHeight(doc, invoice, margin, contentW, hasLogo = false) {
  const gre = extractGre(invoice);
  const h = (text, size = 8, bold = false) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size);
    return doc.heightOfString(String(text || '—'), { width: contentW, lineGap: 1 }) + 2;
  };
  let y = margin + 8;
  const company = gre.company;
  if (hasLogo) y += 32;
  y += h(company.nombreComercial || company.nombre || 'Emisor', 9, true);
  y += h(`RUC ${company.ruc || '—'}`, 8);
  y += 8;
  y += h(gre.tituloDoc, 7.5, true);
  y += h(`N° ${gre.numero}`, 10, true);
  y += h('Emisión', 7);
  y += 8;
  y += h('TRASLADO', 7, true) + h('Inicio') + h('Motivo') + h('Modalidad');
  if (gre.mod === '01' && gre.fechaEntrega) y += h('Entrega');
  y += h('Transbordo') + h('M1') + h('Registrar');
  y += 8;
  y += h('RUTA', 7, true)
    + h(`Partida: ${direccionTexto(gre.partida) || '—'}`, 7.5)
    + h(`Llegada: ${direccionTexto(gre.llegada) || '—'}`, 7.5);
  y += 8;
  y += h('DESTINATARIO', 7, true)
    + h(gre.cliente.razonSocial || gre.cliente.razon_social || '—', 8, true)
    + h('Doc', 7.5);
  if (gre.docs.length) {
    y += 8 + h('DOCS', 7, true);
    gre.docs.forEach((d) => {
      y += h(`${d.serie}-${d.correlativo}`, 7.5);
    });
  }
  y += 8 + h('BIENES', 7, true);
  (invoice.details || []).forEach((line) => {
    y += h(line.descripcion || line.nombre || 'Ítem', 8, true) + h('qty', 8);
  });
  y += 8 + h('Peso', 8, true);
  if (gre.mod === '01' && gre.transportista) {
    y += 8 + h('TRANSPORTISTA', 7, true) + h('nombre', 8, true) + h('RUC', 7.5) + h('MTC', 7.5);
  }
  if (gre.vehiculo.placa || gre.vehSec.length) {
    y += 8 + h('VEHÍCULOS', 7, true) + h('Principal', 7.5);
    y += gre.vehSec.length * h('Sec', 7.5);
  }
  const condDoc = gre.conductor.numero_doc || gre.conductor.num_doc || '';
  if (condDoc || gre.condSec.length) {
    y += 8 + h('CONDUCTORES', 7, true) + h('Principal', 7.5) + h('Doc', 7.5);
    y += gre.condSec.length * (h('Sec', 7.5) + h('Doc', 7.5));
  }
  if (gre.observacion) y += 8 + h('OBS', 7, true) + h(gre.observacion, 7.5);
  y += 8 + 80 + h(SUNAT_PIE, 5) + margin + 20;
  return Math.min(3200, Math.max(520, Math.ceil(y)));
}

module.exports = {
  esGre,
  extractGre,
  dibujarGreFormal,
  dibujarGreTicket,
  dibujarQrAlFinal,
  measureGreTicketHeight,
};

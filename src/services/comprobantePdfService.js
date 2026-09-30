const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const { parseStoredTimestamp } = require('../utils/fechas');
const {
  esGre,
  dibujarGreFormal,
  dibujarGreTicket,
  dibujarQrAlFinal,
  measureGreTicketHeight,
} = require('./comprobantePdfGre');
const { loadCompanyLogoBuffer } = require('./companyLogoService');
const { dibujarEmisorConLogo } = require('./comprobantePdfHeader');

const TIPO_DOC_LABEL = {
  '01': 'FACTURA ELECTRÓNICA',
  '03': 'BOLETA DE VENTA ELECTRÓNICA',
  '07': 'NOTA DE CRÉDITO ELECTRÓNICA',
  '08': 'NOTA DE DÉBITO ELECTRÓNICA',
  '09': 'GUÍA DE REMISIÓN ELECTRÓNICA REMITENTE',
  '31': 'GUÍA DE REMISIÓN ELECTRÓNICA TRANSPORTISTA',
};

/** Catálogo 09 SUNAT — motivo de nota de crédito. */
const MOTIVO_NC_LABEL = {
  '01': 'Anulación de la operación',
  '02': 'Anulación por error en el RUC',
  '03': 'Corrección por error en la descripción',
  '04': 'Descuento global',
  '05': 'Descuento por ítem',
  '06': 'Devolución total',
  '07': 'Devolución por ítem',
  '08': 'Bonificación',
  '09': 'Disminución en el valor',
  '10': 'Otros conceptos',
  '11': 'Ajustes de operaciones de exportación',
  '12': 'Ajustes afectos al IVAP',
  '13': 'Ajustes – montos y/o fechas de pago',
};

/** Catálogo 10 SUNAT — motivo de nota de débito. */
const MOTIVO_ND_LABEL = {
  '01': 'Intereses por mora',
  '02': 'Aumento en el valor',
  '03': 'Penalidades / otros conceptos',
  '04': 'Ajustes de operaciones de exportación',
  '05': 'Ajustes afectos al IVAP',
};

function esNotaElectronica(invoice) {
  const tipo = String(invoice.tipoDoc || invoice.tipo_doc || '').padStart(2, '0');
  return tipo === '07' || tipo === '08';
}

function datosNota(invoice) {
  if (!esNotaElectronica(invoice)) return null;
  const tipo = String(invoice.tipoDoc || invoice.tipo_doc || '').padStart(2, '0');
  const codigo = String(invoice.motivoCodigo || invoice.motivo_codigo || '').trim();
  const catalogo = tipo === '08' ? MOTIVO_ND_LABEL : MOTIVO_NC_LABEL;
  const titulo = catalogo[codigo] || '';
  const glosa = String(invoice.motivoNota || invoice.motivo_nota || '').trim();
  const doc = invoice.documentoAfectado || invoice.documento_afectado || {};
  const tipoAfectado = String(doc.tipoDoc || doc.tipo_doc || '').padStart(2, '0');
  const serie = String(doc.serie || '').trim();
  const correlativo = String(doc.correlativo || '').trim();
  const documento = (serie || correlativo)
    ? `${TIPO_DOC_LABEL[tipoAfectado] || 'DOCUMENTO'} ${serie}-${correlativo}`
    : '';
  const motivo = codigo && titulo ? `${codigo} — ${titulo}` : (titulo || glosa || codigo);
  const glosaExtra = glosa && titulo && glosa.toLowerCase() !== titulo.toLowerCase() ? glosa : '';
  return {
    documento: documento || '—',
    motivo: motivo || '—',
    glosa: glosaExtra,
  };
}

const TIPO_DOC_CLIENTE = {
  1: 'DNI',
  4: 'CARNET EXTRANJERIA',
  6: 'RUC',
  7: 'PASAPORTE',
  0: 'DOC. TRIB. NO DOM.',
};

const UNIDAD_LABEL = {
  NIU: 'UNIDAD',
  ZZ: 'SERVICIO',
  KGM: 'KILO',
  LTR: 'LITRO',
  MTR: 'METRO',
};

const SUNAT_PIE = 'Esta es una representación impresa del comprobante electrónico, generada en el Sistema de la SUNAT. '
  + 'El Emisor Electrónico puede verificarla utilizando su clave SOL; el Adquirente o Usuario puede consultar '
  + 'su validez en SUNAT Virtual: www.sunat.gob.pe, en Opciones sin Clave SOL / Consulta de Validez del CPE.';

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function formatMoney(value, symbol = 'S/') {
  return `${symbol} ${toNumber(value).toFixed(2)}`;
}

function formatMoneyPlain(value) {
  return toNumber(value).toFixed(2);
}

function formatFechaEmision(value) {
  return formatFechaHora(value);
}

function formatFechaCorta(value) {
  const ms = parseStoredTimestamp(value);
  if (ms == null) {
    const raw = String(value || '').trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
      const [y, m, d] = raw.slice(0, 10).split('-');
      return `${d}/${m}/${y}`;
    }
    return raw || '—';
  }
  return new Date(ms).toLocaleDateString('es-PE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'America/Lima',
  });
}

function formatFechaHora(value) {
  const ms = parseStoredTimestamp(value);
  if (ms == null) {
    const raw = String(value || '').trim();
    return raw || '—';
  }
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

/** Paleta formal factura/boleta (cyan refinado). */
const PDF_FE = {
  accent: '#0E8F9A',
  accentSoft: '#D6F3F5',
  accentMid: '#7ED4DB',
  ink: '#0F172A',
  muted: '#475569',
  line: '#94A3B8',
  lineSoft: '#CBD5E1',
  white: '#FFFFFF',
};

function unidadLabel(unidad) {
  return UNIDAD_LABEL[String(unidad || 'NIU').toUpperCase()] || String(unidad || 'NIU').toUpperCase();
}

function unidadMedidaCompleta(unidad) {
  const cod = String(unidad || 'NIU').trim().toUpperCase() || 'NIU';
  return `${unidadLabel(cod)} (${cod})`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function numeroSerieLineaPdf(line) {
  const nested = line.producto_serie || line.productoSerie;
  if (nested && typeof nested === 'object') {
    const n = String(nested.numero_serie || nested.numeroSerie || '').trim();
    if (n) return n;
  }
  return String(line.numero_serie || line.numeroSerie || '').trim();
}

function codigoBienPdf(line) {
  const serie = numeroSerieLineaPdf(line);
  if (serie) return serie;
  const codigo = String(line.codigo || '').trim();
  if (codigo) return codigo;
  const cat = line.catalogItem || line.catalog_item;
  const codigoCat = cat ? String(cat.codigo || '').trim() : '';
  if (codigoCat) return codigoCat;
  const raw = String(line.catalog_item_id || line.catalogItemId || '').trim();
  if (!raw || UUID_RE.test(raw)) return '';
  return raw;
}

function codigoSunatPdf(line) {
  return String(line.codigo_sunat || line.codigoSunat || '').trim();
}

function columnasDetalleSunat(pageW, incluirPrecios = true) {
  // Etiquetas en 2–3 líneas cortas: evitan que PDFKit parta palabras a mitad.
  const fijos = [
    { key: 'n', label: 'N°', w: 16, align: 'center' },
    { key: 'bien', label: 'Bien\nnormalizado', w: 44, align: 'center' },
    { key: 'cod', label: 'Código\nde Bien', w: 46, align: 'center' },
    { key: 'sunat', label: 'Código\nproducto\nSUNAT', w: 42, align: 'center' },
    { key: 'partida', label: 'Partida\narancelaria', w: 46, align: 'center' },
    { key: 'gtin', label: 'Código\nGTIN', w: 34, align: 'center' },
  ];
  const fin = [
    { key: 'und', label: 'Unidad\nde medida', w: 48, align: 'center' },
    { key: 'cant', label: 'Cantidad', w: 36, align: 'right' },
  ];
  const venta = incluirPrecios
    ? [
      { key: 'pu', label: 'P. Unit.(*)', w: 42, align: 'right' },
      { key: 'imp', label: 'Importe(**)', w: 44, align: 'right' },
    ]
    : [];
  const usado = [...fijos, ...fin, ...venta].reduce((s, c) => s + c.w, 0);
  const descW = Math.max(72, pageW - usado);
  return [
    ...fijos,
    { key: 'desc', label: 'Descripción\ndetallada', w: descW, align: 'left' },
    ...fin,
    ...venta,
  ];
}

function celdasDetalleSunat(line, idx, incluirPrecios = true) {
  const cantidad = toNumber(line.cantidad, 1);
  const valorUnit = toNumber(line.mto_valor_unitario ?? line.mtoValorUnitario)
    || toNumber(line.mto_precio_unitario ?? line.mtoPrecioUnitario) / 1.18;
  const importe = toNumber(line.mto_valor_venta ?? line.mtoValorVenta)
    || toNumber(line.total ?? line.totalFactura) - toNumber(line.mto_igv ?? line.mtoIgv);
  const desc = line.descripcion || line.nombre || 'Ítem';
  const base = [
    String(idx + 1),
    'NO',
    codigoBienPdf(line),
    codigoSunatPdf(line),
    '',
    '',
    desc,
    unidadMedidaCompleta(line.unidad),
    cantidad.toFixed(2),
  ];
  if (!incluirPrecios) return base;
  return [...base, valorUnit.toFixed(4), importe.toFixed(2)];
}

function labelTipoDocCliente(tipoDoc) {
  return TIPO_DOC_CLIENTE[String(tipoDoc || '1')] || 'DOCUMENTO';
}

function direccionEmpresa(company) {
  const addr = company?.addressJson || company?.address;
  if (!addr) return '';
  const partes = [
    addr.direccion,
    [addr.distrito, addr.provincia, addr.departamento].filter(Boolean).join(' - '),
  ].filter(Boolean);
  return partes.join('\n');
}

function unidades(num) {
  const unidadesArr = [
    '', 'UNO', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE', 'DIEZ',
    'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE', 'DIECISÉIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE',
  ];
  const decenasArr = ['', '', 'VEINTE', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
  const centenasArr = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS', 'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS'];

  if (num === 0) return 'CERO';
  if (num === 100) return 'CIEN';
  if (num < 20) return unidadesArr[num];
  if (num < 100) {
    const d = Math.floor(num / 10);
    const u = num % 10;
    if (num < 30) return u === 0 ? 'VEINTE' : `VEINTI${unidadesArr[u].toLowerCase()}`.replace('veintiuno', 'veintiún').toUpperCase();
    return u === 0 ? decenasArr[d] : `${decenasArr[d]} Y ${unidadesArr[u]}`;
  }
  if (num < 1000) {
    const c = Math.floor(num / 100);
    const resto = num % 100;
    const base = num === 100 ? 'CIEN' : centenasArr[c];
    return resto === 0 ? base : `${base} ${unidades(resto)}`;
  }
  if (num < 1000000) {
    const miles = Math.floor(num / 1000);
    const resto = num % 1000;
    const pref = miles === 1 ? 'MIL' : `${unidades(miles)} MIL`;
    return resto === 0 ? pref : `${pref} ${unidades(resto)}`;
  }
  const millones = Math.floor(num / 1000000);
  const resto = num % 1000000;
  const pref = millones === 1 ? 'UN MILLÓN' : `${unidades(millones)} MILLONES`;
  return resto === 0 ? pref : `${pref} ${unidades(resto)}`;
}

function montoEnLetras(monto) {
  const total = toNumber(monto);
  const entero = Math.floor(total);
  const centimos = Math.round((total - entero) * 100);
  return `SON: ${unidades(entero)} Y ${String(centimos).padStart(2, '0')}/100 SOLES`;
}

/** Fecha emisión YYYY-MM-DD (calendario Perú) para QR SUNAT. */
function fechaEmisionIsoPe(value) {
  const ms = parseStoredTimestamp(value);
  if (ms == null) {
    const raw = String(value || '').trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
    return '';
  }
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms));
}

/**
 * Cadena pipe-delimited QR SUNAT (Anexo F RS 185-2015 / 340-2017).
 * RUC|TIPO|SERIE|NUMERO|IGV|TOTAL|FECHA|TIPO_DOC_CLIENTE|NUM_DOC_CLIENTE|HASH
 */
function buildSunatQrPayload(invoice) {
  const company = invoice.company || {};
  const cliente = invoice.cliente || invoice.client || {};
  const ruc = String(company.ruc || invoice.companyRuc || invoice.company_ruc || '').trim();
  if (!ruc) return '';

  const tipo = String(invoice.tipoDoc || invoice.tipo_doc || '').padStart(2, '0').slice(0, 2) || '00';
  const serie = String(invoice.serie || '').trim();
  const correlativo = String(invoice.correlativo || '').trim();
  const igv = formatMoneyPlain(invoice.mtoIgv ?? invoice.mto_igv);
  const total = formatMoneyPlain(invoice.mtoImpVenta ?? invoice.mto_imp_venta);
  const fecha = fechaEmisionIsoPe(invoice.fechaEmision ?? invoice.fecha_emision);
  const tipoCliente = String(cliente.tipoDoc || cliente.tipo_doc || '-').trim() || '-';
  const numCliente = String(cliente.numeroDoc || cliente.numero_doc || '-').trim() || '-';
  const hash = String(
    invoice.hash
    || invoice.hashCpe
    || invoice.hash_cpe
    || invoice.hashCpeDirecto
    || '',
  ).trim();

  return [ruc, tipo, serie, correlativo, igv, total, fecha, tipoCliente, numCliente, hash].join('|');
}

async function generarQrPngBuffer(invoice, size = 180) {
  const payload = buildSunatQrPayload(invoice);
  if (!payload) return null;
  try {
    return await QRCode.toBuffer(payload, {
      type: 'png',
      errorCorrectionLevel: 'M',
      margin: 1,
      width: size,
      color: { dark: '#000000', light: '#FFFFFF' },
    });
  } catch (_e) {
    return null;
  }
}

function createPdfBuffer(buildFn) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ autoFirstPage: false });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    Promise.resolve()
      .then(() => buildFn(doc))
      .then(() => doc.end())
      .catch(reject);
  });
}

function dibujarPaginaResumen(doc, invoice) {
  doc.addPage({ size: 'A4', margin: 40 });
  const company = invoice.company || {};
  const cliente = invoice.cliente || {};
  const tipoLabel = TIPO_DOC_LABEL[invoice.tipoDoc] || 'COMPROBANTE ELECTRÓNICO';
  const numero = `${invoice.serie}-${invoice.correlativo}`;
  const pageW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const leftX = doc.page.margins.left;
  let y = doc.page.margins.top;

  doc.font('Helvetica-Bold').fontSize(16).fillColor('#0B1F33')
    .text('RESUMEN DEL COMPROBANTE', leftX, y, { width: pageW, align: 'center' });
  y = doc.y + 6;
  doc.font('Helvetica').fontSize(9).fillColor('#64748b')
    .text('Cara posterior · representación de apoyo', leftX, y, { width: pageW, align: 'center' });
  y = doc.y + 14;
  doc.moveTo(leftX, y).lineTo(leftX + pageW, y).strokeColor('#cbd5e1').stroke();
  doc.strokeColor('#000000');
  y += 16;

  const boxH = 72;
  doc.roundedRect(leftX, y, pageW, boxH, 8).fillAndStroke('#F3F8FF', '#B6D0F2');
  doc.fillColor('#0B1F33');
  doc.font('Helvetica-Bold').fontSize(11).text(tipoLabel, leftX + 14, y + 12, { width: pageW - 28 });
  doc.font('Helvetica-Bold').fontSize(14).text(numero, leftX + 14, doc.y + 2, { width: pageW - 28 });
  doc.font('Helvetica').fontSize(9).fillColor('#334155')
    .text(`Emisión: ${formatFechaHora(invoice.fechaEmision)} · Estado: ${invoice.estado || '—'}`, leftX + 14, doc.y + 2);
  y += boxH + 18;
  doc.fillColor('#000000');

  const notaResumen = datosNota(invoice);
  const rows = [
    ['Emisor', company.nombreComercial || company.nombre || '—'],
    ['RUC emisor', company.ruc || '—'],
    ['Cliente', cliente.razonSocial || cliente.nombre || '—'],
    ['Doc. cliente', `${labelTipoDocCliente(cliente.tipoDoc)} ${cliente.numeroDoc || '—'}`],
    ['Moneda', invoice.tipoMoneda === 'PEN' ? 'SOLES (PEN)' : (invoice.tipoMoneda || 'PEN')],
  ];
  if (notaResumen) {
    rows.push(['Doc. que modifica', notaResumen.documento]);
    rows.push(['Motivo', notaResumen.motivo]);
    if (notaResumen.glosa) rows.push(['Descripción', notaResumen.glosa]);
  } else {
    rows.push(['Observación', invoice.observacion || '—']);
  }
  doc.font('Helvetica-Bold').fontSize(10).text('Datos generales', leftX, y);
  y = doc.y + 8;
  rows.forEach(([label, value]) => {
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#64748b').text(label, leftX, y, { width: 110 });
    doc.font('Helvetica').fontSize(9).fillColor('#0B1F33')
      .text(String(value || '—'), leftX + 114, y, { width: pageW - 114 });
    y = Math.max(y + 14, doc.y + 4);
  });

  y += 8;
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#0B1F33').text('Detalle', leftX, y);
  y = doc.y + 8;
  const details = invoice.details || [];
  details.slice(0, 18).forEach((line, idx) => {
    const desc = line.descripcion || line.nombre || 'Ítem';
    const cant = toNumber(line.cantidad);
    const pu = toNumber(line.mtoPrecioUnitario ?? line.mto_precio_unitario);
    const tot = toNumber(line.mtoValorVenta ?? line.mto_valor_venta ?? (cant * pu));
    if (y > doc.page.height - 160) return;
    doc.font('Helvetica').fontSize(8).fillColor('#0B1F33')
      .text(`${idx + 1}. ${desc}`, leftX, y, { width: pageW - 90 });
    const lineEnd = doc.y;
    doc.text(`${cant} × S/ ${formatMoneyPlain(pu)}`, leftX + pageW - 88, y, { width: 88, align: 'right' });
    y = Math.max(lineEnd, doc.y) + 2;
    doc.font('Helvetica').fontSize(7).fillColor('#64748b')
      .text(`Subtotal S/ ${formatMoneyPlain(tot)}`, leftX + 12, y, { width: pageW - 12 });
    y = doc.y + 6;
  });
  if (details.length > 18) {
    doc.font('Helvetica').fontSize(8).fillColor('#64748b')
      .text(`… y ${details.length - 18} ítem(s) más`, leftX, y);
    y = doc.y + 10;
  }

  y += 6;
  doc.roundedRect(leftX, y, pageW, 56, 8).fillAndStroke('#EEF6FF', '#90CAF9');
  doc.fillColor('#0B1F33');
  doc.font('Helvetica').fontSize(9).text('Op. gravada', leftX + 14, y + 10);
  doc.text(`S/ ${formatMoneyPlain(invoice.mtoOperGravadas)}`, leftX + pageW - 100, y + 10, { width: 86, align: 'right' });
  doc.text('IGV', leftX + 14, y + 24);
  doc.text(`S/ ${formatMoneyPlain(invoice.mtoIgv)}`, leftX + pageW - 100, y + 24, { width: 86, align: 'right' });
  doc.font('Helvetica-Bold').fontSize(11).text('Total', leftX + 14, y + 38);
  doc.text(`S/ ${formatMoneyPlain(invoice.mtoImpVenta)}`, leftX + pageW - 100, y + 38, { width: 86, align: 'right' });
  y += 70;

  doc.font('Helvetica').fontSize(8).fillColor('#334155')
    .text(montoEnLetras(invoice.mtoImpVenta), leftX, y, { width: pageW });
  y = doc.y + 14;

  doc.font('Helvetica').fontSize(7).fillColor('#94a3b8')
    .text('Esta página es un resumen interno del comprobante. La cara anterior es la representación impresa oficial.', leftX, Math.max(y, doc.page.height - 50), {
      width: pageW,
      align: 'center',
    });
  doc.fillColor('#000000');
}

async function generarPdfFormal(invoice) {
  const qrBuffer = await generarQrPngBuffer(invoice, 280);
  const logoBuffer = await loadCompanyLogoBuffer(invoice.company);

  if (esGre(invoice)) {
    return createPdfBuffer((doc) => {
      doc.addPage({ size: 'A4', margin: 36 });
      dibujarGreFormal(doc, invoice, { logoBuffer });
      const leftX = doc.page.margins.left;
      const pageW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      dibujarQrAlFinal(doc, qrBuffer, leftX, pageW);
    });
  }

  return createPdfBuffer((doc) => {
    doc.addPage({ size: 'A4', margin: 28 });
    dibujarFeFormal(doc, invoice, { logoBuffer, qrBuffer });
  });
}

function direccionClientePdf(cliente) {
  const addr = cliente?.addressJson || cliente?.address || {};
  const partes = [
    addr.direccion || cliente?.direccion || '',
    [addr.distrito, addr.provincia, addr.departamento].filter(Boolean).join(' - '),
  ].filter(Boolean);
  return partes.join(', ') || '—';
}

function contactoEmpresaPdf(company) {
  const parts = [];
  const emails = [];
  if (company.email) emails.push(String(company.email).trim());
  if (Array.isArray(company.emails)) {
    company.emails.forEach((e) => {
      const s = typeof e === 'string' ? e : (e?.email || e?.correo || '');
      if (s && !emails.includes(s)) emails.push(String(s).trim());
    });
  }
  if (emails.length) parts.push(`Email: ${emails.join(' / ')}`);

  const tels = [];
  if (company.telefono) tels.push(String(company.telefono).trim());
  if (Array.isArray(company.telefonos)) {
    company.telefonos.forEach((t) => {
      const s = typeof t === 'string' ? t : (t?.numero || t?.telefono || t?.valor || '');
      if (s && !tels.includes(String(s).trim())) tels.push(String(s).trim());
    });
  }
  if (tels.length) parts.push(`Telf: ${tels.join(' / ')}`);
  return parts.join('   ·   ');
}

function clientePdfFields(cliente) {
  return {
    razon: cliente.razonSocial || cliente.razon_social || cliente.nombre || '—',
    tipoDoc: cliente.tipoDoc || cliente.tipo_doc || '6',
    numeroDoc: cliente.numeroDoc || cliente.numero_doc || '—',
    telefono: cliente.telefono || '',
    direccion: direccionClientePdf(cliente),
  };
}

function formatMoneyDisplay(value) {
  return toNumber(value).toLocaleString('es-PE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Solo el método elegido en el comprobante (no todos los de la empresa). */
function metodoPagoSeleccionadoPdf(invoice) {
  const m = invoice.metodoPago || invoice.metodo_pago || null;
  if (!m) return null;
  const tipo = String(m.tipo || '').toUpperCase();
  const valor = tipo === 'EFECTIVO' ? '' : String(m.valor || '').trim();
  return {
    id: m.id || null,
    nombre: m.nombre || m.tipo || 'Pago',
    tipo,
    valor,
  };
}

function totalesFeRows(invoice) {
  const rows = [];
  const grav = toNumber(invoice.mtoOperGravadas ?? invoice.mto_oper_gravadas);
  const exo = toNumber(invoice.mtoOperExoneradas ?? invoice.mto_oper_exoneradas);
  const ina = toNumber(invoice.mtoOperInafectas ?? invoice.mto_oper_inafectas);
  const exp = toNumber(invoice.mtoOperExportacion ?? invoice.mto_oper_exportacion);
  const igv = toNumber(invoice.mtoIgv ?? invoice.mto_igv);
  const total = toNumber(invoice.mtoImpVenta ?? invoice.mto_imp_venta);
  const sub = toNumber(invoice.subTotal ?? invoice.sub_total) || grav;

  rows.push(['Op. Gravada', formatMoneyDisplay(grav || sub)]);
  if (exo > 0) rows.push(['Op. Exonerada', formatMoneyDisplay(exo)]);
  if (ina > 0) rows.push(['Op. Inafecta', formatMoneyDisplay(ina)]);
  if (exp > 0) rows.push(['Op. Exportación', formatMoneyDisplay(exp)]);
  rows.push(['I.G.V. 18%', formatMoneyDisplay(igv)]);
  rows.push(['TOTAL', formatMoneyDisplay(total)]);
  return rows;
}

function documentosRelacionadosPdf(invoice) {
  const api = Array.isArray(invoice.documentos_relacionados)
    ? invoice.documentos_relacionados
    : (Array.isArray(invoice.facturas) ? invoice.facturas : []);
  if (api.length) return api;
  const lines = Array.isArray(invoice.lineInvoices) ? invoice.lineInvoices : [];
  return lines
    .map((line) => line?.invoice2)
    .filter(Boolean)
    .map((inv) => ({
      tipo_doc: inv.tipoDoc || inv.tipo_doc,
      serie: inv.serie,
      correlativo: inv.correlativo,
      emisor_numero_doc: inv.companyRuc || inv.company_ruc,
    }));
}

function guiasRelacionadasTexto(invoice) {
  const docs = documentosRelacionadosPdf(invoice).filter((d) => {
    const t = String(d.tipo_doc || d.tipoDoc || '').padStart(2, '0');
    return t === '09' || t === '31';
  });
  if (!docs.length) return '';
  const corto = { '09': 'GRE remitente', '31': 'GRE transportista' };
  return docs
    .map((d) => {
      const t = String(d.tipo_doc || d.tipoDoc || '').padStart(2, '0');
      const ref = `${d.serie || ''}-${d.correlativo || d.numero || ''}`.replace(/^-|-$/g, '');
      if (!ref) return '';
      return `${corto[t] || 'GRE'} ${ref}`;
    })
    .filter(Boolean)
    .join(', ');
}

/** Líneas para ticket/formal: todos los CPE relacionados con etiqueta clara. */
function documentosRelacionadosLineas(invoice) {
  const docs = documentosRelacionadosPdf(invoice);
  if (!docs.length) return [];
  const corto = {
    '01': 'Factura',
    '03': 'Boleta',
    '09': 'GRE remitente',
    '31': 'GRE transportista',
    '07': 'Nota crédito',
    '08': 'Nota débito',
  };
  return docs
    .map((d) => {
      const t = String(d.tipo_doc || d.tipoDoc || '').padStart(2, '0');
      const ref = `${d.serie || ''}-${d.correlativo || d.numero || ''}`.replace(/^-|-$/g, '');
      if (!ref) return '';
      const emisor = String(d.emisor_numero_doc || d.emisorNumeroDoc || d.emisor_ruc || '').replace(/\D/g, '');
      return `${corto[t] || `Tipo ${t || '—'}`} ${ref}${emisor ? ` · RUC ${emisor}` : ''}`;
    })
    .filter(Boolean);
}

function columnasDetalleFe(pageW) {
  const cant = 42;
  const um = 48;
  const pu = 68;
  const vta = 72;
  const desc = Math.max(160, pageW - cant - um - pu - vta);
  return [
    { key: 'cant', label: 'CANT.', w: cant, align: 'center' },
    { key: 'um', label: 'U.M.', w: um, align: 'center' },
    { key: 'desc', label: 'DESCRIPCIÓN', w: desc, align: 'left' },
    { key: 'pu', label: 'P. UNIT.', w: pu, align: 'right' },
    { key: 'vta', label: 'VALOR VTA.', w: vta, align: 'right' },
  ];
}

function celdasDetalleFe(line) {
  const cantidad = toNumber(line.cantidad, 1);
  const precio = toNumber(
    line.mto_precio_unitario ?? line.mtoPrecioUnitario
      ?? ((toNumber(line.mto_valor_unitario ?? line.mtoValorUnitario) || 0) * 1.18),
  );
  const valorVenta = toNumber(
    line.mto_valor_venta ?? line.mtoValorVenta
      ?? (cantidad * toNumber(line.mto_valor_unitario ?? line.mtoValorUnitario)),
  );
  const undRaw = String(line.unidad || 'NIU').trim().toUpperCase() || 'NIU';
  const und = undRaw.length <= 4 ? undRaw : unidadLabel(undRaw).slice(0, 6);
  const partesDesc = [String(line.descripcion || line.nombre || 'Ítem').trim()];
  const serie = numeroSerieLineaPdf(line);
  const codigo = codigoBienPdf(line);
  const codSunat = codigoSunatPdf(line);
  if (codigo) partesDesc.push(`Cód: ${codigo}`);
  if (codSunat) partesDesc.push(`SUNAT: ${codSunat}`);
  if (serie) partesDesc.push(`Serie: ${serie}`);
  return [
    cantidad.toFixed(2),
    und,
    partesDesc.join('\n'),
    formatMoneyDisplay(precio),
    formatMoneyDisplay(valorVenta),
  ];
}

function strokeDoubleRect(doc, x, y, w, h, color = PDF_FE.ink) {
  doc.save();
  doc.lineWidth(1.2).strokeColor(color).rect(x, y, w, h).stroke();
  doc.lineWidth(0.6).rect(x + 2.5, y + 2.5, w - 5, h - 5).stroke();
  doc.restore();
  doc.lineWidth(1).strokeColor(PDF_FE.ink);
}

/**
 * Representación impresa formal (factura / boleta / notas) — estilo comercial peruano.
 */
function dibujarFeFormal(doc, invoice, { logoBuffer = null, qrBuffer = null } = {}) {
  const company = invoice.company || {};
  const cliente = invoice.cliente || {};
  const cli = clientePdfFields(cliente);
  const tipoLabel = TIPO_DOC_LABEL[invoice.tipoDoc] || 'COMPROBANTE ELECTRÓNICO';
  const numero = `${invoice.serie}-${invoice.correlativo}`;
  const pageW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const leftX = doc.page.margins.left;
  const topY = doc.page.margins.top;
  const C = PDF_FE;
  const pageBottom = () => doc.page.height - doc.page.margins.bottom;

  // —— Cabecera: logo + emisor | caja RUC ——
  const boxW = 188;
  const boxH = 68;
  const boxX = leftX + pageW - boxW;
  const midW = Math.max(140, boxX - leftX - 14);
  const logoSize = 52;

  let emisorBottom = topY;
  let hasLogo = false;
  if (logoBuffer) {
    try {
      doc.image(logoBuffer, leftX, topY, {
        fit: [logoSize, logoSize],
        align: 'center',
        valign: 'center',
      });
      emisorBottom = topY + logoSize;
      hasLogo = true;
    } catch (_e) {
      hasLogo = false;
    }
  }

  const textX = hasLogo ? leftX + logoSize + 10 : leftX;
  const textW = hasLogo ? midW - logoSize - 10 : midW;
  const nombreComercial = company.nombreComercial || company.nombre_comercial || company.nombre || 'Emisor';
  const razonSocial = company.nombre && company.nombre !== nombreComercial ? company.nombre : '';

  doc.font('Helvetica-Bold').fontSize(11).fillColor(C.accent)
    .text(nombreComercial, textX, topY + 2, { width: textW, align: 'left' });
  if (razonSocial) {
    doc.font('Helvetica').fontSize(7.5).fillColor(C.ink)
      .text(razonSocial, textX, doc.y, { width: textW });
  }
  const dirEmp = direccionEmpresa(company);
  if (dirEmp) {
    doc.font('Helvetica').fontSize(7.5).fillColor(C.muted)
      .text(dirEmp.replace(/\n/g, ', '), textX, doc.y + 1, { width: textW });
  }
  const contacto = contactoEmpresaPdf(company);
  if (contacto) {
    doc.font('Helvetica').fontSize(7).fillColor(C.accent)
      .text(contacto, textX, doc.y + 1, { width: textW });
  }
  emisorBottom = Math.max(emisorBottom, doc.y);

  strokeDoubleRect(doc, boxX, topY, boxW, boxH, C.accent);
  doc.font('Helvetica-Bold').fontSize(9).fillColor(C.ink)
    .text(`R.U.C.: ${company.ruc || '—'}`, boxX + 8, topY + 10, { width: boxW - 16, align: 'center' });
  doc.font('Helvetica-Bold').fontSize(8).fillColor(C.accent)
    .text(tipoLabel, boxX + 8, topY + 28, { width: boxW - 16, align: 'center' });
  doc.font('Helvetica-Bold').fontSize(11).fillColor(C.ink)
    .text(`N° ${numero}`, boxX + 8, topY + 44, { width: boxW - 16, align: 'center' });

  let y = Math.max(emisorBottom, topY + boxH) + 12;

  // —— Bloque cliente (dos columnas) ——
  const nota = datosNota(invoice);
  const mp = invoice.metodoPago || invoice.metodo_pago;
  const docsRel = documentosRelacionadosLineas(invoice);
  const formaPago = String(invoice.formaPago || invoice.forma_pago || 'CONTADO').toUpperCase();
  const moneda = invoice.tipoMoneda === 'PEN' || !invoice.tipoMoneda
    ? 'SOLES'
    : String(invoice.tipoMoneda);
  const fechaHoraFull = formatFechaHora(invoice.fechaEmision);
  const horaParte = (() => {
    const parts = String(fechaHoraFull).split(',');
    if (parts.length >= 2) return parts.slice(1).join(',').trim();
    const m = String(fechaHoraFull).match(/(\d{1,2}:\d{2}.*)$/);
    return m ? m[1].trim() : '—';
  })();

  const clienteRows = [
    ['SEÑOR(ES)', cli.razon],
    [labelTipoDocCliente(cli.tipoDoc), cli.numeroDoc],
    ['DIRECCIÓN', cli.direccion],
  ];
  if (cli.telefono) clienteRows.push(['TELÉFONO', cli.telefono]);
  if (docsRel.length) clienteRows.push(['DOC. RELACIONADO', docsRel.join(' | ')]);
  if (invoice.observacion && !nota) clienteRows.push(['OBSERVACIÓN', invoice.observacion]);

  const metaRight = [
    ['Fecha emisión', formatFechaCorta(invoice.fechaEmision)],
    ['Hora', horaParte],
    ['Moneda', moneda],
    ['Forma de pago', formaPago],
  ];
  if (mp && (mp.nombre || mp.valor || mp.tipo)) {
    const mpLabel = `${mp.nombre || mp.tipo || ''}${mp.valor ? ` · ${mp.valor}` : ''}`.trim();
    metaRight.push(['Método de pago', mpLabel || '—']);
  }
  if (invoice.fecVencimiento || invoice.fechaVencimiento) {
    metaRight.push(['Vencimiento', invoice.fecVencimiento || invoice.fechaVencimiento]);
  }

  const leftColW = pageW * 0.58;
  const rightColW = pageW - leftColW;
  const labW = 96;
  doc.font('Helvetica').fontSize(7.5);
  let leftH = 12;
  clienteRows.forEach(([, val]) => {
    leftH += Math.max(11, doc.heightOfString(String(val), { width: leftColW - labW - 18 }) + 3);
  });
  const rightH = 12 + metaRight.length * 13;
  const boxCliH = Math.max(64, leftH, rightH) + 4;

  doc.save();
  doc.lineWidth(0.9).strokeColor(C.accent).rect(leftX, y, pageW, boxCliH).stroke();
  doc.moveTo(leftX + leftColW, y).lineTo(leftX + leftColW, y + boxCliH).stroke();
  doc.restore();
  doc.lineWidth(1).strokeColor(C.ink);

  let ly = y + 8;
  clienteRows.forEach(([lab, val]) => {
    doc.font('Helvetica-Bold').fontSize(7).fillColor(C.accent)
      .text(`${lab}:`, leftX + 8, ly, { width: labW, continued: false });
    doc.font('Helvetica').fontSize(7.5).fillColor(C.ink)
      .text(String(val), leftX + 8 + labW, ly, { width: leftColW - labW - 16 });
    ly = Math.max(ly + 11, doc.y + 2);
  });

  let ry = y + 8;
  const rightX = leftX + leftColW + 8;
  metaRight.forEach(([lab, val]) => {
    doc.font('Helvetica-Bold').fontSize(7).fillColor(C.accent)
      .text(`${lab}:`, rightX, ry, { width: 82, continued: false });
    doc.font('Helvetica').fontSize(7.5).fillColor(C.ink)
      .text(String(val), rightX + 82, ry, { width: rightColW - 90 });
    ry += 13;
  });

  y += boxCliH + 10;

  if (nota) {
    const glosaH = nota.glosa
      ? doc.heightOfString(nota.glosa, { width: pageW - 20 }) + 4
      : 0;
    const nh = 38 + glosaH;
    doc.roundedRect(leftX, y, pageW, nh, 4).fillAndStroke('#FFF7ED', '#FDBA74');
    doc.font('Helvetica-Bold').fontSize(7).fillColor('#9A3412')
      .text('Documento que modifica', leftX + 8, y + 6, { width: pageW / 2 - 12 });
    doc.font('Helvetica').fontSize(8).fillColor(C.ink)
      .text(nota.documento, leftX + 8, y + 16, { width: pageW / 2 - 12 });
    doc.font('Helvetica-Bold').fontSize(7).fillColor('#9A3412')
      .text('Motivo de la nota', leftX + pageW / 2, y + 6, { width: pageW / 2 - 12 });
    doc.font('Helvetica').fontSize(8).fillColor(C.ink)
      .text(nota.motivo, leftX + pageW / 2, y + 16, { width: pageW / 2 - 12 });
    if (nota.glosa) {
      doc.font('Helvetica').fontSize(7).fillColor(C.muted)
        .text(nota.glosa, leftX + 8, y + 30, { width: pageW - 16 });
    }
    y += nh + 10;
  }

  // —— Tabla de detalle ——
  const cols = columnasDetalleFe(pageW);
  const headerH = 22;
  const drawTableHeader = (atY) => {
    doc.fillColor(C.accentSoft).rect(leftX, atY, pageW, headerH).fill();
    doc.strokeColor(C.accent).lineWidth(0.8).rect(leftX, atY, pageW, headerH).stroke();
    doc.lineWidth(1);
    let hx = leftX;
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(C.accent);
    cols.forEach((col) => {
      doc.text(col.label, hx + 3, atY + 7, { width: col.w - 6, align: col.align });
      hx += col.w;
    });
  };

  const strokeRowGrid = (atY, rowH) => {
    doc.save();
    doc.strokeColor(C.lineSoft).lineWidth(0.6);
    doc.rect(leftX, atY, pageW, rowH).stroke();
    let lx = leftX;
    cols.forEach((col, i) => {
      lx += col.w;
      if (i < cols.length - 1) {
        doc.moveTo(lx, atY).lineTo(lx, atY + rowH).stroke();
      }
    });
    doc.restore();
    doc.lineWidth(1).strokeColor(C.ink);
  };

  drawTableHeader(y);
  y += headerH;

  const pay = metodoPagoSeleccionadoPdf(invoice);
  const totRows = totalesFeRows(invoice);
  const totalsW = 158;
  const qrSize = 74;
  const sonH = 18;
  const gapSon = 8;
  const payHeaderH = 14;
  const payRowH = 16;
  const payBlockH = pay ? (payHeaderH + payRowH) : 36;
  const totalsH = totRows.length * 15 + 2;
  const centerExtraH = 52;
  const pieContentH = Math.max(qrSize + centerExtraH, payBlockH, totalsH);
  const footerBlockH = sonH + gapSon + pieContentH;
  const footerReserve = footerBlockH + 12;

  const details = invoice.details || [];
  details.forEach((line, idx) => {
    const cells = celdasDetalleFe(line);
    doc.font('Helvetica').fontSize(7.5);
    const descH = doc.heightOfString(cells[2], { width: cols[2].w - 6 });
    const rowH = Math.max(18, descH + 8);

    if (y + rowH > pageBottom() - footerReserve) {
      doc.addPage({ size: 'A4', margin: 28 });
      y = doc.page.margins.top;
      drawTableHeader(y);
      y += headerH;
    }

    if (idx % 2 === 1) {
      doc.fillColor('#F8FAFC').rect(leftX, y, pageW, rowH).fill();
    }
    strokeRowGrid(y, rowH);
    let cx = leftX;
    cells.forEach((cell, i) => {
      const col = cols[i];
      const bold = col.key === 'cant' || col.key === 'vta';
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(7.5).fillColor(C.ink)
        .text(String(cell), cx + 3, y + 4, { width: col.w - 6, align: col.align });
      cx += col.w;
    });
    y += rowH;
  });

  if (!details.length) {
    strokeRowGrid(y, 28);
    doc.font('Helvetica').fontSize(8).fillColor(C.muted)
      .text('Sin ítems', leftX, y + 10, { width: pageW, align: 'center' });
    y += 28;
  }

  // Extender cuerpo vacío hasta el pie (pocos ítems)
  const emptyRowH = 16;
  let footerTop = pageBottom() - footerBlockH;
  if (y + footerBlockH > pageBottom()) {
    doc.addPage({ size: 'A4', margin: 28 });
    y = doc.page.margins.top;
    footerTop = pageBottom() - footerBlockH;
  } else if (y < footerTop) {
    while (y + emptyRowH <= footerTop) {
      strokeRowGrid(y, emptyRowH);
      y += emptyRowH;
    }
    if (y < footerTop) {
      const rem = footerTop - y;
      if (rem >= 8) strokeRowGrid(y, rem);
      y = footerTop;
    }
  }

  y = Math.max(y, footerTop);

  // —— SON ——
  const sonTxt = montoEnLetras(invoice.mtoImpVenta);
  doc.roundedRect(leftX, y, pageW, sonH, 3).fillAndStroke(C.accentSoft, C.accentMid);
  doc.font('Helvetica-Bold').fontSize(8).fillColor(C.ink)
    .text(sonTxt, leftX + 8, y + 5, { width: pageW - 16 });
  y += sonH + gapSon;

  const footerY = y;
  const totalsX = leftX + pageW - totalsW;
  const centerW = Math.max(120, pageW - totalsW - 130);
  const payAreaW = Math.max(110, pageW - totalsW - centerW - 12);
  const qrX = leftX + payAreaW + Math.max(0, (centerW - qrSize) / 2);

  // Método de pago elegido: tablita Nombre | Valor
  if (pay) {
    const tableW = Math.min(payAreaW, 200);
    const colNom = Math.floor(tableW * 0.45);
    const colVal = tableW - colNom;
    doc.fillColor(C.accentSoft).rect(leftX, footerY, tableW, payHeaderH).fill();
    doc.strokeColor(C.accent).lineWidth(0.7)
      .rect(leftX, footerY, tableW, payHeaderH + payRowH).stroke();
    doc.moveTo(leftX + colNom, footerY).lineTo(leftX + colNom, footerY + payHeaderH + payRowH).stroke();
    doc.moveTo(leftX, footerY + payHeaderH).lineTo(leftX + tableW, footerY + payHeaderH).stroke();
    doc.lineWidth(1);
    doc.font('Helvetica-Bold').fontSize(6.5).fillColor(C.accent)
      .text('Método', leftX + 4, footerY + 4, { width: colNom - 8, lineBreak: false });
    doc.text('Valor', leftX + colNom + 4, footerY + 4, { width: colVal - 8, lineBreak: false });
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(C.ink)
      .text(String(pay.nombre), leftX + 4, footerY + payHeaderH + 4, {
        width: colNom - 8,
        height: 11,
        ellipsis: true,
        lineBreak: false,
      });
    doc.font('Helvetica').fontSize(7.5).fillColor(C.ink)
      .text(pay.valor || '—', leftX + colNom + 4, footerY + payHeaderH + 4, {
        width: colVal - 8,
        height: 11,
        ellipsis: true,
        lineBreak: false,
      });
  } else {
    doc.roundedRect(leftX, footerY, Math.min(payAreaW, 170), 36, 3)
      .fillAndStroke('#F8FAFC', C.line);
    doc.font('Helvetica-Bold').fontSize(6).fillColor(C.accent)
      .text('Forma de pago', leftX + 5, footerY + 8, { width: 160, lineBreak: false });
    doc.font('Helvetica-Bold').fontSize(8).fillColor(C.ink)
      .text(formaPago, leftX + 5, footerY + 22, { width: 160, lineBreak: false });
  }

  // QR + Hash CPE + SUNAT_PIE (centro)
  if (qrBuffer) {
    try {
      doc.image(qrBuffer, qrX, footerY, { width: qrSize, height: qrSize });
    } catch (_e) {
      doc.roundedRect(qrX, footerY, qrSize, qrSize, 3).stroke(C.lineSoft);
    }
  } else {
    doc.roundedRect(qrX, footerY, qrSize, qrSize, 3).stroke(C.lineSoft);
  }

  const hashTxt = String(
    invoice.hash || invoice.hashCpe || invoice.hash_cpe || invoice.hashCpeDirecto || '',
  ).trim();
  const centerX = leftX + payAreaW;
  let iy = footerY + qrSize + 3;
  if (hashTxt) {
    doc.font('Helvetica').fontSize(5).fillColor(C.muted)
      .text(`Hash CPE: ${hashTxt}`, centerX, iy, { width: centerW, align: 'center' });
    iy = doc.y + 2;
  }
  doc.font('Helvetica').fontSize(5).fillColor(C.muted)
    .text(SUNAT_PIE, centerX, iy, { width: centerW, align: 'center' });

  // Totales (derecha)
  let ty = footerY;
  const rowTotH = 14;
  totRows.forEach(([lab, val], idx) => {
    const isLast = idx === totRows.length - 1 || lab === 'TOTAL';
    const h = isLast ? rowTotH + 2 : rowTotH;
    if (isLast) {
      doc.roundedRect(totalsX, ty, totalsW, h, 3).fillAndStroke(C.accent, C.accent);
      doc.fillColor(C.white);
    } else {
      doc.rect(totalsX, ty, totalsW, h).fillAndStroke(C.accentSoft, C.accentMid);
      doc.fillColor(C.ink);
    }
    doc.font('Helvetica-Bold').fontSize(isLast ? 9 : 7)
      .text(lab, totalsX + 5, ty + 3, { width: 78 });
    doc.text(isLast ? `S/ ${val}` : val, totalsX + 78, ty + 3, {
      width: totalsW - 84,
      align: 'right',
    });
    ty += h + (isLast ? 0 : 1);
  });

  doc.fillColor(C.ink);
  doc.y = Math.max(footerY + pieContentH, ty) + 4;
}

function ticketDashedLine(doc, margin, ticketW, y) {
  doc.save();
  doc.strokeColor('#cbd5e1');
  doc.dash(2, { space: 2 });
  doc.moveTo(margin, y).lineTo(ticketW - margin, y).stroke();
  doc.undash();
  doc.restore();
  return y + 10;
}

function ticketTextHeight(doc, text, width, fontSize, bold = false) {
  doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(fontSize);
  return doc.heightOfString(String(text || '—'), { width, lineGap: 1 });
}

function measureTicketPageHeight(doc, invoice, margin, contentW, hasLogo = false) {
  let y = margin + 6;
  const company = invoice.company || {};
  const cli = clientePdfFields(invoice.cliente || {});

  if (hasLogo) y += 32;
  y += ticketTextHeight(doc, company.nombreComercial || company.nombre || 'Emisor', contentW, 10, true) + 2;
  if (company.ruc) y += ticketTextHeight(doc, `RUC ${company.ruc}`, contentW, 7.5) + 2;
  const dir = direccionEmpresa(company);
  if (dir) y += ticketTextHeight(doc, dir, contentW, 7) + 2;
  y += 10;

  const tipoLabel = TIPO_DOC_LABEL[invoice.tipoDoc] || 'COMPROBANTE';
  y += ticketTextHeight(doc, tipoLabel, contentW, 8, true) + 2;
  y += ticketTextHeight(doc, `${invoice.serie}-${invoice.correlativo}`, contentW, 10.5, true) + 2;
  y += ticketTextHeight(doc, `Fecha: ${formatFechaHora(invoice.fechaEmision)}`, contentW, 7) + 2;
  y += 10;

  y += ticketTextHeight(doc, 'CLIENTE', contentW, 7, true) + 8;
  y += ticketTextHeight(doc, cli.razon, contentW, 8.5, true) + 2;
  if (cli.numeroDoc && cli.numeroDoc !== '—') {
    y += ticketTextHeight(
      doc,
      `${labelTipoDocCliente(cli.tipoDoc)}: ${cli.numeroDoc}`,
      contentW,
      7.5,
    ) + 2;
  }
  if (cli.direccion && cli.direccion !== '—') {
    y += ticketTextHeight(doc, `Dirección: ${cli.direccion}`, contentW, 7) + 2;
  }
  const notaTicketH = datosNota(invoice);
  if (notaTicketH) {
    y += 10;
    y += ticketTextHeight(doc, 'DOCUMENTO QUE MODIFICA', contentW, 7, true) + 8;
    y += ticketTextHeight(doc, notaTicketH.documento, contentW, 8, true) + 2;
    y += ticketTextHeight(doc, `Motivo: ${notaTicketH.motivo}`, contentW, 7.5) + 2;
    if (notaTicketH.glosa) y += ticketTextHeight(doc, notaTicketH.glosa, contentW, 7) + 2;
  }
  const docsRelH = documentosRelacionadosLineas(invoice);
  if (docsRelH.length) {
    y += 10;
    y += ticketTextHeight(doc, 'DOC. RELACIONADO', contentW, 7, true) + 8;
    docsRelH.forEach((line) => {
      y += ticketTextHeight(doc, line, contentW, 7.5) + 2;
    });
  }
  const mpH = metodoPagoSeleccionadoPdf(invoice);
  if (mpH) {
    y += 10;
    y += ticketTextHeight(doc, 'MÉTODO DE PAGO', contentW, 7, true) + 8;
    y += ticketTextHeight(doc, `Método: ${mpH.nombre}`, contentW, 7.5) + 2;
    y += ticketTextHeight(doc, `Valor: ${mpH.valor || '—'}`, contentW, 7.5) + 2;
  }
  const monedaH = invoice.tipoMoneda === 'PEN' || !invoice.tipoMoneda
    ? 'SOLES'
    : String(invoice.tipoMoneda);
  const formaPagoH = String(invoice.formaPago || invoice.forma_pago || 'CONTADO').toUpperCase();
  y += ticketTextHeight(doc, `Moneda: ${monedaH}`, contentW, 7) + 2;
  y += ticketTextHeight(doc, `Forma de pago: ${formaPagoH}`, contentW, 7) + 2;
  y += 10;

  y += ticketTextHeight(doc, 'DETALLE', contentW, 7, true) + 8;
  (invoice.details || []).forEach((lineItem) => {
    const desc = lineItem.descripcion || lineItem.nombre || 'Ítem';
    y += ticketTextHeight(doc, desc, contentW, 8.5, true) + 2;
    y += 11;
  });
  y += 10;

  y += 6 + 10 + 10 + 20;
  y += ticketTextHeight(doc, montoEnLetras(invoice.mtoImpVenta), contentW, 7) + 6;
  const hashH = String(
    invoice.hash || invoice.hashCpe || invoice.hash_cpe || invoice.hashCpeDirecto || '',
  ).trim();
  if (hashH) y += ticketTextHeight(doc, `Hash: ${hashH}`, contentW, 5.5) + 4;
  y += 10;
  y += ticketTextHeight(doc, SUNAT_PIE, contentW, 5.5) + 6;
  y += 80; // QR + margen
  y += 14;

  return Math.min(2400, Math.max(420, Math.ceil(y + margin)));
}

async function generarPdfTicket(invoice) {
  const qrBuffer = await generarQrPngBuffer(invoice, 160);
  const logoBuffer = await loadCompanyLogoBuffer(invoice.company);
  const mpSeleccionado = metodoPagoSeleccionadoPdf(invoice);

  return createPdfBuffer((doc) => {
    const ticketW = 226;
    const margin = 10;
    const contentW = ticketW - margin * 2;

    if (esGre(invoice)) {
      const pageH = measureGreTicketHeight(doc, invoice, margin, contentW, Boolean(logoBuffer));
      doc.addPage({ size: [ticketW, pageH], margin });
      const ctx = { y: margin + 4, margin, contentW };
      dibujarGreTicket(doc, invoice, qrBuffer, ctx, { logoBuffer });
      return;
    }

    const pageH = measureTicketPageHeight(doc, invoice, margin, contentW, Boolean(logoBuffer));
    doc.addPage({ size: [ticketW, pageH], margin });

    const company = invoice.company || {};
    const cli = clientePdfFields(invoice.cliente || {});
    const tipoLabel = TIPO_DOC_LABEL[invoice.tipoDoc] || 'COMPROBANTE';
    const numero = `${invoice.serie}-${invoice.correlativo}`;
    let y = margin + 4;

    const textCenter = (text, size, bold = false, gap = 2) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size);
      const h = doc.heightOfString(String(text || '—'), { width: contentW, align: 'center', lineGap: 1 });
      doc.fillColor(bold && size >= 10 ? '#1e40af' : '#111827');
      doc.text(String(text || '—'), margin, y, { width: contentW, align: 'center', lineGap: 1 });
      doc.fillColor('#111827');
      y += h + gap;
    };

    const textLeft = (text, size, bold = false, gap = 2) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size);
      const h = doc.heightOfString(String(text || '—'), { width: contentW, lineGap: 1 });
      doc.text(String(text || '—'), margin, y, { width: contentW, lineGap: 1 });
      y += h + gap;
    };

    const textRow = (left, right, size = 8) => {
      doc.font('Helvetica').fontSize(size).fillColor('#64748b');
      doc.text(left, margin, y, { width: contentW / 2, align: 'left' });
      doc.fillColor('#111827');
      doc.text(right, margin, y, { width: contentW, align: 'right' });
      y += 10;
    };

    const sep = () => {
      y = ticketDashedLine(doc, margin, ticketW, y);
    };

    if (logoBuffer) {
      y = dibujarEmisorConLogo(doc, {
        company,
        logoBuffer,
        x: margin,
        y,
        width: contentW,
        logoSize: 28,
        nombreSize: 10,
        razonSize: 7,
        align: 'center',
        fillNombre: '#1e40af',
        fillRazon: '#334155',
      }) + 2;
    } else {
      textCenter(company.nombreComercial || company.nombre || 'Emisor', 10, true);
    }
    if (company.ruc) textCenter(`RUC ${company.ruc}`, 7.5);
    const dir = direccionEmpresa(company);
    if (dir) textCenter(dir, 7);
    sep();

    doc.fillColor('#1e3a5f');
    textCenter(tipoLabel, 8, true);
    textCenter(numero, 10.5, true);
    doc.fillColor('#64748b');
    textCenter(`Fecha: ${formatFechaHora(invoice.fechaEmision)}`, 7);
    doc.fillColor('#111827');
    sep();

    doc.fillColor('#64748b').font('Helvetica-Bold').fontSize(7).text('CLIENTE', margin, y);
    doc.fillColor('#111827');
    y += 9;
    textLeft(cli.razon, 8.5, true);
    if (cli.numeroDoc && cli.numeroDoc !== '—') {
      textLeft(`${labelTipoDocCliente(cli.tipoDoc)}: ${cli.numeroDoc}`, 7.5);
    }
    if (cli.direccion && cli.direccion !== '—') {
      textLeft(`Dirección: ${cli.direccion}`, 7);
    }
    const notaTicket = datosNota(invoice);
    if (notaTicket) {
      sep();
      doc.fillColor('#64748b').font('Helvetica-Bold').fontSize(7).text('DOCUMENTO QUE MODIFICA', margin, y);
      doc.fillColor('#111827');
      y += 9;
      textLeft(notaTicket.documento, 8, true);
      textLeft(`Motivo: ${notaTicket.motivo}`, 7.5);
      if (notaTicket.glosa) textLeft(notaTicket.glosa, 7);
    }
    const docsRelTicket = documentosRelacionadosLineas(invoice);
    if (docsRelTicket.length) {
      sep();
      doc.fillColor('#64748b').font('Helvetica-Bold').fontSize(7).text('DOC. RELACIONADO', margin, y);
      doc.fillColor('#111827');
      y += 9;
      docsRelTicket.forEach((line) => textLeft(line, 7.5));
    }
    const mpTicket = mpSeleccionado;
    if (mpTicket) {
      sep();
      doc.fillColor('#64748b').font('Helvetica-Bold').fontSize(7).text('MÉTODO DE PAGO', margin, y);
      doc.fillColor('#111827');
      y += 9;
      textLeft(`Método: ${mpTicket.nombre}`, 7.5);
      textLeft(`Valor: ${mpTicket.valor || '—'}`, 7.5);
    }
    const monedaTicket = invoice.tipoMoneda === 'PEN' || !invoice.tipoMoneda
      ? 'SOLES'
      : String(invoice.tipoMoneda);
    const formaPagoTicket = String(invoice.formaPago || invoice.forma_pago || 'CONTADO').toUpperCase();
    textLeft(`Moneda: ${monedaTicket}`, 7);
    textLeft(`Forma de pago: ${formaPagoTicket}`, 7);
    sep();

    doc.fillColor('#64748b').font('Helvetica-Bold').fontSize(7).text('DETALLE', margin, y);
    doc.fillColor('#111827');
    y += 9;

    (invoice.details || []).forEach((lineItem) => {
      const desc = lineItem.descripcion || lineItem.nombre || 'Ítem';
      textLeft(desc, 8.5, true);
      const cantidad = toNumber(lineItem.cantidad, 1);
      const qty = Number.isInteger(cantidad) ? String(cantidad) : cantidad.toFixed(2);
      const und = unidadLabel(lineItem.unidad);
      const total = toNumber(lineItem.totalFactura)
        || toNumber(lineItem.mtoValorVenta) + toNumber(lineItem.mtoIgv);
      // Cantidad + unidad en azul para que resalten en el ticket.
      const leftQty = `${qty} ${und}`;
      const right = `${formatMoney(lineItem.mtoPrecioUnitario)}  ${formatMoney(total)}`;
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#1565C0').text(leftQty, margin, y, {
        width: contentW * 0.42,
        continued: false,
      });
      doc.font('Helvetica').fontSize(7.5).fillColor('#111827')
        .text(right, margin, y, { width: contentW, align: 'right' });
      y += 12;
      doc.fillColor('#111827');
    });

    sep();
    y += 4;
    textRow('Op. gravada', formatMoney(invoice.mtoOperGravadas));
    textRow('IGV (18%)', formatMoney(invoice.mtoIgv));
    y += 2;

    const boxY = y;
    doc.roundedRect(margin, boxY, contentW, 18, 4).fillAndStroke('#f1f5f9', '#cbd5e1');
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#1e3a5f').text('TOTAL', margin + 6, boxY + 5);
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#1e40af')
      .text(formatMoney(invoice.mtoImpVenta), margin, boxY + 4, { width: contentW - 6, align: 'right' });
    doc.fillColor('#111827');
    y = boxY + 22;

    doc.font('Helvetica').fontSize(7).fillColor('#64748b');
    const letrasH = doc.heightOfString(montoEnLetras(invoice.mtoImpVenta), { width: contentW, align: 'center', lineGap: 1 });
    doc.text(montoEnLetras(invoice.mtoImpVenta), margin, y, { width: contentW, align: 'center', lineGap: 1 });
    doc.fillColor('#111827');
    y += letrasH + 6;

    const hashTicket = String(
      invoice.hash || invoice.hashCpe || invoice.hash_cpe || invoice.hashCpeDirecto || '',
    ).trim();
    if (hashTicket) {
      doc.font('Helvetica').fontSize(5.5).fillColor('#94a3b8')
        .text(`Hash: ${hashTicket}`, margin, y, { width: contentW, align: 'center' });
      doc.fillColor('#111827');
      y = doc.y + 4;
    }
    sep();

    const pieH = doc.heightOfString(SUNAT_PIE, { width: contentW, align: 'center', lineGap: 1 });
    doc.font('Helvetica').fontSize(5.5).fillColor('#94a3b8')
      .text(SUNAT_PIE, margin, y, { width: contentW, align: 'center', lineGap: 1 });
    doc.fillColor('#111827');
    y += pieH + 6;

    doc.font('Helvetica-Bold').fontSize(9).fillColor('#1e40af')
      .text('¡Gracias por su compra!', margin, y, { width: contentW, align: 'center' });
    y += 14;
    sep();

    // QR siempre al final del ticket
    if (qrBuffer) {
      const qrSize = 72;
      const qrX = margin + (contentW - qrSize) / 2;
      try {
        doc.image(qrBuffer, qrX, y, { width: qrSize, height: qrSize });
        y += qrSize + 4;
        doc.font('Helvetica').fontSize(5.5).fillColor('#94a3b8')
          .text('Código QR SUNAT', margin, y, { width: contentW, align: 'center' });
        doc.fillColor('#111827');
        y += 10;
      } catch (_e) {
        /* ignore */
      }
    }
  });
}

async function generarPdfBuffer(invoice, formato = 'a4') {
  const fmt = String(formato || 'a4').trim().toLowerCase();
  if (fmt === 'ticket' || fmt === 'thermal') {
    return generarPdfTicket(invoice);
  }
  return generarPdfFormal(invoice);
}

module.exports = {
  generarPdfBuffer,
  generarPdfFormal,
  generarPdfTicket,
};

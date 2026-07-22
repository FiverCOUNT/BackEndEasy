const PDFDocument = require('pdfkit');

const TIPO_DOC_LABEL = {
  '01': 'FACTURA ELECTRÓNICA',
  '03': 'BOLETA DE VENTA ELECTRÓNICA',
  '07': 'NOTA DE CRÉDITO ELECTRÓNICA',
  '08': 'NOTA DE DÉBITO ELECTRÓNICA',
  '09': 'GUÍA DE REMISIÓN ELECTRÓNICA',
  '31': 'GUÍA DE REMISIÓN ELECTRÓNICA TRANSPORTISTA',
};

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
  const ms = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(ms)) return '—';
  return new Date(ms).toLocaleDateString('es-PE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function formatFechaHora(value) {
  const ms = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(ms)) return '—';
  return new Date(ms).toLocaleString('es-PE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function unidadLabel(unidad) {
  return UNIDAD_LABEL[String(unidad || 'NIU').toUpperCase()] || String(unidad || 'NIU').toUpperCase();
}

function unidadMedidaCompleta(unidad) {
  const cod = String(unidad || 'NIU').trim().toUpperCase() || 'NIU';
  return `${unidadLabel(cod)} (${cod})`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function codigoBienPdf(line) {
  const codigo = String(line.codigo || '').trim();
  if (codigo) return codigo;
  const raw = String(line.catalog_item_id || line.catalogItemId || '').trim();
  if (!raw || UUID_RE.test(raw)) return '';
  return raw;
}

function codigoSunatPdf(line) {
  return String(line.codigo_sunat || line.codigoSunat || '').trim();
}

function columnasDetalleSunat(pageW, incluirPrecios = true) {
  const fijos = [
    { label: 'N°', w: 18, align: 'left' },
    { label: 'Bien normalizado', w: 34, align: 'left' },
    { label: 'Código de Bien', w: 52, align: 'left' },
    { label: 'Código producto SUNAT', w: 50, align: 'left' },
    { label: 'Partida arancelaria', w: 38, align: 'left' },
    { label: 'Código GTIN', w: 36, align: 'left' },
  ];
  const fin = [
    { label: 'Unidad de medida', w: 58, align: 'left' },
    { label: 'Cantidad', w: 40, align: 'right' },
  ];
  const venta = incluirPrecios
    ? [
      { label: 'P. Unit.(*)', w: 42, align: 'right' },
      { label: 'Importe(**)', w: 44, align: 'right' },
    ]
    : [];
  const usado = [...fijos, ...fin, ...venta].reduce((s, c) => s + c.w, 0);
  const descW = Math.max(72, pageW - usado);
  return [
    ...fijos,
    { label: 'Descripción Detallada', w: descW, align: 'left' },
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
  const addr = company?.address;
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

function createPdfBuffer(buildFn) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ autoFirstPage: false });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    buildFn(doc);
    doc.end();
  });
}

function generarPdfFormal(invoice) {
  return createPdfBuffer((doc) => {
    doc.addPage({ size: 'A4', margin: 36 });
    const company = invoice.company || {};
    const cliente = invoice.cliente || {};
    const addr = company.address || {};
    const tipoLabel = TIPO_DOC_LABEL[invoice.tipoDoc] || 'COMPROBANTE ELECTRÓNICO';
    const numero = `${invoice.serie}-${invoice.correlativo}`;
    const pageW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const leftX = doc.page.margins.left;
    const topY = doc.page.margins.top;

    // — Cabecera emisor (izquierda) + caja comprobante (derecha) —
    const boxW = 200;
    const boxX = leftX + pageW - boxW;

    doc.font('Helvetica-Bold').fontSize(11).text(company.nombreComercial || company.nombre || 'Emisor', leftX, topY, {
      width: pageW - boxW - 12,
    });
    doc.font('Helvetica').fontSize(8);
    if (company.nombre && company.nombre !== company.nombreComercial) {
      doc.text(company.nombre, leftX, doc.y, { width: pageW - boxW - 12 });
    }
    const dir = direccionEmpresa(company);
    if (dir) doc.text(dir, leftX, doc.y, { width: pageW - boxW - 12 });

    const boxY = topY;
    doc.rect(boxX, boxY, boxW, 58).stroke();
    doc.font('Helvetica-Bold').fontSize(9).text(tipoLabel, boxX + 6, boxY + 6, { width: boxW - 12, align: 'center' });
    doc.font('Helvetica').fontSize(8);
    doc.text(`RUC ${company.ruc || '—'}`, boxX + 6, doc.y + 2, { width: boxW - 12, align: 'center' });
    doc.font('Helvetica-Bold').fontSize(10).text(numero, boxX + 6, doc.y + 2, { width: boxW - 12, align: 'center' });

    doc.y = Math.max(doc.y, boxY + 68);
    doc.moveDown(0.4);
    doc.moveTo(leftX, doc.y).lineTo(leftX + pageW, doc.y).stroke();
    doc.moveDown(0.5);

    // — Datos cliente —
    const colW = pageW / 2;
    const rowH = 14;
    const fields = [
      ['Fecha de Vencimiento:', invoice.fecVencimiento || ''],
      ['Fecha de Emisión:', formatFechaEmision(invoice.fechaEmision)],
      ['Señor(es):', cliente.razonSocial || '—'],
      [`${labelTipoDocCliente(cliente.tipoDoc)}:`, cliente.numeroDoc || '—'],
      ['Tipo de Moneda:', invoice.tipoMoneda === 'PEN' ? 'SOLES' : (invoice.tipoMoneda || 'PEN')],
      ['Observación:', invoice.observacion || ''],
    ];

    doc.font('Helvetica').fontSize(8);
    fields.forEach(([label, value], i) => {
      const y = doc.y;
      const xCol = i % 2 === 0 ? leftX : leftX + colW;
      if (i > 0 && i % 2 === 0) doc.y = y + rowH;
      doc.font('Helvetica-Bold').text(label, xCol, doc.y, { continued: true, width: colW - 8 });
      doc.font('Helvetica').text(` ${value}`, { width: colW - 8 });
      if (i % 2 === 1) doc.moveDown(0.15);
    });
    doc.moveDown(0.6);

    // — Tabla detalle (formato SUNAT con códigos de producto) —
    const cols = columnasDetalleSunat(pageW, true);

    let tableX = leftX;
    const headerY = doc.y;
    const headerH = 22;
    doc.fillColor('#ebebeb').rect(leftX, headerY, pageW, headerH).fill();
    doc.fillColor('#000000');
    doc.rect(leftX, headerY, pageW, headerH).stroke();
    doc.font('Helvetica-Bold').fontSize(6.5);
    cols.forEach((col) => {
      doc.text(col.label, tableX + 2, headerY + 4, { width: col.w - 4, align: col.align, lineGap: 0 });
      tableX += col.w;
    });

    let rowY = headerY + headerH;
    const details = invoice.details || [];
    doc.font('Helvetica').fontSize(6.5);

    details.forEach((line, idx) => {
      const desc = line.descripcion || line.nombre || 'Ítem';
      const descCol = cols.find((c) => c.label.startsWith('Descripción'));
      const rowHLine = Math.max(16, Math.ceil(doc.heightOfString(desc, { width: (descCol?.w || 80) - 4 }) + 8));

      if (rowY + rowHLine > doc.page.height - 160) {
        doc.addPage({ size: 'A4', margin: 36 });
        rowY = doc.page.margins.top;
      }

      doc.rect(leftX, rowY, pageW, rowHLine).stroke();
      tableX = leftX;
      const cells = celdasDetalleSunat(line, idx, true);
      cells.forEach((cell, cellIdx) => {
        doc.text(String(cell), tableX + 2, rowY + 4, { width: cols[cellIdx].w - 4, align: cols[cellIdx].align });
        tableX += cols[cellIdx].w;
      });
      rowY += rowHLine;
    });

    doc.y = rowY + 10;

    // — Totales + letras —
    const totalsW = 180;
    const totalsX = leftX + pageW - totalsW;
    const totals = [
      ['Op. Gravada:', formatMoneyPlain(invoice.mtoOperGravadas)],
      ['Op. Exonerada:', formatMoneyPlain(invoice.mtoOperExoneradas)],
      ['Op. Inafecta:', formatMoneyPlain(invoice.mtoOperInafectas)],
      ['ISC:', '0.00'],
      ['IGV:', formatMoneyPlain(invoice.mtoIgv)],
      ['Otros Cargos:', '0.00'],
      ['Otros Tributos:', '0.00'],
      ['Monto de Redondeo:', '0.00'],
      ['Importe Total:', formatMoneyPlain(invoice.mtoImpVenta)],
    ];

    const letrasY = doc.y;
    doc.font('Helvetica').fontSize(7).text('(*) Sin impuestos.', leftX, letrasY);
    doc.text('(**) Incluye impuestos, de ser Op. Gravada.', leftX, doc.y);
    doc.moveDown(0.4);
    doc.font('Helvetica-Bold').fontSize(8).text(montoEnLetras(invoice.mtoImpVenta), leftX, doc.y, {
      width: pageW - totalsW - 10,
    });

    let ty = letrasY;
    totals.forEach(([label, value], idx) => {
      const isTotal = idx === totals.length - 1;
      doc.font(isTotal ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
      doc.text(label, totalsX, ty, { width: 90, align: 'right', continued: false });
      doc.text(`S/ ${value}`, totalsX + 92, ty, { width: totalsW - 94, align: 'right' });
      ty += 14;
    });

    doc.y = Math.max(doc.y, ty + 10);
    doc.moveDown(0.5);
    doc.font('Helvetica').fontSize(6.5).text(SUNAT_PIE, leftX, doc.y, { width: pageW, align: 'justify' });

    if (invoice.hashCpeDirecto) {
      doc.moveDown(0.3);
      doc.fontSize(6).text(`Hash: ${invoice.hashCpeDirecto}`, leftX, doc.y, { width: pageW });
    }
  });
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

function measureTicketPageHeight(doc, invoice, margin, contentW) {
  let y = margin + 6;
  const company = invoice.company || {};
  const cliente = invoice.cliente || {};

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
  y += ticketTextHeight(doc, cliente.razonSocial || '—', contentW, 8.5, true) + 2;
  if (cliente.numeroDoc) {
    y += ticketTextHeight(
      doc,
      `${labelTipoDocCliente(cliente.tipoDoc)}: ${cliente.numeroDoc}`,
      contentW,
      7.5,
    ) + 2;
  }
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
  y += 10;
  y += ticketTextHeight(doc, SUNAT_PIE, contentW, 5.5) + 6;
  y += 14;

  return Math.min(2400, Math.max(420, Math.ceil(y + margin)));
}

function generarPdfTicket(invoice) {
  return createPdfBuffer((doc) => {
    const ticketW = 226;
    const margin = 10;
    const contentW = ticketW - margin * 2;
    const pageH = measureTicketPageHeight(doc, invoice, margin, contentW);
    doc.addPage({ size: [ticketW, pageH], margin });

    const company = invoice.company || {};
    const cliente = invoice.cliente || {};
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

    textCenter(company.nombreComercial || company.nombre || 'Emisor', 10, true);
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
    textLeft(cliente.razonSocial || '—', 8.5, true);
    if (cliente.numeroDoc) {
      textLeft(`${labelTipoDocCliente(cliente.tipoDoc)}: ${cliente.numeroDoc}`, 7.5);
    }
    sep();

    doc.fillColor('#64748b').font('Helvetica-Bold').fontSize(7).text('DETALLE', margin, y);
    doc.fillColor('#111827');
    y += 9;

    (invoice.details || []).forEach((lineItem) => {
      const desc = lineItem.descripcion || lineItem.nombre || 'Ítem';
      textLeft(desc, 8.5, true);
      const cantidad = toNumber(lineItem.cantidad, 1);
      const qty = Number.isInteger(cantidad) ? String(cantidad) : cantidad.toFixed(2);
      const total = toNumber(lineItem.totalFactura)
        || toNumber(lineItem.mtoValorVenta) + toNumber(lineItem.mtoIgv);
      textRow(`${qty} x ${formatMoney(lineItem.mtoPrecioUnitario)}`, formatMoney(total), 7.5);
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
    sep();

    const pieH = doc.heightOfString(SUNAT_PIE, { width: contentW, align: 'center', lineGap: 1 });
    doc.font('Helvetica').fontSize(5.5).fillColor('#94a3b8')
      .text(SUNAT_PIE, margin, y, { width: contentW, align: 'center', lineGap: 1 });
    doc.fillColor('#111827');
    y += pieH + 6;

    doc.font('Helvetica-Bold').fontSize(9).fillColor('#1e40af')
      .text('¡Gracias por su compra!', margin, y, { width: contentW, align: 'center' });
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

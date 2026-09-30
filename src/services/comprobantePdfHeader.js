/**
 * Cabecera de emisor con logo opcional (PDF A4 / GRE / ticket).
 */

/**
 * Dibuja logo pequeño a la izquierda + nombre comercial / razón social.
 * @returns {number} Y inferior del bloque (para continuar el layout).
 */
function dibujarEmisorConLogo(doc, {
  company = {},
  logoBuffer = null,
  x,
  y,
  width,
  logoSize = 38,
  gap = 8,
  nombreSize = 11,
  razonSize = 7.5,
  dirSize = 8,
  showDireccion = false,
  direccion = '',
  align = 'left',
  fillNombre = '#0B1F33',
  fillRazon = '#334155',
} = {}) {
  const nombre = company.nombreComercial || company.nombre_comercial || company.nombre || 'Emisor';
  const razon = company.nombre && company.nombre !== (company.nombreComercial || company.nombre_comercial)
    ? company.nombre
    : '';

  let textX = x;
  let textW = width;
  let logoBottom = y;

  if (logoBuffer && align === 'left') {
    try {
      doc.image(logoBuffer, x, y, {
        fit: [logoSize, logoSize],
        align: 'center',
        valign: 'center',
      });
      textX = x + logoSize + gap;
      textW = Math.max(40, width - logoSize - gap);
      logoBottom = y + logoSize;
    } catch (_e) {
      /* logo inválido: solo texto */
    }
  } else if (logoBuffer && align === 'center') {
    try {
      const logoX = x + Math.max(0, (width - logoSize) / 2);
      doc.image(logoBuffer, logoX, y, {
        fit: [logoSize, logoSize],
        align: 'center',
        valign: 'center',
      });
      logoBottom = y + logoSize + 4;
      y = logoBottom;
      textX = x;
      textW = width;
    } catch (_e) {
      /* ignore */
    }
  }

  const textStartY = align === 'center' ? y : y + (logoBuffer ? 1 : 0);
  doc.font('Helvetica-Bold').fontSize(nombreSize).fillColor(fillNombre)
    .text(nombre, textX, textStartY, { width: textW, align });

  if (razon) {
    doc.font('Helvetica').fontSize(razonSize).fillColor(fillRazon)
      .text(razon, textX, doc.y, { width: textW, align });
  }

  if (showDireccion && direccion) {
    doc.font('Helvetica').fontSize(dirSize).fillColor(fillRazon)
      .text(direccion, textX, doc.y, { width: textW, align });
  }

  doc.fillColor('#000000');
  return Math.max(logoBottom, doc.y);
}

module.exports = { dibujarEmisorConLogo };

const fs = require('fs');
const path = require('path');
const prisma = require('../config/prisma');

const ARCHIVO = path.join(__dirname, '../../data/detracciones.json');

function asList(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function normalizar(row) {
  return {
    codigo: String(row.codigo || ''),
    nombre: String(row.nombre || ''),
    orden: Number(row.orden) || 0,
    codigos: asList(row.codigos).map((item) => ({
      codigo: String(item.codigo || ''),
      nombre: String(item.nombre || ''),
      porcentaje: Number(item.porcentaje),
    })),
    campos: asList(row.campos).map((item) => ({
      key: String(item.key || ''),
      label: String(item.label || ''),
      tipo: String(item.tipo || 'text'),
    })),
  };
}

function desdeArchivo() {
  const raw = JSON.parse(fs.readFileSync(ARCHIVO, 'utf8'));
  return raw.map(normalizar);
}

async function listar() {
  try {
    const rows = await prisma.$queryRawUnsafe(
      'SELECT codigo, nombre, codigos, campos, orden FROM detracciones ORDER BY orden ASC, codigo ASC',
    );
    if (Array.isArray(rows) && rows.length) return rows.map(normalizar);
  } catch (err) {
    console.error('[detracciones] listar', err.message);
  }
  return desdeArchivo();
}

/**
 * Ajusta tipo, código y porcentaje con la fila de la tabla.
 * Devuelve un mensaje de error o null.
 */
function aplicarCatalogo(filas, datos) {
  if (!datos || datos.flags?.detraccion !== 'si') {
    if (datos) {
      datos.tipo_operacion = '0101';
      datos.detraccion_tipo = '';
      datos.detraccion_extra = {};
    }
    return null;
  }
  const tipo = String(datos.detraccion_tipo || '').trim();
  const fila = (filas || []).find((row) => row.codigo === tipo);
  if (!fila) return 'Detracción: elige el tipo de operación.';
  const codigo = String(datos.detraccion_codigo || '').trim();
  const bien = fila.codigos.find((item) => item.codigo === codigo);
  if (!bien) return 'Detracción: elige el código del bien o servicio de ese tipo de operación.';
  datos.detraccion_porcentaje = String(bien.porcentaje);
  datos.tipo_operacion = fila.codigo;
  const extraIn = datos.detraccion_extra && typeof datos.detraccion_extra === 'object'
    ? datos.detraccion_extra
    : {};
  const extra = {};
  for (const campo of fila.campos) {
    let valor = String(extraIn[campo.key] || '').trim().slice(0, 180);
    if (!valor) {
      if (campo.opcional) continue;
      if (campo.tipo === 'sino') {
        extra[campo.key] = campo.defecto === 'no' ? 'no' : 'si';
        continue;
      }
      return `Detracción: completa ${campo.label}.`;
    }
    if (campo.tipo === 'fecha') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) {
        return `Detracción: ${campo.label} debe ser una fecha.`;
      }
      extra[campo.key] = valor;
      continue;
    }
    if (campo.tipo === 'monto') {
      const n = Number(valor.replace(',', '.'));
      if (!Number.isFinite(n) || n < 0) {
        return `Detracción: ${campo.label} debe ser un número. Si no aplica, escribe 0.`;
      }
      extra[campo.key] = n.toFixed(2);
      continue;
    }
    if (campo.tipo === 'sino') {
      extra[campo.key] = valor === 'si' ? 'si' : 'no';
      continue;
    }
    extra[campo.key] = valor;
  }
  datos.detraccion_extra = extra;
  return null;
}

module.exports = {
  listar,
  aplicarCatalogo,
};

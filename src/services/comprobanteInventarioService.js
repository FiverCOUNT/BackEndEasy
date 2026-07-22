const { randomUUID } = require('crypto');
const prisma = require('../config/prisma');
const movimientoModel = require('../models/movimientoModel');
const inventarioModel = require('../models/inventarioModel');
const { toStoredTimestamp } = require('../utils/fechas');

const TIPOS_VENTA = new Set(['01', '03']);

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function buildLineasInventario(invoice) {
  const out = [];

  for (const detail of invoice.details || []) {
    const item = detail.catalogItem;
    if (!item || item.kind === 'SERVICE') continue;
    if (!item.manejaStock && !item.manejaSerie) continue;

    const linea = {
      catalog_item_id: detail.catalogItemId,
      cantidad: Number(detail.cantidad),
    };
    if (detail.productoSerieId) {
      linea.producto_serie_id = detail.productoSerieId;
    }
    out.push(linea);
  }

  return out;
}

async function registrarSalidaPorComprobante(invoice, options = {}) {
  if (!invoice?.id || !TIPOS_VENTA.has(invoice.tipoDoc)) {
    return { aplicado: false, motivo: 'tipo_no_aplica' };
  }

  const existente = await prisma.movimiento.findFirst({
    where: {
      companyRuc: invoice.companyRuc,
      comprobanteId: invoice.id,
      tipo: 'SALIDA',
      estado: { not: 'ANULADA' },
    },
    select: { id: true },
  });
  if (existente) {
    return { aplicado: false, motivo: 'ya_registrado', movimiento_id: existente.id };
  }

  const almacenId = options.almacenId || invoice.almacenId || null;
  if (!almacenId) {
    return {
      aplicado: false,
      motivo: 'sin_almacen',
      message: 'Asigna un almacén al usuario o envía almacen_id en la venta.',
    };
  }

  const lineas = buildLineasInventario(invoice);
  if (!lineas.length) {
    return { aplicado: false, motivo: 'sin_lineas_inventario' };
  }

  const result = await movimientoModel.registrarSalida({
    companyRuc: invoice.companyRuc,
    almacenId,
    lineas,
    comprobanteId: invoice.id,
    clienteId: invoice.clienteId || null,
    observaciones: `Venta ${invoice.serie}-${invoice.correlativo}`,
  });

  if (result.error) {
    return {
      aplicado: false,
      motivo: result.error,
      catalog_item_id: result.catalogItemId,
      cantidad_actual: result.cantidad_actual,
      numero_serie: result.numeroSerie,
      message: mapInventarioError(result),
    };
  }

  return {
    aplicado: true,
    movimiento_id: result.movimiento?.id,
    movimiento: result.movimiento,
  };
}

/**
 * Devuelve al almacén el stock de la salida vinculada al comprobante
 * (al eliminar factura/boleta no aceptada por SUNAT).
 */
async function revertirSalidaPorComprobante(invoice) {
  if (!invoice?.id || !TIPOS_VENTA.has(String(invoice.tipoDoc || ''))) {
    return { revertido: false, motivo: 'tipo_no_aplica' };
  }

  const movimiento = await prisma.movimiento.findFirst({
    where: {
      companyRuc: invoice.companyRuc,
      comprobanteId: invoice.id,
      tipo: 'SALIDA',
      estado: { not: 'ANULADA' },
    },
    include: { lineas: true },
  });

  if (!movimiento) {
    return { revertido: false, motivo: 'sin_salida' };
  }

  const almacenId = movimiento.almacenId;
  if (!almacenId) {
    return { revertido: false, motivo: 'sin_almacen' };
  }

  await prisma.$transaction(async (tx) => {
    for (const linea of movimiento.lineas || []) {
      const cantidad = toNumber(linea.cantidad, 0);
      if (cantidad <= 0) continue;

      if (linea.productoSerieId) {
        await tx.productoSerie.updateMany({
          where: { id: linea.productoSerieId, companyRuc: invoice.companyRuc },
          data: {
            estado: 'DISPONIBLE',
            almacenId,
            entregaId: null,
            comprobanteId: null,
          },
        });
        await tx.inventario.upsert({
          where: { productoSerieId: linea.productoSerieId },
          create: {
            id: randomUUID(),
            companyRuc: invoice.companyRuc,
            catalogItemId: linea.catalogItemId,
            almacenId,
            productoSerieId: linea.productoSerieId,
            cantidad: 1,
          },
          update: {
            catalogItemId: linea.catalogItemId,
            almacenId,
            cantidad: 1,
          },
        });
        continue;
      }

      // Solo reponer cantidad si la línea afectó stock (no servicios).
      if (linea.manejaStock === false) continue;

      const key = inventarioModel.saldoKey(linea.catalogItemId, almacenId);
      const actualRow = await tx.inventario.findUnique({
        where: { saldoKey: key },
        select: { cantidad: true },
      });
      const nueva = toNumber(actualRow?.cantidad) + cantidad;
      await tx.inventario.upsert({
        where: { saldoKey: key },
        create: {
          id: randomUUID(),
          companyRuc: invoice.companyRuc,
          catalogItemId: linea.catalogItemId,
          almacenId,
          saldoKey: key,
          cantidad: nueva,
        },
        update: { cantidad: nueva },
      });
    }

    await tx.movimiento.update({
      where: { id: movimiento.id },
      data: {
        estado: 'ANULADA',
        observaciones: [
          movimiento.observaciones,
          `Stock devuelto al eliminar ${invoice.serie}-${invoice.correlativo} (${toStoredTimestamp()})`,
        ].filter(Boolean).join(' | '),
      },
    });
  });

  return {
    revertido: true,
    movimiento_id: movimiento.id,
    almacen_id: almacenId,
  };
}

function mapInventarioError(result) {
  const map = {
    almacen_not_found: 'Almacén no encontrado.',
    lineas_vacias: 'No hay líneas de inventario.',
    item_not_found: 'Producto no encontrado.',
    stock_insuficiente: 'Stock insuficiente para completar la venta.',
    series_requeridas: 'El producto requiere número de serie.',
    cantidad_series: 'Cada línea con serie debe tener cantidad 1.',
    series_no_disponibles: 'Una o más series no están disponibles.',
    cliente_requerido: 'Cliente requerido para la salida.',
  };
  return map[result.error] || `Error de inventario: ${result.error}`;
}

/** Map comprobanteId → movimiento SALIDA activa (para cards / listados). */
async function loadSalidasPorComprobanteIds(companyRuc, invoiceIds = []) {
  const ids = [...new Set((invoiceIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
  if (!ids.length) return new Map();

  const rows = await prisma.movimiento.findMany({
    where: {
      companyRuc,
      comprobanteId: { in: ids },
      tipo: 'SALIDA',
      estado: { not: 'ANULADA' },
    },
    select: { id: true, comprobanteId: true },
  });

  return new Map(rows.map((row) => [row.comprobanteId, row.id]));
}

/** Map referenciaId/comprobanteId → movimiento ENTRADA despachada. */
async function loadEntradasPorReferenciaIds(companyRuc, refIds = []) {
  const ids = [...new Set((refIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
  if (!ids.length) return new Map();

  const rows = await prisma.movimiento.findMany({
    where: {
      companyRuc,
      tipo: 'ENTRADA',
      estado: { not: 'ANULADA' },
      OR: [
        { referenciaId: { in: ids } },
        { comprobanteId: { in: ids } },
      ],
    },
    select: { id: true, referenciaId: true, comprobanteId: true, estado: true },
    orderBy: { fecha: 'desc' },
  });

  const map = new Map();
  for (const row of rows) {
    if (row.estado === 'EN_CAMINO') continue;
    if (row.referenciaId && !map.has(row.referenciaId)) map.set(row.referenciaId, row.id);
    if (row.comprobanteId && !map.has(row.comprobanteId)) map.set(row.comprobanteId, row.id);
  }
  return map;
}

module.exports = {
  buildLineasInventario,
  registrarSalidaPorComprobante,
  revertirSalidaPorComprobante,
  loadSalidasPorComprobanteIds,
  loadEntradasPorReferenciaIds,
};

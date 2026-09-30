const { randomUUID } = require('crypto');
const prisma = require('../config/prisma');
const movimientoModel = require('../models/movimientoModel');
const inventarioModel = require('../models/inventarioModel');
const { toStoredTimestamp } = require('../utils/fechas');

const TIPOS_VENTA = new Set(['01', '03']);
const TIPOS_NC_ENTRADA = new Set(['07']);

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

async function loadSalidaFacturaAfectada(companyRuc, documentoAfectadoId) {
  const docId = String(documentoAfectadoId || '').trim();
  if (!docId) return null;
  return prisma.movimiento.findFirst({
    where: {
      companyRuc,
      comprobanteId: docId,
      tipo: 'SALIDA',
      estado: { not: 'ANULADA' },
    },
    include: { lineas: true },
  });
}

/**
 * Líneas de ingreso por NC: solo catálogo que realmente salió en la salida de la factura afectada.
 */
async function buildLineasInventarioNotaCredito(invoice) {
  const salida = await loadSalidaFacturaAfectada(
    invoice.companyRuc,
    invoice.documentoAfectadoId,
  );
  if (!salida?.lineas?.length) return [];

  const cantidadRestante = new Map();
  const seriesEntregadas = [];

  for (const linea of salida.lineas) {
    if (linea.productoSerieId) {
      const serie = await prisma.productoSerie.findFirst({
        where: { id: linea.productoSerieId, companyRuc: invoice.companyRuc },
        select: { id: true, catalogItemId: true, numeroSerie: true, estado: true },
      });
      if (serie?.estado === 'ENTREGADO') {
        seriesEntregadas.push(serie);
      }
    } else if (linea.manejaStock !== false && linea.catalogItemId) {
      const prev = cantidadRestante.get(linea.catalogItemId) || 0;
      cantidadRestante.set(linea.catalogItemId, prev + toNumber(linea.cantidad));
    }
  }

  const out = [];
  const seriesUsadas = new Set();

  for (const detail of invoice.details || []) {
    if (!detail.catalogItemId) continue;
    const item = detail.catalogItem;
    if (!item || item.kind === 'SERVICE') continue;
    if (!item.manejaStock && !item.manejaSerie) continue;

    const almacenLinea = String(detail.almacenId || invoice.almacenId || salida.almacenId || '').trim();
    if (!almacenLinea) continue;

    const usaSerie = Boolean(item.manejaSerie || detail.productoSerieId);

    if (usaSerie) {
      let serieId = String(detail.productoSerieId || '').trim();
      let serie = seriesEntregadas.find((s) => s.id === serieId && !seriesUsadas.has(s.id));
      if (!serie) {
        serie = seriesEntregadas.find(
          (s) => s.catalogItemId === detail.catalogItemId && !seriesUsadas.has(s.id),
        );
        if (serie) serieId = serie.id;
      }
      if (!serie) continue;
      seriesUsadas.add(serie.id);
      out.push({
        catalog_item_id: detail.catalogItemId,
        cantidad: 1,
        almacen_id: almacenLinea,
        producto_serie_id: serie.id,
      });
      continue;
    }

    const restante = cantidadRestante.get(detail.catalogItemId) || 0;
    if (restante <= 0) continue;
    const qty = Math.min(toNumber(detail.cantidad, 0), restante);
    if (qty <= 0) continue;
    cantidadRestante.set(detail.catalogItemId, restante - qty);
    out.push({
      catalog_item_id: detail.catalogItemId,
      cantidad: qty,
      almacen_id: almacenLinea,
    });
  }

  return out;
}

function buildLineasInventario(invoice) {
  const out = [];

  for (const detail of invoice.details || []) {
    const item = detail.catalogItem;
    if (!item || item.kind === 'SERVICE') continue;
    if (!item.manejaStock && !item.manejaSerie) continue;

    // Regla: solo descuenta si la línea tiene almacén (digitadas van sin almacen_id).
    // Compat: líneas de catálogo antiguas sin almacen_id usan el almacén del CPE.
    const almacenLinea = String(detail.almacenId || '').trim()
      || (detail.catalogItemId ? String(invoice.almacenId || '').trim() : '')
      || null;
    if (!almacenLinea) continue;

    const linea = {
      catalog_item_id: detail.catalogItemId,
      cantidad: Number(detail.cantidad),
      almacen_id: almacenLinea,
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

  const almacenId = options.almacenId
    || invoice.almacenId
    || (invoice.details || []).map((d) => String(d.almacenId || '').trim()).find(Boolean)
    || null;
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
    usuarioId: options.usuarioId ?? null,
  });

  if (result.error) {
    return enrichInventarioError(invoice.companyRuc, {
      aplicado: false,
      motivo: result.error,
      catalog_item_id: result.catalogItemId,
      cantidad_actual: result.cantidad_actual,
      numero_serie: result.numeroSerie,
      message: mapInventarioError(result),
    });
  }

  return {
    aplicado: true,
    movimiento_id: result.movimiento?.id,
    movimiento: result.movimiento,
  };
}

/**
 * Ingreso por nota de crédito (devolución al almacén), vinculado al comprobante NC.
 * Solo corre si el usuario activó afectar_inventario y SUNAT aceptó la NC.
 */
async function registrarEntradaPorNotaCredito(invoice, options = {}) {
  if (!invoice?.id || !TIPOS_NC_ENTRADA.has(String(invoice.tipoDoc || ''))) {
    return { aplicado: false, motivo: 'tipo_no_aplica' };
  }

  const existente = await prisma.movimiento.findFirst({
    where: {
      companyRuc: invoice.companyRuc,
      tipo: 'ENTRADA',
      estado: { not: 'ANULADA' },
      OR: [
        { comprobanteId: invoice.id },
        { referenciaId: invoice.id, referenciaTipo: 'DEVOLUCION_CLIENTE' },
      ],
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
      message: 'Asigna un almacén al usuario o envía almacen_id en la nota de crédito.',
    };
  }

  const lineas = await buildLineasInventarioNotaCredito(invoice);
  if (!lineas.length) {
    const salidaOrigen = await loadSalidaFacturaAfectada(
      invoice.companyRuc,
      invoice.documentoAfectadoId,
    );
    return {
      aplicado: false,
      motivo: salidaOrigen ? 'sin_lineas_inventario' : 'sin_salida_origen',
      message: salidaOrigen
        ? 'No hay productos del catálogo que hayan salido de almacén en esta devolución.'
        : 'La factura no descontó almacén; la nota de crédito se emite sin ingreso de stock.',
    };
  }

  if (!invoice.clienteId) {
    return {
      aplicado: false,
      motivo: 'cliente_requerido',
      message: 'La nota de crédito requiere cliente para registrar la devolución en almacén.',
    };
  }

  const result = await movimientoModel.registrarEntrada({
    companyRuc: invoice.companyRuc,
    almacenId,
    lineas,
    comprobanteId: invoice.id,
    referenciaTipo: 'DEVOLUCION_CLIENTE',
    referenciaId: invoice.id,
    clienteId: invoice.clienteId,
    observaciones: `Devolución por NC ${invoice.serie}-${invoice.correlativo}`,
    usuarioId: options.usuarioId ?? null,
  });

  if (result.error) {
    return enrichInventarioError(invoice.companyRuc, {
      aplicado: false,
      motivo: result.error,
      catalog_item_id: result.catalogItemId,
      numero_serie: result.numeroSerie,
      message: mapInventarioError(result),
    });
  }

  return {
    aplicado: true,
    movimiento_id: result.movimiento?.id,
    movimiento: result.movimiento,
  };
}

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
    serie_no_entregada: 'La serie no está registrada como entregada al cliente.',
    serie_no_de_cliente: 'La serie no corresponde a una entrega de este cliente.',
    cliente_requerido: 'Cliente requerido para la devolución.',
  };
  return map[result.error || result.motivo] || `Error de inventario: ${result.error || result.motivo}`;
}

async function enrichInventarioError(companyRuc, payload) {
  const catalogItemId = String(payload.catalog_item_id || payload.catalogItemId || '').trim();
  if (!catalogItemId) return payload;

  const item = await prisma.catalogItem.findFirst({
    where: { companyRuc, id: catalogItemId },
    select: { nombre: true, unidad: true },
  });
  if (!item) return payload;

  const motivo = payload.motivo || payload.error;
  let message = payload.message || mapInventarioError({ error: motivo });

  if (motivo === 'stock_insuficiente') {
    const disp = payload.cantidad_actual ?? 0;
    message = `Stock insuficiente de "${item.nombre}". Disponible: ${disp} ${item.unidad || ''}.`.trim();
  } else if (motivo === 'series_requeridas') {
    message = `"${item.nombre}" requiere seleccionar la serie de cada unidad.`;
  } else if (motivo === 'cantidad_series') {
    message = `"${item.nombre}": usa una línea con cantidad 1 por cada serie.`;
  } else if (motivo === 'series_no_disponibles') {
    const serie = payload.numero_serie || payload.numeroSerie;
    message = serie
      ? `La serie ${serie} de "${item.nombre}" no está disponible en el almacén.`
      : `Una o más series de "${item.nombre}" no están disponibles.`;
  }

  return {
    ...payload,
    producto: item.nombre,
    message,
  };
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

/** Map guía remisión (09) → movimiento SALIDA de traslado vinculada. */
async function loadSalidasPorGuiaRemisionIds(companyRuc, guiaIds = []) {
  const ids = [...new Set((guiaIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
  if (!ids.length) return new Map();

  const rows = await prisma.movimiento.findMany({
    where: {
      companyRuc,
      guiaRemisionId: { in: ids },
      tipo: 'SALIDA',
      estado: { not: 'ANULADA' },
    },
    select: { id: true, guiaRemisionId: true, fecha: true },
    orderBy: { fecha: 'desc' },
  });

  const map = new Map();
  for (const row of rows) {
    if (row.guiaRemisionId && !map.has(row.guiaRemisionId)) {
      map.set(row.guiaRemisionId, row.id);
    }
  }
  return map;
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
  buildLineasInventarioNotaCredito,
  loadSalidaFacturaAfectada,
  registrarSalidaPorComprobante,
  registrarEntradaPorNotaCredito,
  revertirSalidaPorComprobante,
  loadSalidasPorComprobanteIds,
  loadSalidasPorGuiaRemisionIds,
  loadEntradasPorReferenciaIds,
};

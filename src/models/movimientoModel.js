const { randomUUID } = require('crypto');
const prisma = require('../config/prisma');
const inventarioModel = require('./inventarioModel');
const productoSerieModel = require('./productoSerieModel');
const clienteModel = require('./clienteModel');
const { nowTimestampMs, toStoredTimestamp, toApiTimestamp, compareStoredTimestamps } = require('../utils/fechas');
function toNumber(value) {
  if (value == null) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function unidadPermiteSerie(unidad) {
  return String(unidad || 'NIU').toUpperCase() === 'NIU';
}

function usaSeriesInventario(item) {
  return Boolean(item?.manejaSerie && unidadPermiteSerie(item.unidad));
}

function lineaUsaSeries(item, linea) {
  // Producto ya marcado con series, o ingreso que trae número de serie (activa series).
  if (usaSeriesInventario(item)) return true;
  return Boolean(linea.productoSerieId || linea.numeroSerie);
}

/** Producto por cantidad (LTR, KGM, NIU sin series): debe mover tabla inventario. */
function usaInventarioCantidad(item, linea) {
  return item.kind === 'PRODUCT' && !lineaUsaSeries(item, linea);
}

/** Ingresos/salidas con muchas series: createMany + timeout amplio. */
const MOVIMIENTO_TX_OPTS = { maxWait: 20_000, timeout: 60_000 };

/** Devolución NC / cliente: solo productos con stock o serie; no servicios. */
function itemAfectaInventarioDevolucion(item) {
  if (!item || item.kind === 'SERVICE') return false;
  return Boolean(item.manejaStock || usaSeriesInventario(item));
}

function normalizeStringArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim()).filter(Boolean);
  }
  return [];
}

/** Expande arrays legacy a una fila por serie (compatibilidad temporal). */
function normalizeIncomingLineas(rawLineas) {
  const out = [];
  for (const raw of rawLineas || []) {
    const catalogItemId = String(raw.catalog_item_id || raw.catalogItemId || '').trim();
    const cantidad = toNumber(raw.cantidad, 1);
    const productoSerieId = String(raw.producto_serie_id || raw.productoSerieId || '').trim();
    const numeroSerie = String(
      raw.numero_serie || raw.numeroSerie || raw.producto_serie?.numeroSerie || '',
    ).trim();
    const legacyIds = normalizeStringArray(raw.serie_ids || raw.serieIds);
    const legacyNumeros = normalizeStringArray(raw.series || raw.numeros_serie || raw.numerosSerie);

    if (productoSerieId) {
      out.push({ catalogItemId, cantidad: cantidad || 1, productoSerieId, numeroSerie: '' });
      continue;
    }
    if (numeroSerie) {
      out.push({ catalogItemId, cantidad: 1, productoSerieId: '', numeroSerie });
      continue;
    }
    if (legacyIds.length > 0) {
      for (const id of legacyIds) {
        out.push({ catalogItemId, cantidad: 1, productoSerieId: id, numeroSerie: '' });
      }
      continue;
    }
    if (legacyNumeros.length > 0) {
      for (const num of legacyNumeros) {
        out.push({ catalogItemId, cantidad: 1, productoSerieId: '', numeroSerie: num });
      }
      continue;
    }
    out.push({ catalogItemId, cantidad, productoSerieId: '', numeroSerie: '' });
  }
  return out;
}

function toApiLinea(linea) {
  return {
    linea_id: linea.lineaId,
    id: linea.externalId,
    catalog_item_id: linea.catalogItemId,
    nombre: linea.nombre,
    codigo: linea.codigo,
    descripcion: linea.descripcion,
    unidad: linea.unidad,
    precio_unitario: linea.precioUnitario != null ? toNumber(linea.precioUnitario) : null,
    afectacion_igv: linea.afectacionIgv,
    kind: linea.kind,
    maneja_stock: linea.manejaStock,
    maneja_serie: linea.manejaSerie,
    cantidad: toNumber(linea.cantidad),
    almacen_id: linea.almacenId,
    producto_serie_id: linea.productoSerieId,
    producto_serie: linea.productoSerie ? productoSerieModel.toApi(linea.productoSerie) : null,
  };
}

function toApiCliente(cliente) {
  if (!cliente) return undefined;
  return {
    tipo_doc: cliente.tipoDoc,
    numero_doc: cliente.numeroDoc,
    razon_social: cliente.razonSocial,
  };
}

function toApiMovimiento(row) {
  if (!row) return null;
  return {
    id: row.id,
    company_ruc: row.companyRuc,
    almacen_id: row.almacenId,
    tipo: row.tipo,
    fecha: toApiTimestamp(row.fecha),
    observaciones: row.observaciones,
    referencia_tipo: row.referenciaTipo,
    referencia_id: row.referenciaId,
    numero: row.numero,
    almacen_destino_id: row.almacenDestinoId,
    estado: row.estado,
    comprobante_id: row.comprobanteId,
    guia_remision_id: row.guiaRemisionId,
    fecha_despacho: toApiTimestamp(row.fechaDespacho),
    cliente_id: row.clienteId || undefined,
    cliente: toApiCliente(row.cliente),
    lineas: (row.lineas || []).map(toApiLinea),
  };
}

const movimientoInclude = {
  lineas: {
    include: { productoSerie: true },
    orderBy: { lineaId: 'asc' },
  },
  cliente: {
    select: { tipoDoc: true, numeroDoc: true, razonSocial: true },
  },
};
function snapshotLineaFromItem(item, { almacenId, cantidad, productoSerieId }) {
  return {
    catalogItemId: item.id,
    nombre: item.nombre,
    codigo: item.codigo,
    descripcion: item.descripcion,
    unidad: item.unidad,
    precioUnitario: item.precioUnitario,
    afectacionIgv: item.afectacionIgv,
    kind: item.kind,
    manejaStock: item.manejaStock,
    manejaSerie: item.manejaSerie,
    cantidad,
    almacenId,
    productoSerieId: productoSerieId || null,
  };
}

async function nextNumeroEntrada(companyRuc, tx) {
  const client = tx || prisma;
  const count = await client.movimiento.count({
    where: { companyRuc, tipo: 'ENTRADA' },
  });
  return `MOV-${String(count + 1).padStart(4, '0')}`;
}

async function nextNumeroSalida(companyRuc, tx) {
  const client = tx || prisma;
  const count = await client.movimiento.count({
    where: { companyRuc, tipo: 'SALIDA' },
  });
  return `ENT-${String(count + 1).padStart(4, '0')}`;
}

async function findMany({ companyRuc, tipo = null, almacenId = null }) {
  const where = { companyRuc };
  if (tipo) where.tipo = tipo;
  if (almacenId) where.almacenId = almacenId;

  const rows = await prisma.movimiento.findMany({
    where,
    include: movimientoInclude,
  });

  rows.sort((a, b) => compareStoredTimestamps(b.fecha, a.fecha));

  return rows.map(toApiMovimiento);
}

/** Entregas (salida a cliente) y devoluciones registradas para un cliente. */
async function findByCliente({ companyRuc, clienteId, almacenId = null }) {
  const id = (clienteId || '').trim();
  if (!id) return [];

  const where = {
    companyRuc,
    clienteId: id,
    OR: [
      { tipo: 'SALIDA', almacenDestinoId: null },
      { tipo: 'ENTRADA', referenciaTipo: 'DEVOLUCION_CLIENTE' },
    ],
  };
  if (almacenId) where.almacenId = almacenId;

  const rows = await prisma.movimiento.findMany({
    where,
    include: movimientoInclude,
  });

  rows.sort((a, b) => compareStoredTimestamps(b.fecha, a.fecha));

  return rows.map(toApiMovimiento);
}

async function registrarEntrada({
  companyRuc,
  almacenId,
  lineas,
  observaciones = null,
  clienteId = null,
  cliente = null,
  referenciaTipo = null,
  referenciaId = null,
  comprobanteId = null,
}) {
  const almacen = await prisma.almacen.findFirst({
    where: { id: almacenId, companyRuc },
  });
  if (!almacen) return { error: 'almacen_not_found' };

  let resolvedClienteId = null;
  let esDevolucion = false;

  const quiereDevolucion = Boolean(
    (clienteId || '').trim() || (cliente && typeof cliente === 'object'),
  );

  if (quiereDevolucion) {
    const resolved = await clienteModel.resolveForSalida({
      companyRuc,
      clienteId,
      clienteBody: cliente,
    });
    if (resolved.error) return { error: resolved.error };
    if (!resolved.clienteId) return { error: 'cliente_requerido' };
    resolvedClienteId = resolved.clienteId;
    esDevolucion = true;
  }

  const parsedLineas = normalizeIncomingLineas(lineas).filter((l) => l.catalogItemId);
  if (parsedLineas.length === 0) {
    return { error: 'lineas_vacias' };
  }

  const itemIds = [...new Set(parsedLineas.map((l) => l.catalogItemId))];
  const items = await prisma.catalogItem.findMany({
    where: { companyRuc, id: { in: itemIds } },
  });
  const itemsById = new Map(items.map((i) => [i.id, i]));

  let lineasEfectivas = parsedLineas;
  if (esDevolucion) {
    lineasEfectivas = parsedLineas.filter((linea) => {
      const item = itemsById.get(linea.catalogItemId);
      return item && itemAfectaInventarioDevolucion(item);
    });
    if (lineasEfectivas.length === 0) {
      return { error: 'lineas_vacias' };
    }
  }

  for (const linea of lineasEfectivas) {
    const item = itemsById.get(linea.catalogItemId);
    if (!item) return { error: 'item_not_found', catalogItemId: linea.catalogItemId };
    if (item.activo === false) {
      return { error: 'item_inactivo', catalogItemId: linea.catalogItemId };
    }

    if (lineaUsaSeries(item, linea)) {
      if (!linea.productoSerieId && !linea.numeroSerie) {
        return { error: 'series_requeridas', catalogItemId: linea.catalogItemId };
      }
      if (linea.cantidad !== 1) {
        return { error: 'cantidad_series', catalogItemId: linea.catalogItemId };
      }
    } else if (linea.cantidad <= 0) {
      return { error: 'cantidad_invalida', catalogItemId: linea.catalogItemId };
    }
  }

  // Ingreso proveedor: preparar series nuevas y validar duplicados fuera del tx.
  const seriesNuevas = [];
  if (!esDevolucion) {
    const seenNumeros = new Set();
    for (const linea of lineasEfectivas) {
      const item = itemsById.get(linea.catalogItemId);
      if (!lineaUsaSeries(item, linea)) continue;
      const numeroSerie = String(linea.numeroSerie || '').trim();
      if (!numeroSerie) {
        return { error: 'series_requeridas', catalogItemId: linea.catalogItemId };
      }
      if (seenNumeros.has(numeroSerie)) {
        return { error: 'serie_existente', numeroSerie };
      }
      seenNumeros.add(numeroSerie);
      seriesNuevas.push({
        serieId: randomUUID(),
        item,
        numeroSerie,
      });
    }

    if (seriesNuevas.length > 0) {
      const existentes = await prisma.productoSerie.findMany({
        where: { companyRuc, numeroSerie: { in: [...seenNumeros] } },
        select: { numeroSerie: true },
      });
      if (existentes.length > 0) {
        return { error: 'serie_existente', numeroSerie: existentes[0].numeroSerie };
      }
    }
  }

  const movimientoId = randomUUID();
  const fecha = toStoredTimestamp();
  const lineasCreate = [];
  try {
    await prisma.$transaction(async (tx) => {
      const numero = await nextNumeroEntrada(companyRuc, tx);

      if (!esDevolucion && seriesNuevas.length > 0) {
        await tx.productoSerie.createMany({
          data: seriesNuevas.map(({ serieId, item, numeroSerie }) => ({
            id: serieId,
            companyRuc,
            catalogItemId: item.id,
            numeroSerie,
            almacenId,
            estado: 'DISPONIBLE',
          })),
        });

        const inventariosData = seriesNuevas
          .filter(({ item }) => item.kind === 'PRODUCT')
          .map(({ serieId, item }) => ({
            id: randomUUID(),
            companyRuc,
            catalogItemId: item.id,
            almacenId,
            productoSerieId: serieId,
            cantidad: 1,
          }));
        if (inventariosData.length > 0) {
          await tx.inventario.createMany({ data: inventariosData });
        }

        const itemsToFlag = new Map();
        for (const { item } of seriesNuevas) {
          if (!usaSeriesInventario(item) || !item.manejaStock) {
            itemsToFlag.set(item.id, true);
          }
        }
        for (const itemId of itemsToFlag.keys()) {
          await tx.catalogItem.update({
            where: { id: itemId },
            data: { manejaSerie: true, manejaStock: true },
          });
        }
      }

      const serieIdByNumero = new Map(
        seriesNuevas.map(({ numeroSerie, serieId }) => [numeroSerie, serieId]),
      );

      for (const linea of lineasEfectivas) {
        const item = itemsById.get(linea.catalogItemId);
        const ingresaSeries = lineaUsaSeries(item, linea);
        const afectaSaldo = usaInventarioCantidad(item, linea);

        if (ingresaSeries) {
          if (!esDevolucion) {
            const serieId = serieIdByNumero.get(linea.numeroSerie);
            lineasCreate.push(snapshotLineaFromItem(
              { ...item, manejaSerie: true, manejaStock: true },
              { almacenId, cantidad: 1, productoSerieId: serieId },
            ));
            continue;
          }

          let serie;
          if (linea.productoSerieId) {
            serie = await tx.productoSerie.findFirst({
              where: {
                id: linea.productoSerieId,
                companyRuc,
                catalogItemId: item.id,
                estado: 'ENTREGADO',
              },
            });
          } else {
            serie = await tx.productoSerie.findFirst({
              where: { companyRuc, numeroSerie: linea.numeroSerie, catalogItemId: item.id },
            });
            if (serie && serie.estado !== 'ENTREGADO') serie = null;
          }
          if (!serie) {
            const err = new Error('Serie no entregada o no encontrada');
            err.code = 'serie_no_entregada';
            err.numeroSerie = linea.productoSerieId || linea.numeroSerie;
            throw err;
          }
          if (!serie.entregaId) {
            const err = new Error(`La serie ${serie.numeroSerie} no tiene entrega asociada`);
            err.code = 'serie_no_de_cliente';
            err.numeroSerie = serie.numeroSerie;
            throw err;
          }
          const entrega = await tx.movimiento.findFirst({
            where: {
              id: serie.entregaId,
              companyRuc,
              tipo: 'SALIDA',
              clienteId: resolvedClienteId,
            },
          });
          if (!entrega) {
            const err = new Error(`La serie ${serie.numeroSerie} no corresponde a este cliente`);
            err.code = 'serie_no_de_cliente';
            err.numeroSerie = serie.numeroSerie;
            throw err;
          }

          await tx.productoSerie.update({
            where: { id: serie.id },
            data: { estado: 'DISPONIBLE', almacenId, entregaId: null },
          });

          if (item.kind === 'PRODUCT') {
            await tx.inventario.upsert({
              where: { productoSerieId: serie.id },
              create: {
                id: randomUUID(),
                companyRuc,
                catalogItemId: item.id,
                almacenId,
                productoSerieId: serie.id,
                cantidad: 1,
              },
              update: { catalogItemId: item.id, almacenId, cantidad: 1 },
            });
          }

          lineasCreate.push(snapshotLineaFromItem(item, {
            almacenId,
            cantidad: 1,
            productoSerieId: serie.id,
          }));
        } else if (afectaSaldo) {
          const key = inventarioModel.saldoKey(item.id, almacenId);
          const actualRow = await tx.inventario.findUnique({
            where: { saldoKey: key },
            select: { cantidad: true },
          });
          const actual = toNumber(actualRow?.cantidad);
          const nueva = actual + linea.cantidad;

          await tx.inventario.upsert({
            where: { saldoKey: key },
            create: {
              id: randomUUID(),
              companyRuc,
              catalogItemId: item.id,
              almacenId: almacenId,
              saldoKey: key,
              cantidad: nueva,
            },
            update: { cantidad: nueva },
          });

          if (!item.manejaStock) {
            await tx.catalogItem.update({
              where: { id: item.id },
              data: { manejaStock: true },
            });
          }

          lineasCreate.push(
            snapshotLineaFromItem(item, {
              almacenId: almacenId,
              cantidad: linea.cantidad,
            }),
          );
        } else {
          lineasCreate.push(
            snapshotLineaFromItem(item, {
              almacenId: almacenId,
              cantidad: linea.cantidad,
            }),
          );
        }
      }

      await tx.movimiento.create({
        data: {
          id: movimientoId,
          companyRuc,
          almacenId: almacenId,
          tipo: 'ENTRADA',
          fecha,
          observaciones: observaciones?.trim() || null,
          referenciaTipo: esDevolucion
            ? 'DEVOLUCION_CLIENTE'
            : (String(referenciaTipo || '').trim() || 'INGRESO_MANUAL'),
          referenciaId: (!esDevolucion && referenciaId)
            ? String(referenciaId).trim()
            : null,
          comprobanteId: (!esDevolucion && comprobanteId)
            ? String(comprobanteId).trim()
            : null,
          numero,
          estado: 'DESPACHADA',
          clienteId: esDevolucion ? resolvedClienteId : null,
          lineas: {
            create: lineasCreate,
          },
        },
      });
    }, MOVIMIENTO_TX_OPTS);
  } catch (err) {
    if (err.code === 'almacen_not_found') {
      return { error: 'almacen_not_found' };
    }
    if (err.code === 'serie_existente') {
      return { error: 'serie_existente', numeroSerie: err.numeroSerie };
    }
    if (err.code === 'serie_no_entregada') {
      return { error: 'serie_no_entregada', numeroSerie: err.numeroSerie };
    }
    if (err.code === 'serie_no_de_cliente') {
      return { error: 'serie_no_de_cliente', numeroSerie: err.numeroSerie };
    }
    if (err.code === 'P2002') {
      return { error: 'serie_existente' };
    }
    console.error('[registrarEntrada]', err);
    throw err;
  }

  const movimiento = await prisma.movimiento.findUnique({
    where: { id: movimientoId },
    include: movimientoInclude,
  });

  // Cerrar compra registrada: líneas → RECIBIDO.
  const refId = String(referenciaId || '').trim();
  const refTipo = String(referenciaTipo || '').trim().toUpperCase();
  if (
    !esDevolucion
    && refId
    && (refTipo === 'COMPRA' || refTipo === 'COMPRA_EN_CAMINO' || refTipo === 'COMPRA_REGISTRADA')
  ) {
    try {
      const compra = await prisma.compra.findFirst({
        where: { id: refId, companyRuc },
        select: { id: true, lineasJson: true },
      });
      if (compra) {
        const lineasPrev = Array.isArray(compra.lineasJson) ? compra.lineasJson : [];
        await prisma.compra.update({
          where: { id: compra.id },
          data: {
            lineasJson: lineasPrev.map((l) => ({ ...l, estado: 'RECIBIDO' })),
          },
        });
      }
    } catch (markErr) {
      console.warn('[registrarEntrada] no se pudo marcar compra RECIBIDO:', markErr.message);
    }
  }

  return { movimiento: toApiMovimiento(movimiento) };
}

/**
 * Entrada pendiente: crea movimiento + líneas de catálogo sin sumar stock.
 * Usado al registrar una compra cuya mercadería aún no llegó al almacén.
 */
async function registrarEntradaEnCamino({
  companyRuc,
  almacenId,
  lineas,
  observaciones = null,
  referenciaId = null,
  referenciaTipo = 'COMPRA_EN_CAMINO',
}) {
  const almacen = await prisma.almacen.findFirst({
    where: { id: almacenId, companyRuc },
  });
  if (!almacen) return { error: 'almacen_not_found' };

  const parsedLineas = normalizeIncomingLineas(lineas).filter((l) => l.catalogItemId);
  if (parsedLineas.length === 0) {
    return { error: 'lineas_vacias' };
  }

  const itemIds = [...new Set(parsedLineas.map((l) => l.catalogItemId))];
  const items = await prisma.catalogItem.findMany({
    where: { companyRuc, id: { in: itemIds } },
  });
  const itemsById = new Map(items.map((i) => [i.id, i]));

  for (const linea of parsedLineas) {
    const item = itemsById.get(linea.catalogItemId);
    if (!item) return { error: 'item_not_found', catalogItemId: linea.catalogItemId };
    if (item.activo === false) {
      return { error: 'item_inactivo', catalogItemId: linea.catalogItemId };
    }
    if (linea.cantidad <= 0) {
      return { error: 'cantidad_invalida', catalogItemId: linea.catalogItemId };
    }
  }

  const movimientoId = randomUUID();
  const fecha = toStoredTimestamp();
  try {
    await prisma.$transaction(async (tx) => {
      const numero = await nextNumeroEntrada(companyRuc, tx);
      const lineasCreate = parsedLineas.map((linea) => {
        const item = itemsById.get(linea.catalogItemId);
        return snapshotLineaFromItem(item, {
          almacenId,
          cantidad: linea.cantidad,
        });
      });

      await tx.movimiento.create({
        data: {
          id: movimientoId,
          companyRuc,
          almacenId,
          tipo: 'ENTRADA',
          fecha,
          observaciones: observaciones?.trim() || null,
          referenciaTipo,
          referenciaId: referenciaId || null,
          numero,
          estado: 'EN_CAMINO',
          lineas: { create: lineasCreate },
        },
      });
    }, MOVIMIENTO_TX_OPTS);
  } catch (err) {
    console.error('[registrarEntradaEnCamino]', err);
    throw err;
  }

  const movimiento = await prisma.movimiento.findUnique({
    where: { id: movimientoId },
    include: movimientoInclude,
  });
  return { movimiento: toApiMovimiento(movimiento) };
}

async function resolverSerieSalida(tx, { companyRuc, almacenId, catalogItemId, linea }) {
  if (linea.productoSerieId) {
    const serie = await tx.productoSerie.findFirst({
      where: {
        id: linea.productoSerieId,
        companyRuc,
        catalogItemId,
        almacenId,
        estado: 'DISPONIBLE',
      },
    });
    if (!serie) {
      const err = new Error('Serie no disponible en el almacén');
      err.code = 'series_no_disponibles';
      throw err;
    }
    return serie;
  }

  if (linea.numeroSerie) {
    const serie = await tx.productoSerie.findFirst({
      where: {
        companyRuc,
        catalogItemId,
        almacenId,
        numeroSerie: linea.numeroSerie,
        estado: 'DISPONIBLE',
      },
    });
    if (!serie) {
      const err = new Error(`Serie ${linea.numeroSerie} no disponible en el almacén`);
      err.code = 'series_no_disponibles';
      err.numeroSerie = linea.numeroSerie;
      throw err;
    }
    return serie;
  }

  const err = new Error('series_requeridas');
  err.code = 'series_requeridas';
  throw err;
}

async function registrarSalida({
  companyRuc,
  almacenId,
  almacenDestinoId = null,
  lineas,
  comprobanteId = null,
  guiaRemisionId = null,
  observaciones = null,
  clienteId = null,
  cliente = null,
}) {
  const esTraslado = Boolean(almacenDestinoId);

  const almacen = await prisma.almacen.findFirst({
    where: { id: almacenId, companyRuc },
  });
  if (!almacen) return { error: 'almacen_not_found' };

  if (esTraslado) {
    if (!almacenDestinoId) {
      return { error: 'almacen_destino_requerido' };
    }
    if (almacenDestinoId === almacenId) {
      return { error: 'mismo_almacen' };
    }
    const destino = await prisma.almacen.findFirst({
      where: { id: almacenDestinoId, companyRuc },
    });
    if (!destino) return { error: 'almacen_destino_not_found' };
  }

  let resolvedClienteId = null;
  if (!esTraslado) {
    const resolved = await clienteModel.resolveForSalida({
      companyRuc,
      clienteId,
      clienteBody: cliente,
    });
    if (resolved.error) return { error: resolved.error };
    resolvedClienteId = resolved.clienteId;

    if (!resolvedClienteId && comprobanteId) {
      const comprobante = await prisma.invoice.findFirst({
        where: { id: comprobanteId, companyRuc },
        select: { clienteId: true },
      });
      resolvedClienteId = comprobante?.clienteId || null;
    }

    if (!resolvedClienteId && !comprobanteId) {
      return { error: 'cliente_requerido' };
    }
  }
  const parsedLineas = normalizeIncomingLineas(lineas).filter((l) => l.catalogItemId);
  if (parsedLineas.length === 0) {
    return { error: 'lineas_vacias' };
  }

  const itemIds = [...new Set(parsedLineas.map((l) => l.catalogItemId))];
  const items = await prisma.catalogItem.findMany({
    where: { companyRuc, id: { in: itemIds } },
  });
  const itemsById = new Map(items.map((i) => [i.id, i]));

  for (const linea of parsedLineas) {
    const item = itemsById.get(linea.catalogItemId);
    if (!item) return { error: 'item_not_found', catalogItemId: linea.catalogItemId };
    if (item.activo === false) {
      return { error: 'item_inactivo', catalogItemId: linea.catalogItemId };
    }

    const usaSeries = lineaUsaSeries(item, linea);

    if (usaSeries) {
      if (!linea.productoSerieId && !linea.numeroSerie) {
        return { error: 'series_requeridas', catalogItemId: linea.catalogItemId };
      }
      if (linea.cantidad !== 1) {
        return { error: 'cantidad_series', catalogItemId: linea.catalogItemId };
      }
    } else if (linea.cantidad <= 0) {
      return { error: 'cantidad_invalida', catalogItemId: linea.catalogItemId };
    } else if (usaInventarioCantidad(item, linea)) {
      const actual = await inventarioModel.getCantidadEnAlmacen(linea.catalogItemId, almacenId);
      if (actual < linea.cantidad) {
        return {
          error: 'stock_insuficiente',
          catalogItemId: linea.catalogItemId,
          cantidad_actual: actual,
        };
      }
    }
  }

  const movimientoId = randomUUID();
  const fecha = toStoredTimestamp();
  const lineasCreate = [];

  try {
    await prisma.$transaction(async (tx) => {
      const numero = await nextNumeroSalida(companyRuc, tx);

      for (const linea of parsedLineas) {
        const item = itemsById.get(linea.catalogItemId);
        const usaSeries = lineaUsaSeries(item, linea);

        if (usaSeries) {
          const serie = await resolverSerieSalida(tx, {
            companyRuc,
            almacenId,
            catalogItemId: item.id,
            linea,
          });

          if (esTraslado) {
            await tx.productoSerie.update({
              where: { id: serie.id },
              data: { almacenId: almacenDestinoId },
            });
            await tx.inventario.updateMany({
              where: { productoSerieId: serie.id },
              data: { almacenId: almacenDestinoId },
            });
          } else {
            await tx.productoSerie.update({
              where: { id: serie.id },
              data: { estado: 'ENTREGADO', entregaId: movimientoId },
            });
            await tx.inventario.deleteMany({ where: { productoSerieId: serie.id } });
          }

          lineasCreate.push(snapshotLineaFromItem(item, {
            almacenId,
            cantidad: 1,
            productoSerieId: serie.id,
          }));
        } else if (usaInventarioCantidad(item, linea)) {
          const key = inventarioModel.saldoKey(item.id, almacenId);
          const actualRow = await tx.inventario.findUnique({
            where: { saldoKey: key },
            select: { cantidad: true },
          });
          const actual = toNumber(actualRow?.cantidad);
          const nueva = actual - linea.cantidad;
          if (nueva < 0) {
            const err = new Error('Stock insuficiente');
            err.code = 'stock_insuficiente';
            err.catalogItemId = item.id;
            err.cantidad_actual = actual;
            throw err;
          }

          if (nueva === 0) {
            await tx.inventario.deleteMany({ where: { saldoKey: key } });
          } else {
            await tx.inventario.update({
              where: { saldoKey: key },
              data: { cantidad: nueva },
            });
          }

          if (esTraslado) {
            const keyDest = inventarioModel.saldoKey(item.id, almacenDestinoId);
            const destRow = await tx.inventario.findUnique({
              where: { saldoKey: keyDest },
              select: { cantidad: true },
            });
            const destActual = toNumber(destRow?.cantidad);
            const destNueva = destActual + linea.cantidad;

            await tx.inventario.upsert({
              where: { saldoKey: keyDest },
              create: {
                companyRuc,
                catalogItemId: item.id,
                almacenId: almacenDestinoId,
                saldoKey: keyDest,
                cantidad: destNueva,
              },
              update: { cantidad: destNueva },
            });
          }

          if (!item.manejaStock) {
            await tx.catalogItem.update({
              where: { id: item.id },
              data: { manejaStock: true },
            });
          }

          lineasCreate.push(snapshotLineaFromItem(item, { almacenId, cantidad: linea.cantidad }));
        } else {
          lineasCreate.push(snapshotLineaFromItem(item, { almacenId, cantidad: linea.cantidad }));
        }
      }

      await tx.movimiento.create({
        data: {
          id: movimientoId,
          companyRuc,
          almacenId,
          almacenDestinoId: esTraslado ? almacenDestinoId : null,
          tipo: 'SALIDA',
          fecha,
          observaciones: observaciones?.trim() || null,
          referenciaTipo: esTraslado ? 'TRASLADO' : 'SALIDA_MANUAL',
          numero,
          estado: 'DESPACHADA',
          comprobanteId: comprobanteId || null,
          guiaRemisionId: guiaRemisionId || null,
          fechaDespacho: fecha,
          clienteId: esTraslado ? null : resolvedClienteId,
          lineas: {            create: lineasCreate,
          },
        },
      });
    }, MOVIMIENTO_TX_OPTS);
  } catch (err) {
    if (err.code === 'series_no_disponibles') {
      return {
        error: 'series_no_disponibles',
        numeroSerie: err.numeroSerie,
      };
    }
    if (err.code === 'stock_insuficiente') {
      return {
        error: 'stock_insuficiente',
        catalogItemId: err.catalogItemId,
        cantidad_actual: err.cantidad_actual,
      };
    }
    console.error('[registrarSalida]', err);
    throw err;
  }

  const movimiento = await prisma.movimiento.findUnique({
    where: { id: movimientoId },
    include: movimientoInclude,
  });

  return { movimiento: toApiMovimiento(movimiento) };
}

async function registrarMovimiento({ companyRuc, tipo, ...params }) {
  const normalized = String(tipo || '').trim().toUpperCase();

  if (normalized === 'ENTRADA') {
    return registrarEntrada({ companyRuc, ...params });
  }
  if (normalized === 'SALIDA') {
    return registrarSalida({ companyRuc, ...params });
  }

  return { error: 'tipo_invalido' };
}

module.exports = {
  toApiMovimiento,
  toApiLinea,
  findMany,
  findByCliente,
  registrarEntrada,
  registrarEntradaEnCamino,
  registrarSalida,
  registrarMovimiento,
};
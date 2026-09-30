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
    const almacenId = String(raw.almacen_id || raw.almacenId || '').trim();
    const lote = String(raw.lote || raw.numero_lote || '').trim().slice(0, 64) || null;
    const fechaRaw = String(raw.fecha_vencimiento || raw.fechaVencimiento || '').trim().slice(0, 10);
    const fechaVencimiento = /^\d{4}-\d{2}-\d{2}$/.test(fechaRaw) ? fechaRaw : null;
    const legacyIds = normalizeStringArray(raw.serie_ids || raw.serieIds);
    const legacyNumeros = normalizeStringArray(raw.series || raw.numeros_serie || raw.numerosSerie);
    const base = {
      catalogItemId,
      almacenId: almacenId || undefined,
      lote,
      fechaVencimiento,
    };

    if (productoSerieId) {
      out.push({ ...base, cantidad: cantidad || 1, productoSerieId, numeroSerie: '' });
      continue;
    }
    if (numeroSerie) {
      out.push({ ...base, cantidad: 1, productoSerieId: '', numeroSerie });
      continue;
    }
    if (legacyIds.length > 0) {
      for (const id of legacyIds) {
        out.push({ ...base, cantidad: 1, productoSerieId: id, numeroSerie: '' });
      }
      continue;
    }
    if (legacyNumeros.length > 0) {
      for (const num of legacyNumeros) {
        out.push({ ...base, cantidad: 1, productoSerieId: '', numeroSerie: num });
      }
      continue;
    }
    out.push({ ...base, cantidad, productoSerieId: '', numeroSerie: '' });
  }
  return out;
}

function toApiLinea(linea) {
  return {
    linea_id: linea.lineaId,
    id: linea.lineaId,
    catalog_item_id: linea.catalogItemId,
    nombre: linea.nombre,
    codigo: linea.codigo,
    descripcion: linea.descripcion,
    unidad: linea.unidad,
    precio_unitario: linea.precioUnitario != null ? toNumber(linea.precioUnitario) : null,
    afectacion_igv: linea.afectacionIgv,
    kind: linea.kind,
    maneja_stock: linea.manejaStock,
    maneja_serie: Boolean(linea.manejaSerie || linea.catalogItem?.manejaSerie),
    cantidad: toNumber(linea.cantidad),
    almacen_id: linea.almacenId,
    producto_serie_id: linea.productoSerieId,
    producto_serie: linea.productoSerie ? productoSerieModel.toApi(linea.productoSerie) : null,
    lote: linea.lote || null,
    fecha_vencimiento: linea.fechaVencimiento || null,
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

function toApiUsuario(usuario) {
  if (!usuario) return undefined;
  const email = String(usuario.email || '').trim();
  if (!email) return undefined;
  const local = email.split('@')[0] || email;
  const nombre = local
    .replace(/[._-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
  return {
    id: usuario.id,
    email,
    nombre: nombre || email,
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
    usuario_id: row.usuarioId ?? undefined,
    usuario: toApiUsuario(row.usuario),
    lineas: (row.lineas || []).map(toApiLinea),
  };
}

const movimientoInclude = {
  lineas: {
    include: {
      productoSerie: true,
      catalogItem: { select: { id: true, manejaSerie: true } },
    },
    orderBy: { lineaId: 'asc' },
  },
  cliente: {
    select: { tipoDoc: true, numeroDoc: true, razonSocial: true },
  },
  usuario: {
    select: { id: true, email: true },
  },
};
function snapshotLineaFromItem(item, { almacenId, cantidad, productoSerieId, lote, fechaVencimiento }) {
  const fecha = String(fechaVencimiento || '').trim().slice(0, 10);
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
    lote: String(lote || '').trim().slice(0, 64) || null,
    fechaVencimiento: /^\d{4}-\d{2}-\d{2}$/.test(fecha) ? fecha : null,
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
  return `SAL-${String(count + 1).padStart(4, '0')}`;
}

function buildMovimientoWhere({
  companyRuc,
  tipo = null,
  almacenId = null,
  usuarioId = null,
  referenciaTipo = null,
  soloTraslado = false,
  sinGuia = false,
}) {
  const where = { companyRuc };
  if (tipo) where.tipo = tipo;
  if (almacenId) {
    where.AND = [
      ...(where.AND || []),
      { OR: [{ almacenId }, { almacenDestinoId: almacenId }] },
    ];
  }
  if (usuarioId != null && Number.isFinite(Number(usuarioId))) {
    where.usuarioId = Number(usuarioId);
  }
  if (referenciaTipo) where.referenciaTipo = String(referenciaTipo).trim();
  if (soloTraslado) {
    where.OR = [
      { referenciaTipo: 'TRASLADO' },
      { almacenDestinoId: { not: null } },
    ];
  }
  if (sinGuia) {
    where.guiaRemisionId = null;
  }
  return where;
}

async function findById(id, companyRuc) {
  const movimientoId = String(id || '').trim();
  const ruc = String(companyRuc || '').trim();
  if (!movimientoId || !ruc) return null;
  const row = await prisma.movimiento.findFirst({
    where: { id: movimientoId, companyRuc: ruc },
    include: movimientoInclude,
  });
  return toApiMovimiento(row);
}

async function findMany({
  companyRuc,
  tipo = null,
  almacenId = null,
  usuarioId = null,
  referenciaTipo = null,
  soloTraslado = false,
  sinGuia = false,
  skip = null,
  take = null,
}) {
  const where = buildMovimientoWhere({
    companyRuc,
    tipo,
    almacenId,
    usuarioId,
    referenciaTipo,
    soloTraslado,
    sinGuia,
  });
  const paginated = Number.isFinite(skip) && Number.isFinite(take);

  if (!paginated) {
    const rows = await prisma.movimiento.findMany({
      where,
      include: movimientoInclude,
      orderBy: { fecha: 'desc' },
    });
    rows.sort((a, b) => compareStoredTimestamps(b.fecha, a.fecha));
    return rows.map(toApiMovimiento);
  }

  const [total, rows] = await Promise.all([
    prisma.movimiento.count({ where }),
    prisma.movimiento.findMany({
      where,
      include: movimientoInclude,
      orderBy: { fecha: 'desc' },
      skip,
      take,
    }),
  ]);

  const items = rows
    .slice()
    .sort((a, b) => compareStoredTimestamps(b.fecha, a.fecha))
    .map(toApiMovimiento);

  return { items, total };
}

/** Entregas (salida a cliente) y devoluciones registradas para un cliente. */
async function findByCliente({
  companyRuc,
  clienteId,
  almacenId = null,
  skip = null,
  take = null,
}) {
  const id = (clienteId || '').trim();
  if (!id) {
    return Number.isFinite(skip) && Number.isFinite(take)
      ? { items: [], total: 0 }
      : [];
  }

  const where = {
    companyRuc,
    clienteId: id,
    OR: [
      { tipo: 'SALIDA', almacenDestinoId: null },
      { tipo: 'ENTRADA', referenciaTipo: 'DEVOLUCION_CLIENTE' },
    ],
  };
  if (almacenId) where.almacenId = almacenId;

  const paginated = Number.isFinite(skip) && Number.isFinite(take);
  if (!paginated) {
    const rows = await prisma.movimiento.findMany({
      where,
      include: movimientoInclude,
      orderBy: { fecha: 'desc' },
    });
    rows.sort((a, b) => compareStoredTimestamps(b.fecha, a.fecha));
    return rows.map(toApiMovimiento);
  }

  const [total, rows] = await Promise.all([
    prisma.movimiento.count({ where }),
    prisma.movimiento.findMany({
      where,
      include: movimientoInclude,
      orderBy: { fecha: 'desc' },
      skip,
      take,
    }),
  ]);

  const items = rows
    .slice()
    .sort((a, b) => compareStoredTimestamps(b.fecha, a.fecha))
    .map(toApiMovimiento);

  return { items, total };
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
  usuarioId = null,
}) {
  const almacen = await prisma.almacen.findFirst({
    where: { id: almacenId, companyRuc },
  });
  if (!almacen) return { error: 'almacen_not_found' };

  let resolvedClienteId = null;
  let esDevolucion = false;
  const refTipoNorm = String(referenciaTipo || '').trim().toUpperCase();
  const esRegresoSalida = refTipoNorm === 'REGRESO_SALIDA';
  const ingresoDesdeCliente = refTipoNorm === 'INGRESO_CLIENTE';

  const quiereDevolucion = !ingresoDesdeCliente && Boolean(
    (clienteId || '').trim() || (cliente && typeof cliente === 'object'),
  );

  if (quiereDevolucion || ingresoDesdeCliente) {
    const resolved = await clienteModel.resolveForSalida({
      companyRuc,
      clienteId,
      clienteBody: cliente,
    });
    if (resolved.error) return { error: resolved.error };
    if (!resolved.clienteId) return { error: 'cliente_requerido' };
    resolvedClienteId = resolved.clienteId;
    esDevolucion = quiereDevolucion;
  }

  const esRegreso = esDevolucion || esRegresoSalida;

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
  if (esRegreso) {
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
  if (!esRegreso) {
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
          if (!esRegreso) {
            const serieId = serieIdByNumero.get(linea.numeroSerie);
            lineasCreate.push(snapshotLineaFromItem(
              { ...item, manejaSerie: true, manejaStock: true },
              { almacenId, cantidad: 1, productoSerieId: serieId, lote: linea.lote, fechaVencimiento: linea.fechaVencimiento },
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
              },
            });
          } else {
            serie = await tx.productoSerie.findFirst({
              where: { companyRuc, numeroSerie: linea.numeroSerie, catalogItemId: item.id },
            });
          }
          if (serie?.estado === 'DISPONIBLE') {
            // Ya está en almacén (nunca salió o ya se devolvió antes).
            continue;
          }
          if (serie && serie.estado !== 'ENTREGADO') serie = null;
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

          if (esDevolucion) {
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
          } else if (String(serie.entregaId) !== String(referenciaId || '').trim()) {
            const err = new Error(`La serie ${serie.numeroSerie} no pertenece a esta salida`);
            err.code = 'serie_no_de_salida';
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
            lote: linea.lote,
            fechaVencimiento: linea.fechaVencimiento,
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
              lote: linea.lote,
              fechaVencimiento: linea.fechaVencimiento,
            }),
          );
        } else {
          lineasCreate.push(
            snapshotLineaFromItem(item, {
              almacenId: almacenId,
              cantidad: linea.cantidad,
              lote: linea.lote,
              fechaVencimiento: linea.fechaVencimiento,
            }),
          );
        }
      }

      if (esRegreso && lineasCreate.length === 0) {
        const err = new Error('Nada por regresar');
        err.code = 'nada_por_regresar';
        throw err;
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
            : (ingresoDesdeCliente
              ? 'INGRESO_CLIENTE'
              : (String(referenciaTipo || '').trim() || 'INGRESO_MANUAL')),
          referenciaId: (() => {
            const id = String(
              referenciaId || (esDevolucion ? comprobanteId : '') || '',
            ).trim();
            return id || null;
          })(),
          comprobanteId: (() => {
            const id = String(comprobanteId || '').trim();
            return id || null;
          })(),
          numero,
          estado: 'DESPACHADA',
          clienteId: resolvedClienteId,
          usuarioId: usuarioId ?? null,
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
    if (err.code === 'serie_no_de_salida') {
      return { error: 'serie_no_de_salida', numeroSerie: err.numeroSerie };
    }
    if (err.code === 'nada_por_regresar') {
      return { error: 'nada_por_regresar' };
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
    && (
      refTipo === 'COMPRA'
      || refTipo === 'COMPRA_EN_CAMINO'
      || refTipo === 'COMPRA_REGISTRADA'
      || refTipo === 'COMPRA_RECIBIDA'
    )
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
  usuarioId = null,
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
          lote: linea.lote,
          fechaVencimiento: linea.fechaVencimiento,
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
          usuarioId: usuarioId ?? null,
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
  const almLinea = String(linea.almacenId || almacenId || '').trim() || null;

  if (linea.productoSerieId) {
    const baseWhere = {
      id: linea.productoSerieId,
      companyRuc,
      catalogItemId,
      estado: 'DISPONIBLE',
    };
    let serie = null;
    if (almLinea) {
      serie = await tx.productoSerie.findFirst({
        where: { ...baseWhere, almacenId: almLinea },
      });
    }
    // Fallback: la serie puede estar en el almacén propio aunque el header del CPE difiera.
    if (!serie) {
      serie = await tx.productoSerie.findFirst({ where: baseWhere });
    }
    if (!serie) {
      const existente = await tx.productoSerie.findFirst({
        where: { id: linea.productoSerieId, companyRuc },
        select: { numeroSerie: true, estado: true, almacenId: true },
      });
      const err = new Error('Serie no disponible en el almacén');
      err.code = 'series_no_disponibles';
      err.numeroSerie = existente?.numeroSerie || undefined;
      throw err;
    }
    return serie;
  }

  if (linea.numeroSerie) {
    const baseWhere = {
      companyRuc,
      catalogItemId,
      numeroSerie: linea.numeroSerie,
      estado: 'DISPONIBLE',
    };
    let serie = null;
    if (almLinea) {
      serie = await tx.productoSerie.findFirst({
        where: { ...baseWhere, almacenId: almLinea },
      });
    }
    if (!serie) {
      serie = await tx.productoSerie.findFirst({ where: baseWhere });
    }
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
  usuarioId = null,
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
      const almStock = String(linea.almacenId || almacenId || '').trim() || almacenId;
      const actual = await inventarioModel.getCantidadEnAlmacen(linea.catalogItemId, almStock);
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
        const almLinea = String(linea.almacenId || almacenId || '').trim() || almacenId;

        if (usaSeries) {
          const serie = await resolverSerieSalida(tx, {
            companyRuc,
            almacenId: almLinea,
            catalogItemId: item.id,
            linea,
          });
          const almSerie = serie.almacenId || almLinea;

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
            almacenId: almSerie,
            cantidad: 1,
            productoSerieId: serie.id,
            lote: linea.lote,
            fechaVencimiento: linea.fechaVencimiento,
          }));
        } else if (usaInventarioCantidad(item, linea)) {
          const key = inventarioModel.saldoKey(item.id, almLinea);
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

          lineasCreate.push(snapshotLineaFromItem(item, {
            almacenId: almLinea,
            cantidad: linea.cantidad,
            lote: linea.lote,
            fechaVencimiento: linea.fechaVencimiento,
          }));
        } else {
          lineasCreate.push(snapshotLineaFromItem(item, {
            almacenId: almLinea,
            cantidad: linea.cantidad,
            lote: linea.lote,
            fechaVencimiento: linea.fechaVencimiento,
          }));
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
          referenciaTipo: esTraslado
            ? 'TRASLADO'
            : (comprobanteId ? 'VENTA' : (guiaRemisionId ? 'GUIA_REMISION' : 'SALIDA_MANUAL')),
          numero,
          estado: 'DESPACHADA',
          comprobanteId: comprobanteId || null,
          guiaRemisionId: guiaRemisionId || null,
          fechaDespacho: fecha,
          clienteId: esTraslado ? null : resolvedClienteId,
          usuarioId: usuarioId != null && Number.isFinite(Number(usuarioId))
            ? Number(usuarioId)
            : null,
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

async function vincularGuiaRemision({ companyRuc, movimientoIds = [], guiaRemisionId }) {
  const ruc = String(companyRuc || '').trim();
  const guiaId = String(guiaRemisionId || '').trim();
  const ids = [...new Set((movimientoIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
  if (!ruc || !guiaId || !ids.length) {
    return { vinculados: 0 };
  }

  const result = await prisma.movimiento.updateMany({
    where: {
      companyRuc: ruc,
      id: { in: ids },
      tipo: 'SALIDA',
      OR: [
        { referenciaTipo: 'TRASLADO' },
        { almacenDestinoId: { not: null } },
      ],
    },
    data: {
      guiaRemisionId: guiaId,
      referenciaTipo: 'TRASLADO',
    },
  });

  return { vinculados: result.count };
}

/**
 * Revierte una SALIDA creando un ENTRADA (devolución / regreso a almacén).
 * Restaura series ENTREGADO → DISPONIBLE y suma stock por cantidad.
 */
async function regresarSalida({
  companyRuc,
  salidaId,
  usuarioId = null,
  observaciones = null,
  almacenId = null,
}) {
  const id = String(salidaId || '').trim();
  if (!id) return { error: 'not_found' };

  const salida = await prisma.movimiento.findFirst({
    where: { id, companyRuc },
    include: {
      lineas: {
        include: {
          productoSerie: { select: { id: true, numeroSerie: true, estado: true } },
        },
        orderBy: { lineaId: 'asc' },
      },
    },
  });
  if (!salida) return { error: 'not_found' };
  if (salida.tipo !== 'SALIDA') return { error: 'no_es_salida' };
  if (String(salida.estado || '').toUpperCase() === 'ANULADA') {
    return { error: 'anulada' };
  }
  if (salida.almacenDestinoId) return { error: 'es_traslado' };
  if (!salida.almacenId) return { error: 'almacen_not_found' };

  const destinoId = String(almacenId || salida.almacenId || '').trim();
  if (!destinoId) return { error: 'almacen_not_found' };

  const destino = await prisma.almacen.findFirst({
    where: { id: destinoId, companyRuc },
    select: { id: true, activo: true },
  });
  if (!destino) return { error: 'almacen_not_found' };
  if (destino.activo === false) return { error: 'almacen_inactivo' };

  const ya = await prisma.movimiento.findFirst({
    where: {
      companyRuc,
      tipo: 'ENTRADA',
      estado: { not: 'ANULADA' },
      referenciaId: salida.id,
      referenciaTipo: { in: ['DEVOLUCION_CLIENTE', 'REGRESO_SALIDA'] },
    },
    select: { id: true, numero: true },
  });
  if (ya) {
    return {
      error: 'ya_regresado',
      movimientoId: ya.id,
      numero: ya.numero,
    };
  }

  const lineas = [];
  for (const l of salida.lineas || []) {
    const catalogItemId = l.catalogItemId;
    if (!catalogItemId) continue;
    if (l.productoSerieId) {
      lineas.push({
        catalogItemId,
        cantidad: 1,
        productoSerieId: l.productoSerieId,
        numeroSerie: l.productoSerie?.numeroSerie || undefined,
        almacenId: destinoId,
        lote: l.lote || undefined,
        fechaVencimiento: l.fechaVencimiento || undefined,
      });
      continue;
    }
    const cantidad = toNumber(l.cantidad);
    if (cantidad <= 0) continue;
    lineas.push({
      catalogItemId,
      cantidad,
      almacenId: destinoId,
      lote: l.lote || undefined,
      fechaVencimiento: l.fechaVencimiento || undefined,
    });
  }
  if (!lineas.length) return { error: 'lineas_vacias' };

  const numeroSalida = salida.numero || salida.id;
  const obs = String(observaciones || '').trim()
    || `Regreso de salida ${numeroSalida}`;

  return registrarEntrada({
    companyRuc,
    almacenId: destinoId,
    lineas,
    clienteId: salida.clienteId || null,
    referenciaTipo: salida.clienteId ? 'DEVOLUCION_CLIENTE' : 'REGRESO_SALIDA',
    referenciaId: salida.id,
    observaciones: obs,
    usuarioId,
  });
}

module.exports = {
  toApiMovimiento,
  toApiLinea,
  findById,
  findMany,
  findByCliente,
  registrarEntrada,
  registrarEntradaEnCamino,
  registrarSalida,
  registrarMovimiento,
  regresarSalida,
  vincularGuiaRemision,
};
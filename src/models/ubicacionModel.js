const prisma = require('../config/prisma');
const { toApiTimestamp } = require('../utils/fechas');

function toNumber(value) {
  if (value == null) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeStringArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim()).filter(Boolean);
  }
  return [];
}

function clienteFromRow(cliente) {
  if (!cliente) return null;
  return {
    tipo_doc: cliente.tipoDoc,
    numero_doc: cliente.numeroDoc,
    razon_social: cliente.razonSocial,
  };
}

function clienteFromInvoice(invoice) {
  if (!invoice?.cliente) return null;
  return clienteFromRow(invoice.cliente);
}

function resolveOrigenDestino(mov) {
  if (mov.tipo === 'ENTRADA') {
    const clienteOrigen = clienteFromRow(mov.cliente);
    const origenNombre = clienteOrigen
      ? clienteOrigen.razon_social?.trim() || `Doc. ${clienteOrigen.numero_doc}`
      : 'Recepción externa';
    return {
      origenNombre,
      destinoNombre: mov.almacen?.nombre || 'Almacén',
      esTraslado: false,
    };
  }

  const origenNombre = mov.almacen?.nombre || 'Almacén';

  if (mov.almacenDestinoId) {
    return {
      origenNombre,
      destinoNombre: mov.almacenDestino?.nombre || 'Almacén destino',
      esTraslado: true,
    };
  }

  const cliente =
    clienteFromRow(mov.cliente) || clienteFromInvoice(mov.comprobante);

  const destinoNombre =
    cliente?.razon_social?.trim() ||
    (cliente?.numero_doc ? `Doc. ${cliente.numero_doc}` : null) ||
    'Cliente';

  return {
    origenNombre,
    destinoNombre,
    esTraslado: false,
  };
}

function extractSeriesFromLinea(linea) {
  const numero = linea.productoSerie?.numeroSerie;
  return numero ? [numero] : [];
}

function expandLineaToItems(linea, { serieFilter = null } = {}) {
  const mov = linea.movimiento;
  if (!mov) return [];

  const { origenNombre, destinoNombre, esTraslado } = resolveOrigenDestino(mov);
  const nombreProducto =
    linea.nombre || linea.catalogItem?.nombre || linea.catalogItemId || 'Producto';
  const unidad = linea.unidad || linea.catalogItem?.unidad || 'NIU';
  const fecha = toApiTimestamp(mov.fechaDespacho || mov.fecha);
  const base = {
    lineaId: linea.lineaId,
    movimientoId: mov.id,
    movimientoNumero: mov.numero,
    tipoMovimiento: mov.tipo,
    referenciaTipo: mov.referenciaTipo || null,
    observaciones: mov.observaciones || null,
    esTraslado,
    fecha,
    catalogItemId: linea.catalogItemId,
    catalogItemNombre: nombreProducto,
    catalogItemCodigo: linea.codigo || linea.catalogItem?.codigo || null,
    unidad,
    origenNombre,
    destinoNombre,
    usuarioNombre: mov.usuario?.email
      ? String(mov.usuario.email).split('@')[0].replace(/[._-]+/g, ' ')
      : null,
    usuarioEmail: mov.usuario?.email || null,
  };

  let numeros = extractSeriesFromLinea(linea);
  if (serieFilter) {
    const ql = serieFilter.toLowerCase();
    numeros = numeros.filter((n) => n.toLowerCase().includes(ql));
    if (numeros.length === 0) return [];
  }

  if (numeros.length > 0) {
    return numeros.map((numeroSerie) =>
      toApiHistorialItem({
        ...base,
        id: `${linea.lineaId}:${numeroSerie}`,
        numeroSerie,
        cantidad: 1,
      }),
    );
  }

  if (serieFilter) return [];

  return [
    toApiHistorialItem({
      ...base,
      id: linea.lineaId,
      numeroSerie: linea.productoSerie?.numeroSerie || null,
      cantidad: toNumber(linea.cantidad) || 1,
    }),
  ];
}

function toApiHistorialItem(row) {
  return {
    id: row.id,
    linea_id: row.lineaId,
    movimiento_id: row.movimientoId,
    movimiento_numero: row.movimientoNumero,
    tipo_movimiento: row.tipoMovimiento,
    referencia_tipo: row.referenciaTipo || null,
    observaciones: row.observaciones || null,
    es_traslado: row.esTraslado,
    fecha: row.fecha,
    catalog_item_id: row.catalogItemId,
    catalog_item_nombre: row.catalogItemNombre,
    catalog_item_codigo: row.catalogItemCodigo || null,
    numero_serie: row.numeroSerie,
    cantidad: row.cantidad,
    unidad: row.unidad,
    origen_nombre: row.origenNombre,
    destino_nombre: row.destinoNombre,
    usuario_nombre: row.usuarioNombre || null,
    usuario_email: row.usuarioEmail || null,
  };
}

const lineaInclude = {
  catalogItem: { select: { id: true, nombre: true, unidad: true, codigo: true } },
  productoSerie: { select: { id: true, numeroSerie: true } },
  movimiento: {
    include: {
      almacen: { select: { id: true, nombre: true, codigo: true } },
      almacenDestino: { select: { id: true, nombre: true, codigo: true } },
      comprobante: {
        include: {
          cliente: { select: { tipoDoc: true, numeroDoc: true, razonSocial: true } },
        },
      },
      cliente: { select: { tipoDoc: true, numeroDoc: true, razonSocial: true } },
      usuario: { select: { id: true, email: true } },
    },
  },
};

function buildMovimientoScope(companyRuc, almacenId) {
  const scope = { companyRuc };
  if (almacenId) {
    scope.OR = [{ almacenId }, { almacenDestinoId: almacenId }];
  }
  return scope;
}

async function loadLineas({ companyRuc, whereExtra, almacenId, take = 200 }) {
  return prisma.lineaCatalogoItem.findMany({
    where: {
      ...whereExtra,
      movimiento: buildMovimientoScope(companyRuc, almacenId),
    },
    include: lineaInclude,
    orderBy: { movimiento: { fecha: 'desc' } },
    take,
  });
}

function flattenAndSort(lineas, options = {}) {
  const items = lineas.flatMap((linea) => expandLineaToItems(linea, options));
  items.sort((a, b) => (b.fecha ?? 0) - (a.fecha ?? 0));
  return items;
}

async function buscarPorSerie({
  companyRuc,
  q,
  almacenId,
  catalogItemId = null,
  limit = 50,
  orden = 'asc',
}) {
  const qTrim = String(q || '').trim();
  const itemId = String(catalogItemId || '').trim() || null;
  if (qTrim.length < 2 && !itemId) return { items: [], series: [] };

  const serieWhere = {
    companyRuc,
    ...(itemId ? { catalogItemId: itemId } : {}),
    ...(qTrim.length >= 2 ? { numeroSerie: { contains: qTrim } } : {}),
  };

  const series = await prisma.productoSerie.findMany({
    where: serieWhere,
    include: {
      catalogItem: { select: { id: true, nombre: true, codigo: true } },
      almacen: { select: { id: true, nombre: true } },
    },
    take: qTrim.length >= 2 ? 30 : 80,
    orderBy: { numeroSerie: 'asc' },
  });

  const serieIds = series.map((s) => s.id);
  if (!serieIds.length && qTrim.length < 2) {
    return { items: [], series: [] };
  }

  // Solo listar series del producto (sin timeline hasta elegir nº de serie).
  if (!qTrim && itemId) {
    return { items: [], series: series.map(mapSerieMeta) };
  }

  const orFilters = [];
  if (serieIds.length > 0) {
    orFilters.push({ productoSerieId: { in: serieIds } });
  }
  if (qTrim.length >= 2) {
    orFilters.push({
      productoSerie: {
        companyRuc,
        numeroSerie: { contains: qTrim },
        ...(itemId ? { catalogItemId: itemId } : {}),
      },
    });
  }
  if (!orFilters.length) {
    return {
      items: [],
      series: series.map(mapSerieMeta),
    };
  }

  const lineas = await loadLineas({
    companyRuc,
    almacenId,
    whereExtra: {
      OR: orFilters,
      ...(itemId ? { catalogItemId: itemId } : {}),
    },
    take: 300,
  });

  let items = flattenAndSort(lineas, { serieFilter: qTrim.length >= 2 ? qTrim : null });
  if (orden === 'asc') {
    items = items.slice().sort((a, b) => (a.fecha ?? 0) - (b.fecha ?? 0));
  } else {
    items = items.slice().sort((a, b) => (b.fecha ?? 0) - (a.fecha ?? 0));
  }
  items = items.slice(0, limit);

  return {
    items,
    series: series.map(mapSerieMeta),
  };
}

function mapSerieMeta(s) {
  return {
    id: s.id,
    numero_serie: s.numeroSerie,
    estado: s.estado,
    catalog_item_id: s.catalogItemId,
    catalog_item_nombre: s.catalogItem?.nombre || 'Producto',
    catalog_item_codigo: s.catalogItem?.codigo || '',
    almacen_id: s.almacenId || null,
    almacen_nombre: s.almacen?.nombre || null,
  };
}

/** Movimientos recientes de un almacén (origen o destino), sin producto. */
async function historialPorAlmacen({
  companyRuc,
  almacenId = null,
  limit = 10,
}) {
  const alm = String(almacenId || '').trim();
  if (!alm) return { items: [], total: 0 };

  const where = { movimiento: buildMovimientoScope(companyRuc, alm) };
  const [total, lineas] = await Promise.all([
    prisma.lineaCatalogoItem.count({ where }),
    prisma.lineaCatalogoItem.findMany({
      where,
      include: lineaInclude,
      orderBy: { movimiento: { fecha: 'desc' } },
      take: Math.min(300, Math.max(10, limit)),
    }),
  ]);

  const items = flattenAndSort(lineas).slice(0, limit);
  return { items, total };
}

/** Movimientos de un producto (sin filtrar por serie). Más recientes primero. */
async function historialPorProducto({
  companyRuc,
  catalogItemId,
  almacenId = null,
  limit = 10,
}) {
  const itemId = String(catalogItemId || '').trim();
  if (!itemId) return { items: [], total: 0 };

  const scope = buildMovimientoScope(companyRuc, almacenId);
  const where = {
    catalogItemId: itemId,
    movimiento: scope,
  };

  const [total, lineas] = await Promise.all([
    prisma.lineaCatalogoItem.count({ where }),
    prisma.lineaCatalogoItem.findMany({
      where,
      include: lineaInclude,
      orderBy: { movimiento: { fecha: 'desc' } },
      take: Math.min(300, Math.max(10, limit)),
    }),
  ]);

  const items = flattenAndSort(lineas).slice(0, limit);
  return { items, total };
}

async function buscarPorNombre({ companyRuc, q, almacenId, limit = 50 }) {
  const items = await prisma.catalogItem.findMany({
    where: {
      companyRuc,
      OR: [{ nombre: { contains: q } }, { codigo: { contains: q } }],
    },
    select: { id: true },
    take: 30,
  });

  if (items.length === 0) return [];

  const itemIds = items.map((i) => i.id);
  const lineas = await loadLineas({
    companyRuc,
    almacenId,
    whereExtra: { catalogItemId: { in: itemIds } },
    take: 250,
  });

  return flattenAndSort(lineas).slice(0, limit);
}

module.exports = {
  buscarPorSerie,
  buscarPorNombre,
  historialPorProducto,
  historialPorAlmacen,
};

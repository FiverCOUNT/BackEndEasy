const prisma = require('../config/prisma');

function toApi(row) {
  if (!row) return null;
  return {
    id: row.id,
    company_ruc: row.companyRuc,
    catalog_item_id: row.catalogItemId,
    numero_serie: row.numeroSerie,
    almacen_id: row.almacenId,
    estado: row.estado,
    comprobante_id: row.comprobanteId,
    entrega_id: row.entregaId,
  };
}

/**
 * Series DISPONIBLE de un ítem en un almacén (stock vivo vía inventario).
 */
async function findDisponibles({ companyRuc, catalogItemId, almacenId }) {
  const rows = await prisma.productoSerie.findMany({
    where: {
      companyRuc,
      catalogItemId,
      almacenId,
      estado: 'DISPONIBLE',
      OR: [
        {
          inventario: {
            is: {
              almacenId,
              cantidad: { gt: 0 },
            },
          },
        },
        { inventario: { is: null } },
      ],
    },
    include: { inventario: true },
    orderBy: { numeroSerie: 'asc' },
  });

  const sinInventario = rows.filter((row) => !row.inventario);
  if (sinInventario.length > 0) {
    await Promise.all(
      sinInventario.map((row) =>
        prisma.inventario.create({
          data: {
            companyRuc,
            catalogItemId: row.catalogItemId,
            almacenId: row.almacenId,
            productoSerieId: row.id,
            cantidad: 1,
          },
        }),
      ),
    );
  }

  return rows.map(toApi);
}

/**
 * Series entregadas al cliente en la venta asociada a un comprobante (factura/boleta).
 * Fuente: salida de inventario vinculada al comprobante y, en respaldo, series en sale_details.
 */
async function findEntregadasPorComprobante(companyRuc, comprobanteId) {
  const invoice = await prisma.invoice.findFirst({
    where: { id: comprobanteId, companyRuc },
    select: { id: true },
  });
  if (!invoice) return { error: 'comprobante_not_found' };

  const byItem = new Map();

  const addSerie = (serie) => {
    if (!serie?.catalogItemId) return;
    if (!byItem.has(serie.catalogItemId)) {
      byItem.set(serie.catalogItemId, []);
    }
    const list = byItem.get(serie.catalogItemId);
    if (!list.some((row) => row.id === serie.id)) {
      list.push(serie);
    }
  };

  const salida = await prisma.movimiento.findFirst({
    where: { companyRuc, comprobanteId, tipo: 'SALIDA' },
    select: { id: true },
  });

  if (salida) {
    const series = await prisma.productoSerie.findMany({
      where: {
        companyRuc,
        entregaId: salida.id,
        estado: 'ENTREGADO',
      },
      orderBy: { numeroSerie: 'asc' },
    });
    series.forEach(addSerie);
  }

  const details = await prisma.saleDetail.findMany({
    where: {
      invoiceId: comprobanteId,
      productoSerieId: { not: null },
    },
    include: { productoSerie: true },
  });
  for (const detail of details) {
    if (detail.productoSerie) addSerie(detail.productoSerie);
  }

  const items = [...byItem.entries()]
    .map(([catalogItemId, series]) => ({
      catalog_item_id: catalogItemId,
      series: series.map(toApi),
    }))
    .sort((a, b) => a.catalog_item_id.localeCompare(b.catalog_item_id));

  return { items };
}

/**
 * Series de un ítem (todas o filtradas por estado/búsqueda).
 */
async function findByCatalogItem({
  companyRuc,
  catalogItemId,
  q = '',
  estado = '',
  almacenId = null,
  take = 500,
} = {}) {
  const query = String(q || '').trim();
  const estadoNorm = String(estado || '').trim().toUpperCase();
  const rows = await prisma.productoSerie.findMany({
    where: {
      companyRuc: String(companyRuc || '').trim(),
      catalogItemId: String(catalogItemId || '').trim(),
      ...(estadoNorm ? { estado: estadoNorm } : {}),
      ...(almacenId ? { almacenId: String(almacenId).trim() } : {}),
      ...(query ? { numeroSerie: { contains: query } } : {}),
    },
    include: {
      almacen: { select: { id: true, nombre: true, codigo: true } },
    },
    orderBy: [{ estado: 'asc' }, { numeroSerie: 'asc' }],
    take: Math.min(1000, Math.max(1, Number(take) || 500)),
  });
  return rows.map((row) => ({
    ...toApi(row),
    almacen_nombre: row.almacen?.nombre || null,
    almacen_codigo: row.almacen?.codigo || null,
  }));
}

/**
 * Una serie por código de barras, en cualquier producto de la empresa.
 * salida/venta/orden: debe estar DISPONIBLE en el almacén.
 * entrada: una serie ENTREGADO para devolverla a ese almacén.
 */
async function findPorCodigo({ companyRuc, codigo, almacenId, uso }) {
  const numero = String(codigo || '').trim();
  if (!numero) return { error: 'vacio' };
  const row = await prisma.productoSerie.findFirst({
    where: {
      companyRuc: String(companyRuc || '').trim(),
      numeroSerie: numero,
    },
    include: {
      catalogItem: {
        select: {
          id: true,
          nombre: true,
          unidad: true,
          precioUnitario: true,
          manejaSerie: true,
          manejaStock: true,
          codigo: true,
          kind: true,
          activo: true,
        },
      },
      almacen: { select: { id: true, nombre: true } },
    },
  });
  if (!row || !row.catalogItem || row.catalogItem.activo === false) {
    return { error: 'no_encontrada' };
  }

  const pideDisponible = uso !== 'entrada';
  if (pideDisponible) {
    if (almacenId && row.almacenId !== almacenId) {
      return { error: 'otro_almacen', almacen_nombre: row.almacen?.nombre || '' };
    }
    if (row.estado !== 'DISPONIBLE') return { error: 'no_disponible' };
  } else if (row.estado === 'DISPONIBLE' && (!almacenId || row.almacenId === almacenId)) {
    return { error: 'ya_en_almacen' };
  } else if (row.estado !== 'ENTREGADO') {
    return { error: 'no_encontrada' };
  } else if (almacenId && row.almacenId && row.almacenId !== almacenId) {
    return { error: 'otro_almacen', almacen_nombre: row.almacen?.nombre || '' };
  }

  return { row };
}

module.exports = {
  toApi,
  findDisponibles,
  findByCatalogItem,
  findEntregadasPorComprobante,
  findPorCodigo,
};

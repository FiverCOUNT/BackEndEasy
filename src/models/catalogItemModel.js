const { randomUUID } = require('crypto');
const prisma = require('../config/prisma');
const inventarioModel = require('./inventarioModel');

const KINDS = ['PRODUCT', 'SERVICE'];

function unidadPermiteSerie(unidad) {
  return String(unidad || 'NIU').toUpperCase() === 'NIU';
}

function usaSeriesInventario(item) {
  return Boolean(item?.manejaSerie && unidadPermiteSerie(item.unidad));
}

function toNumber(value) {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toApi(item) {
  if (!item) return null;
  return {
    id: item.id,
    company_ruc: item.companyRuc,
    kind: item.kind,
    codigo: item.codigo,
    codigo_sunat: item.codigoSunat,
    nombre: item.nombre,
    descripcion: item.descripcion,
    unidad: item.unidad,
    precio_unitario: toNumber(item.precioUnitario) ?? 0,
    afectacion_igv: item.afectacionIgv,
    activo: item.activo !== false,
    maneja_stock: Boolean(item.manejaStock),
    maneja_serie: Boolean(item.manejaSerie),
    stock_actual: toNumber(item.stockActual),
    duracion_minutos: item.duracionMinutos,
  };
}

function toPublic(item) {
  const api = toApi(item);
  if (!api) return null;
  return {
    ...api,
    companyRuc: api.company_ruc,
    codigoSunat: api.codigo_sunat,
    precioUnitario: api.precio_unitario,
    afectacionIgv: api.afectacion_igv,
    manejaStock: api.maneja_stock,
    manejaSerie: api.maneja_serie,
    stockActual: api.stock_actual,
    duracionMinutos: api.duracion_minutos,
  };
}

function buildSearchWhere({ q = '', kind = '', companyRuc = '' } = {}) {
  const where = {};

  if (companyRuc) {
    where.companyRuc = companyRuc;
  }

  if (kind && KINDS.includes(kind)) {
    where.kind = kind;
  }

  const term = (q || '').trim();
  if (term) {
    where.OR = [
      { nombre: { contains: term } },
      { codigo: { contains: term } },
      { codigoSunat: { contains: term } },
      { descripcion: { contains: term } },
      { companyRuc: { contains: term } },
      { unidad: { contains: term } },
    ];
  }

  return where;
}

function parseBool(value, defaultValue = true) {
  if (value === undefined || value === null || value === '') return defaultValue;
  if (value === false || value === 'false' || value === 'off') return false;
  return value === 'on' || value === 'true' || value === true;
}

function parseBody(body) {
  const kind = (body.kind || 'PRODUCT').toUpperCase();
  const isProduct = kind === 'PRODUCT';

  return {
    companyRuc: (body.companyRuc || body.company_ruc || '').trim(),
    kind: KINDS.includes(kind) ? kind : 'PRODUCT',
    codigo: (body.codigo || '').trim() || null,
    codigoSunat: (body.codigoSunat || body.codigo_sunat || '').trim().slice(0, 32) || null,
    nombre: (body.nombre || '').trim(),
    descripcion: (body.descripcion || '').trim() || null,
    unidad: (body.unidad || (isProduct ? 'NIU' : 'ZZ')).trim(),
    precioUnitario: toNumber(body.precioUnitario ?? body.precio_unitario) ?? 0,
    afectacionIgv: (body.afectacionIgv || body.afectacion_igv || '10').trim(),
    activo: parseBool(body.activo, true),
    manejaStock:
      body.manejaStock === false || body.maneja_stock === false
        ? false
        : body.manejaStock === 'on' ||
          body.manejaStock === 'true' ||
          body.maneja_stock === true ||
          isProduct,
    manejaSerie:
      body.manejaSerie === 'on' ||
      body.manejaSerie === 'true' ||
      body.maneja_serie === true,
    stockActual: toNumber(body.stockActual ?? body.stock_actual),
    duracionMinutos:
      body.duracionMinutos != null || body.duracion_minutos != null
        ? parseInt(body.duracionMinutos ?? body.duracion_minutos, 10) || null
        : isProduct
          ? null
          : 60,
  };
}

async function enrichStock(items, almacenId = null, { format = 'api' } = {}) {
  return Promise.all(
    items.map(async (item) => {
      const base = format === 'public' ? toPublic(item) : toApi(item);
      const stockKey = format === 'public' ? 'stockActual' : 'stock_actual';

      if (item.kind === 'SERVICE' || (!item.manejaStock && !item.manejaSerie)) {
        base[stockKey] = null;
        return base;
      }

      const qty = almacenId
        ? await inventarioModel.getCantidadEnAlmacen(item.id, almacenId, {
            manejaSerie: item.manejaSerie,
          })
        : await inventarioModel.getCantidadTotal(item.id, {
            manejaSerie: item.manejaSerie,
          });

      base[stockKey] = qty;
      if (format === 'public') {
        base.stock_actual = qty;
      } else {
        base.stockActual = qty;
      }

      return base;
    }),
  );
}

async function findPaginated({ q = '', kind = '', companyRuc = '', page = 1, pageSize = 25, skip = 0 }) {
  const where = buildSearchWhere({ q, kind, companyRuc });

  const [total, rows] = await Promise.all([
    prisma.catalogItem.count({ where }),
    prisma.catalogItem.findMany({
      where,
      orderBy: [{ companyRuc: 'asc' }, { nombre: 'asc' }],
      skip,
      take: pageSize,
    }),
  ]);

  const items = await enrichStock(rows, null, { format: 'public' });
  return { total, items };
}

async function getItemIdsLinkedToAlmacen(companyRuc, almacenId) {
  return inventarioModel.getCatalogItemIdsEnAlmacen(companyRuc, almacenId);
}

async function findByCompanyRuc(companyRuc, { almacenId, restrictToAlmacen = false } = {}) {
  const where = { companyRuc };
  // En contexto de almacén solo productos inventariables; servicios no aplican.
  if (almacenId) {
    where.kind = 'PRODUCT';
  }

  let rows = await prisma.catalogItem.findMany({
    where,
    orderBy: { nombre: 'asc' },
  });

  if (restrictToAlmacen && almacenId) {
    const linkedIds = await getItemIdsLinkedToAlmacen(companyRuc, almacenId);
    rows = rows.filter((row) => linkedIds.has(row.id));
  }

  let items = await enrichStock(rows, almacenId);

  if (restrictToAlmacen && almacenId) {
    items = items.filter((item) => {
      const stock = item.stock_actual ?? 0;
      if (item.maneja_stock || item.maneja_serie) return stock > 0;
      return true;
    });
  }

  return items;
}

async function findById(id) {
  return prisma.catalogItem.findUnique({ where: { id } });
}

async function findByCodigo(companyRuc, codigo) {
  if (!codigo) return null;
  return prisma.catalogItem.findFirst({ where: { companyRuc, codigo } });
}

async function findByCodigoExceptId(companyRuc, codigo, id) {
  if (!codigo) return null;
  return prisma.catalogItem.findFirst({
    where: { companyRuc, codigo, NOT: { id } },
  });
}

async function create(body, id = randomUUID()) {
  const data = parseBody(body);
  let manejaSerie = data.kind === 'PRODUCT' ? data.manejaSerie : false;
  if (!unidadPermiteSerie(data.unidad)) manejaSerie = false;
  const manejaStock = data.kind === 'PRODUCT' ? data.manejaStock || manejaSerie : false;
  const row = await prisma.catalogItem.create({
    data: {
      id,
      companyRuc: data.companyRuc,
      kind: data.kind,
      codigo: data.codigo,
      codigoSunat: data.codigoSunat,
      nombre: data.nombre,
      descripcion: data.descripcion,
      unidad: data.unidad,
      precioUnitario: data.precioUnitario,
      afectacionIgv: data.afectacionIgv,
      activo: data.activo,
      manejaStock,
      manejaSerie,
      stockActual: null,
      duracionMinutos: data.kind === 'SERVICE' ? data.duracionMinutos : null,
    },
  });
  return row;
}

function normalizarNombreCatalogo(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function esUnidadServicioCatalogo(unidad) {
  const u = String(unidad || '').trim().toUpperCase();
  return !u || u === 'ZZ' || u === 'ZZZ' || u.startsWith('SERV') || u === 'SRV';
}

/** Línea de compra recibida (SIRE/XML) que no debe materializarse en catálogo/almacén. */
function esLineaServicioCompra(linea = {}) {
  const kindHint = String(linea.kind || '').trim().toUpperCase();
  return kindHint === 'SERVICE' || esUnidadServicioCatalogo(linea.unidad);
}

/**
 * Busca un ítem del catálogo del comprador para una línea de compra recibida.
 * Solo enlaza automáticamente si coincide el código SUNAT (UNSPSC).
 * No crea ítems: el nombre del proveedor puede diferir del tuyo.
 */
async function findOrCreateForCompraLinea(companyRuc, linea = {}) {
  const ruc = String(companyRuc || '').replace(/\D/g, '');
  if (ruc.length !== 11) {
    throw new Error('companyRuc inválido para catálogo de compra.');
  }

  if (esLineaServicioCompra(linea)) {
    return null;
  }

  const codigoSunat = String(linea.codigo_sunat || linea.codigoSunat || '')
    .trim()
    .replace(/\D/g, '')
    .slice(0, 32) || null;

  if (codigoSunat && /^\d{8}$/.test(codigoSunat)) {
    const bySunat = await prisma.catalogItem.findFirst({
      where: {
        companyRuc: ruc,
        kind: 'PRODUCT',
        codigoSunat,
        activo: true,
      },
    });
    if (bySunat) return bySunat;
  }

  // Sin match SUNAT: no crear ni enlazar por nombre/código interno del proveedor.
  return null;
}

async function update(id, body) {
  const data = parseBody(body);
  let manejaSerie = data.kind === 'PRODUCT' ? data.manejaSerie : false;
  if (!unidadPermiteSerie(data.unidad)) manejaSerie = false;
  const manejaStock = data.kind === 'PRODUCT' ? data.manejaStock || manejaSerie : false;
  return prisma.catalogItem.update({
    where: { id },
    data: {
      companyRuc: data.companyRuc,
      kind: data.kind,
      codigo: data.codigo,
      codigoSunat: data.codigoSunat,
      nombre: data.nombre,
      descripcion: data.descripcion,
      unidad: data.unidad,
      precioUnitario: data.precioUnitario,
      afectacionIgv: data.afectacionIgv,
      activo: data.activo,
      manejaStock,
      manejaSerie,
      stockActual: null,
      duracionMinutos: data.kind === 'SERVICE' ? data.duracionMinutos : null,
    },
  });
}

async function setActive(id, activo) {
  return prisma.catalogItem.update({
    where: { id },
    data: { activo },
  });
}

async function remove(id) {
  const item = await prisma.catalogItem.findUnique({
    where: { id },
    include: {
      _count: {
        select: {
          productoSeries: true,
          saleDetails: true,
          lineasCatalogo: true,
          inventario: true,
        },
      },
    },
  });

  if (!item) return { error: 'not_found' };

  const { productoSeries, saleDetails, lineasCatalogo, inventario } = item._count;
  if (productoSeries > 0 || saleDetails > 0 || lineasCatalogo > 0 || inventario > 0) {
    return { error: 'has_relations' };
  }

  await prisma.catalogItem.delete({ where: { id } });
  return { ok: true };
}

module.exports = {
  KINDS,
  toApi,
  toPublic,
  parseBody,
  findPaginated,
  findByCompanyRuc,
  findById,
  findByCodigo,
  findByCodigoExceptId,
  findOrCreateForCompraLinea,
  esLineaServicioCompra,
  esUnidadServicioCatalogo,
  create,
  update,
  setActive,
  remove,
};

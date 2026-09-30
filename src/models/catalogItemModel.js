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
    precio_compra: toNumber(item.precioCompra),
    fecha_vencimiento: item.fechaVencimiento || null,
    lote: item.lote || null,
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
    precioCompra: api.precio_compra,
    fechaVencimiento: api.fecha_vencimiento,
    lote: api.lote,
    afectacionIgv: api.afectacion_igv,
    manejaStock: api.maneja_stock,
    manejaSerie: api.maneja_serie,
    stockActual: api.stock_actual,
    duracionMinutos: api.duracion_minutos,
  };
}

function buildSearchWhere({ q = '', kind = '', companyRuc = '', soloActivos = false } = {}) {
  const where = {};

  if (companyRuc) {
    where.companyRuc = companyRuc;
  }

  if (kind && KINDS.includes(kind)) {
    where.kind = kind;
  }

  if (soloActivos) {
    where.activo = true;
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

function parsePrecioOpcional(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = toNumber(value);
  if (n == null || n < 0) return null;
  return n;
}

function parseLote(body) {
  if (body.lote === undefined) return undefined;
  const s = String(body.lote ?? '').trim().slice(0, 64);
  return s || null;
}

function parseFecha(value) {
  const s = String(value ?? '').trim().slice(0, 10);
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map((n) => Number(n));
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return s;
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
    precioCompra: parsePrecioOpcional(body.precioCompra ?? body.precio_compra),
    fechaVencimiento: isProduct
      ? parseFecha(body.fechaVencimiento ?? body.fecha_vencimiento)
      : null,
    lote: isProduct ? parseLote(body) : null,
    afectacionIgv: (body.afectacionIgv || body.afectacion_igv || '10').trim(),
    activo: parseBool(body.activo, true),
    manejaStock:
      body.manejaStock === false || body.maneja_stock === false
        ? false
        : body.manejaStock === 'on' ||
          body.manejaStock === 'true' ||
          body.manejaStock === true ||
          body.maneja_stock === true ||
          body.maneja_stock === 'on' ||
          body.maneja_stock === 'true' ||
          isProduct,
    manejaSerie:
      body.manejaSerie === 'on' ||
      body.manejaSerie === 'true' ||
      body.manejaSerie === true ||
      body.maneja_serie === 'on' ||
      body.maneja_serie === 'true' ||
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

async function findPaginated({
  q = '',
  kind = '',
  companyRuc = '',
  page = 1,
  pageSize = 25,
  skip = 0,
  soloActivos = false,
  almacenId = null,
}) {
  const where = buildSearchWhere({ q, kind, companyRuc, soloActivos });

  const [total, rows] = await Promise.all([
    prisma.catalogItem.count({ where }),
    prisma.catalogItem.findMany({
      where,
      orderBy: [{ companyRuc: 'asc' }, { nombre: 'asc' }],
      skip,
      take: pageSize,
    }),
  ]);

  const items = await enrichStock(rows, almacenId || null, { format: 'public' });
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

/**
 * Listado móvil: página de N ítems (default 20) sin cargar/enrich todo el catálogo.
 */
async function findByCompanyRucPaginated(
  companyRuc,
  {
    almacenId = null,
    restrictToAlmacen = false,
    q = '',
    skip = 0,
    take = 20,
  } = {},
) {
  const where = { companyRuc };
  if (almacenId) {
    where.kind = 'PRODUCT';
  }

  const qn = String(q || '').trim();
  if (qn) {
    where.OR = [
      { nombre: { contains: qn } },
      { codigo: { contains: qn } },
      { codigoSunat: { contains: qn } },
      { descripcion: { contains: qn } },
    ];
  }

  if (restrictToAlmacen && almacenId) {
    // Con filtro de almacén + stock>0 aún hace falta enriquecer; acotamos a ítems vinculados.
    const linkedIds = await getItemIdsLinkedToAlmacen(companyRuc, almacenId);
    const idList = [...linkedIds];
    if (idList.length === 0) {
      return { items: [], total: 0 };
    }
    where.id = { in: idList };
    const rows = await prisma.catalogItem.findMany({
      where,
      orderBy: [{ activo: 'desc' }, { nombre: 'asc' }],
    });
    let items = await enrichStock(rows, almacenId);
    items = items.filter((item) => {
      const stock = item.stock_actual ?? 0;
      if (item.maneja_stock || item.maneja_serie) return stock > 0;
      return true;
    });
    const total = items.length;
    return { items: items.slice(skip, skip + take), total };
  }

  const [total, rows] = await Promise.all([
    prisma.catalogItem.count({ where }),
    prisma.catalogItem.findMany({
      where,
      orderBy: [{ activo: 'desc' }, { nombre: 'asc' }],
      skip,
      take,
    }),
  ]);

  const items = await enrichStock(rows, almacenId);
  return { items, total };
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
      precioCompra: data.precioCompra,
      fechaVencimiento: data.fechaVencimiento,
      lote: data.lote || null,
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
      precioCompra: data.precioCompra,
      fechaVencimiento: data.fechaVencimiento,
      ...(data.lote !== undefined ? { lote: data.lote } : {}),
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
  enrichStock,
  findPaginated,
  findByCompanyRuc,
  findByCompanyRucPaginated,
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

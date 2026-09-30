const { randomUUID } = require('crypto');
const prisma = require('../config/prisma');
const {
  toAddressSnapshot,
  toAddressApi,
  registerCatalogAddress,
} = require('../utils/addressHelper');

function addressOf(almacen) {
  return toAddressApi(almacen?.addressJson || almacen?.address) || null;
}

function toApi(almacen) {
  if (!almacen) return null;
  const pub = toPublic(almacen);
  if (!pub) return null;
  const addr = pub.address;
  return {
    id: pub.id,
    company_ruc: pub.companyRuc,
    codigo: pub.codigo,
    nombre: pub.nombre,
    activo: pub.activo,
    address: addr
      ? {
          ubigeo: addr.ubigeo,
          departamento: addr.departamento,
          provincia: addr.provincia,
          distrito: addr.distrito,
          direccion: addr.direccion,
          cod_local: addr.cod_local || addr.codLocal,
        }
      : null,
  };
}

async function findByCompanyRuc(companyRuc, { soloActivos = true, almacenId = null } = {}) {
  const where = { companyRuc };
  if (soloActivos) where.activo = true;
  if (almacenId) where.id = almacenId;

  return prisma.almacen.findMany({
    where,
    orderBy: [{ nombre: 'asc' }, { codigo: 'asc' }],
  });
}

function toPublic(almacen) {
  if (!almacen) return null;
  const addr = addressOf(almacen);
  return {
    id: almacen.id,
    companyRuc: almacen.companyRuc,
    companyNombre: almacen.companyNombre ?? null,
    codigo: almacen.codigo,
    nombre: almacen.nombre,
    activo: almacen.activo !== false,
    address: addr
      ? {
          ubigeo: addr.ubigeo,
          departamento: addr.departamento,
          provincia: addr.provincia,
          distrito: addr.distrito,
          direccion: addr.direccion,
          codLocal: addr.cod_local,
          cod_local: addr.cod_local,
        }
      : null,
    usuariosCount: almacen._count?.usuarios ?? 0,
    seriesCount: almacen._count?.productoSeries ?? 0,
    movimientosCount:
      (almacen._count?.movimientosOrigen ?? 0) + (almacen._count?.movimientosDestino ?? 0),
  };
}

function parseActivo(body, defaultValue = true) {
  if (body.activo === undefined || body.activo === null || body.activo === '') {
    return defaultValue;
  }
  return body.activo === 'on' || body.activo === 'true' || body.activo === true;
}

function parseBody(body, { activoDefault = true } = {}) {
  return {
    companyRuc: (body.companyRuc || body.company_ruc || '').trim(),
    codigo: (body.codigo || '').trim(),
    nombre: (body.nombre || '').trim(),
    activo: parseActivo(body, activoDefault),
  };
}

async function buildSearchWhere({ q = '', companyRuc = '' } = {}) {
  const where = {};

  if (companyRuc) {
    where.companyRuc = companyRuc;
  }

  const term = (q || '').trim();
  if (term) {
    const companies = await prisma.company.findMany({
      where: { nombre: { contains: term } },
      select: { ruc: true },
    });
    const rucsPorNombre = companies.map((c) => c.ruc);

    const or = [
      { codigo: { contains: term } },
      { nombre: { contains: term } },
      { companyRuc: { contains: term } },
    ];

    if (rucsPorNombre.length > 0) {
      or.push({ companyRuc: { in: rucsPorNombre } });
    }

    where.OR = or;
  }

  return where;
}

const includeRelations = {
  _count: {
    select: {
      usuarios: true,
      productoSeries: true,
      inventario: true,
      movimientosOrigen: true,
      movimientosDestino: true,
      lineasCatalogo: true,
    },
  },
};

async function findPaginated({ q = '', companyRuc = '', page = 1, pageSize = 25, skip = 0 }) {
  const where = await buildSearchWhere({ q, companyRuc });

  const [total, rows] = await Promise.all([
    prisma.almacen.count({ where }),
    prisma.almacen.findMany({
      where,
      include: includeRelations,
      orderBy: [{ companyRuc: 'asc' }, { nombre: 'asc' }],
      skip,
      take: pageSize,
    }),
  ]);

  const rucs = [...new Set(rows.map((row) => row.companyRuc))];
  const companies = rucs.length
    ? await prisma.company.findMany({
        where: { ruc: { in: rucs } },
        select: { ruc: true, nombre: true },
      })
    : [];
  const nombrePorRuc = Object.fromEntries(companies.map((c) => [c.ruc, c.nombre]));

  return {
    total,
    items: rows.map((row) =>
      toPublic({ ...row, companyNombre: nombrePorRuc[row.companyRuc] ?? null }),
    ),
  };
}

async function findById(id) {
  return prisma.almacen.findUnique({
    where: { id },
    include: includeRelations,
  });
}

async function findByCodigo(companyRuc, codigo) {
  if (!codigo) return null;
  return prisma.almacen.findFirst({
    where: { companyRuc, codigo },
  });
}

async function findByCodigoExceptId(companyRuc, codigo, id) {
  if (!codigo) return null;
  return prisma.almacen.findFirst({
    where: { companyRuc, codigo, NOT: { id } },
  });
}

async function create(body) {
  const data = parseBody(body);
  const snapshot = toAddressSnapshot(body);

  return prisma.$transaction(async (tx) => {
    const row = await tx.almacen.create({
      data: {
        id: randomUUID(),
        companyRuc: data.companyRuc,
        codigo: data.codigo,
        nombre: data.nombre,
        activo: data.activo,
        addressJson: snapshot,
      },
    });
    if (snapshot) {
      await registerCatalogAddress(tx, {
        companyRuc: data.companyRuc,
        snapshot,
        etiqueta: `${data.nombre || 'Almacén'} · ${snapshot.distrito || snapshot.direccion || ''}`.slice(0, 120),
      });
    }
    return tx.almacen.findUnique({
      where: { id: row.id },
      include: includeRelations,
    });
  });
}

async function update(id, body) {
  const data = parseBody(body);
  const snapshot = toAddressSnapshot(body);
  const existing = await prisma.almacen.findUnique({ where: { id } });
  if (!existing) return null;

  return prisma.$transaction(async (tx) => {
    const patch = {
      companyRuc: data.companyRuc,
      codigo: data.codigo,
      nombre: data.nombre,
      activo: data.activo,
      addressJson: snapshot,
    };

    if (snapshot) {
      await registerCatalogAddress(tx, {
        companyRuc: data.companyRuc,
        snapshot,
        etiqueta: `${data.nombre || 'Almacén'} · ${snapshot.distrito || snapshot.direccion || ''}`.slice(0, 120),
      });
    }

    return tx.almacen.update({
      where: { id },
      data: patch,
      include: includeRelations,
    });
  });
}

async function setActive(id, activo) {
  return prisma.almacen.update({
    where: { id },
    data: { activo },
    include: includeRelations,
  });
}

async function remove(id) {
  const almacen = await prisma.almacen.findUnique({
    where: { id },
    include: {
      _count: {
        select: {
          usuarios: true,
          productoSeries: true,
          inventario: true,
          movimientosOrigen: true,
          movimientosDestino: true,
          lineasCatalogo: true,
        },
      },
    },
  });

  if (!almacen) return { error: 'not_found' };

  const totalRelations =
    almacen._count.usuarios +
    almacen._count.productoSeries +
    almacen._count.inventario +
    almacen._count.movimientosOrigen +
    almacen._count.movimientosDestino +
    almacen._count.lineasCatalogo;

  if (totalRelations > 0) return { error: 'has_relations' };

  await prisma.almacen.delete({ where: { id } });
  return { ok: true };
}

module.exports = {
  toPublic,
  toApi,
  parseBody,
  findPaginated,
  findByCompanyRuc,
  findById,
  findByCodigo,
  findByCodigoExceptId,
  create,
  update,
  setActive,
  remove,
};

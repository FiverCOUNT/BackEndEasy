const { randomUUID } = require('crypto');
const prisma = require('../config/prisma');

function toApi(almacen) {
  if (!almacen) return null;
  const pub = toPublic(almacen);
  if (!pub) return null;
  return {
    id: pub.id,
    company_ruc: pub.companyRuc,
    codigo: pub.codigo,
    nombre: pub.nombre,
    activo: pub.activo,
    address: pub.address
      ? {
          ubigeo: pub.address.ubigeo,
          departamento: pub.address.departamento,
          provincia: pub.address.provincia,
          distrito: pub.address.distrito,
          direccion: pub.address.direccion,
          cod_local: pub.address.codLocal,
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
    include: { address: true },
    orderBy: [{ nombre: 'asc' }, { codigo: 'asc' }],
  });
}

function toPublic(almacen) {
  if (!almacen) return null;
  return {
    id: almacen.id,
    companyRuc: almacen.companyRuc,
    companyNombre: almacen.companyNombre ?? null,
    codigo: almacen.codigo,
    nombre: almacen.nombre,
    activo: almacen.activo !== false,
    addressId: almacen.addressId,
    address: almacen.address
      ? {
          ubigeo: almacen.address.ubigeo,
          departamento: almacen.address.departamento,
          provincia: almacen.address.provincia,
          distrito: almacen.address.distrito,
          direccion: almacen.address.direccion,
          codLocal: almacen.address.codLocal,
        }
      : null,
    usuariosCount: almacen._count?.usuarios ?? 0,
    seriesCount: almacen._count?.productoSeries ?? 0,
    movimientosCount:
      (almacen._count?.movimientosOrigen ?? 0) + (almacen._count?.movimientosDestino ?? 0),
  };
}

function buildAddressData(body) {
  const ubigeo = (body.ubigeo || '').trim();
  const direccion = (body.direccion || '').trim();
  if (!ubigeo && !direccion && !body.departamento && !body.provincia && !body.distrito) {
    return null;
  }

  return {
    id: randomUUID(),
    ubigeo: ubigeo || null,
    departamento: (body.departamento || '').trim() || null,
    provincia: (body.provincia || '').trim() || null,
    distrito: (body.distrito || '').trim() || null,
    direccion: direccion || null,
    codLocal: (body.codLocal || '0000').trim() || '0000',
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
      { address: { is: { direccion: { contains: term } } } },
      { address: { is: { distrito: { contains: term } } } },
    ];

    if (rucsPorNombre.length > 0) {
      or.push({ companyRuc: { in: rucsPorNombre } });
    }

    where.OR = or;
  }

  return where;
}

const includeRelations = {
  address: true,
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
  const addressData = buildAddressData(body);

  return prisma.$transaction(async (tx) => {
    const rowData = {
      id: randomUUID(),
      companyRuc: data.companyRuc,
      codigo: data.codigo,
      nombre: data.nombre,
      activo: data.activo,
    };

    if (addressData) {
      await tx.address.create({ data: addressData });
      rowData.addressId = addressData.id;
    }

    const row = await tx.almacen.create({ data: rowData });
    return tx.almacen.findUnique({
      where: { id: row.id },
      include: includeRelations,
    });
  });
}

async function update(id, body) {
  const data = parseBody(body);
  const addressData = buildAddressData(body);
  const existing = await prisma.almacen.findUnique({
    where: { id },
    include: { address: true },
  });
  if (!existing) return null;

  return prisma.$transaction(async (tx) => {
    const patch = {
      companyRuc: data.companyRuc,
      codigo: data.codigo,
      nombre: data.nombre,
      activo: data.activo,
    };

    if (addressData) {
      if (existing.addressId) {
        await tx.address.update({
          where: { id: existing.addressId },
          data: {
            ubigeo: addressData.ubigeo,
            departamento: addressData.departamento,
            provincia: addressData.provincia,
            distrito: addressData.distrito,
            direccion: addressData.direccion,
            codLocal: addressData.codLocal,
          },
        });
      } else {
        await tx.address.create({ data: addressData });
        patch.addressId = addressData.id;
      }
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

  if (almacen.addressId) {
    await prisma.almacen.update({
      where: { id },
      data: { addressId: null },
    });
    await prisma.address.delete({ where: { id: almacen.addressId } });
  }

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

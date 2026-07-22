const prisma = require('../config/prisma');

function toApi(row) {
  if (!row) return null;
  return {
    codigo: row.codigo,
    nombre: row.nombre,
  };
}

async function findPaginated({ q = '', page = 1, pageSize = 40, skip = 0 } = {}) {
  const term = String(q || '').trim();
  const where = term
    ? {
        OR: [
          { codigo: { contains: term } },
          { nombre: { contains: term } },
        ],
      }
    : {};

  const [total, items] = await Promise.all([
    prisma.codigoProductoSunat.count({ where }),
    prisma.codigoProductoSunat.findMany({
      where,
      orderBy: [{ nombre: 'asc' }, { codigo: 'asc' }],
      skip,
      take: pageSize,
    }),
  ]);

  return { total, items: items.map(toApi) };
}

async function findByCodigo(codigo) {
  const code = String(codigo || '').trim();
  if (!/^\d{8}$/.test(code)) return null;
  return prisma.codigoProductoSunat.findUnique({ where: { codigo: code } });
}

module.exports = {
  toApi,
  findPaginated,
  findByCodigo,
};

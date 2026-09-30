const { randomUUID } = require('crypto');
const prisma = require('../config/prisma');

function normalizePlaca(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '');
}

function normalizeCompanyRuc(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 11);
}

function normalizePermiso(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const tipo = String(raw.tipo || raw.tipo_permiso || raw.tipoPermiso || '')
    .trim()
    .toUpperCase() || 'TUCE';
  const numero = String(
    raw.numero || raw.nro || raw.nro_circulacion || raw.nroCirculacion || '',
  ).trim();
  if (!numero) return null;
  return { tipo: tipo.slice(0, 60), numero: numero.slice(0, 80) };
}

function parsePermisos(value) {
  if (Array.isArray(value)) return value.map(normalizePermiso).filter(Boolean);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(normalizePermiso).filter(Boolean) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function collectPermisosFromBody(body, existing = []) {
  if (body?.permisos !== undefined) {
    return parsePermisos(body.permisos);
  }

  const list = [...existing];
  const tuceLegacy = String(
    body?.nro_circulacion || body?.nroCirculacion || body?.tuce || '',
  ).trim();
  if (tuceLegacy && !list.some((p) => p.numero === tuceLegacy)) {
    list.push({ tipo: 'TUCE', numero: tuceLegacy.slice(0, 80) });
  }
  return list;
}

function permisoTuce(permisos) {
  const row = parsePermisos(permisos).find((p) => {
    const tipo = String(p.tipo || '').toUpperCase();
    return tipo === 'TUCE'
      || tipo.includes('TUCE')
      || tipo.includes('HABILITACION');
  });
  return row?.numero || null;
}

function toApi(row) {
  if (!row) return null;
  const permisos = parsePermisos(row.permisos);
  return {
    id: row.id,
    company_ruc: row.companyRuc || null,
    placa: row.placa,
    permisos,
    nro_circulacion: permisoTuce(permisos),
  };
}

function buildWhereVehiculo(companyRuc, q = null) {
  const ruc = normalizeCompanyRuc(companyRuc);
  const where = { companyRuc: ruc };
  const query = String(q || '').trim().toUpperCase().replace(/[\s-]+/g, '');
  if (query) where.placa = { contains: query };
  return where;
}

async function listAll(companyRuc, { q = null, skip = 0, take = null } = {}) {
  const ruc = normalizeCompanyRuc(companyRuc);
  if (!ruc) return [];
  const opts = {
    where: buildWhereVehiculo(ruc, q),
    orderBy: [{ placa: 'asc' }],
  };
  if (take != null) {
    opts.skip = Math.max(0, Number(skip) || 0);
    opts.take = Math.min(Math.max(Number(take) || 10, 1), 100);
  }
  return prisma.vehiculo.findMany(opts);
}

async function countAll(companyRuc, { q = null } = {}) {
  const ruc = normalizeCompanyRuc(companyRuc);
  if (!ruc) return 0;
  return prisma.vehiculo.count({ where: buildWhereVehiculo(ruc, q) });
}

async function findById(id, companyRuc = null) {
  const row = await prisma.vehiculo.findUnique({ where: { id } });
  if (!row) return null;
  if (companyRuc && normalizeCompanyRuc(companyRuc) !== String(row.companyRuc || '')) {
    return null;
  }
  return row;
}

async function create(companyRuc, body) {
  const ruc = normalizeCompanyRuc(companyRuc);
  if (!ruc || ruc.length !== 11) {
    const err = new Error('Empresa inválida para registrar el vehículo');
    err.status = 400;
    throw err;
  }

  const placa = normalizePlaca(body?.placa);
  if (!placa) {
    const err = new Error('La placa es obligatoria');
    err.status = 400;
    throw err;
  }
  if (placa.length < 5 || placa.length > 15) {
    const err = new Error('La placa no es válida');
    err.status = 400;
    throw err;
  }

  const permisos = collectPermisosFromBody(body);

  try {
    return await prisma.vehiculo.create({
      data: {
        id: randomUUID(),
        companyRuc: ruc,
        placa,
        permisos,
      },
    });
  } catch (err) {
    if (err.code === 'P2002') {
      const dup = new Error(`Ya existe un vehículo con placa ${placa} en esta empresa`);
      dup.status = 409;
      throw dup;
    }
    throw err;
  }
}

async function update(id, companyRuc, body) {
  const existing = await findById(id, companyRuc);
  if (!existing) {
    const err = new Error('Vehículo no encontrado');
    err.status = 404;
    throw err;
  }

  const placa = body?.placa !== undefined
    ? normalizePlaca(body.placa)
    : existing.placa;
  if (!placa) {
    const err = new Error('La placa es obligatoria');
    err.status = 400;
    throw err;
  }

  const data = { placa };
  if (body?.permisos !== undefined
    || body?.nro_circulacion !== undefined
    || body?.nroCirculacion !== undefined
    || body?.tuce !== undefined) {
    data.permisos = collectPermisosFromBody(body, parsePermisos(existing.permisos));
  }

  try {
    return await prisma.vehiculo.update({
      where: { id },
      data,
    });
  } catch (err) {
    if (err.code === 'P2002') {
      const dup = new Error(`Ya existe un vehículo con placa ${placa} en esta empresa`);
      dup.status = 409;
      throw dup;
    }
    throw err;
  }
}

async function remove(id, companyRuc) {
  const existing = await findById(id, companyRuc);
  if (!existing) {
    const err = new Error('Vehículo no encontrado');
    err.status = 404;
    throw err;
  }
  await prisma.vehiculo.delete({ where: { id } });
  return { id: existing.id };
}

module.exports = {
  listAll,
  countAll,
  findById,
  create,
  update,
  remove,
  toApi,
  normalizePlaca,
};

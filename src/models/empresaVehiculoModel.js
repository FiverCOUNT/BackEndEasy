const { randomUUID } = require('crypto');
const prisma = require('../config/prisma');

function normalizePlaca(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '');
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
    placa: row.placa,
    permisos,
    nro_circulacion: permisoTuce(permisos),
  };
}

async function listAll({ q = null } = {}) {
  const query = String(q || '').trim().toUpperCase();
  return prisma.vehiculo.findMany({
    where: query
      ? { placa: { contains: query.replace(/[\s-]+/g, '') } }
      : undefined,
    orderBy: [{ placa: 'asc' }],
  });
}

async function findById(id) {
  return prisma.vehiculo.findUnique({ where: { id } });
}

async function create(body) {
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
        placa,
        permisos,
      },
    });
  } catch (err) {
    if (err.code === 'P2002') {
      const dup = new Error(`Ya existe un vehículo con placa ${placa}`);
      dup.status = 409;
      throw dup;
    }
    throw err;
  }
}

async function update(id, body) {
  const existing = await findById(id);
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
      const dup = new Error(`Ya existe un vehículo con placa ${placa}`);
      dup.status = 409;
      throw dup;
    }
    throw err;
  }
}

async function remove(id) {
  const existing = await findById(id);
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
  findById,
  create,
  update,
  remove,
  toApi,
  normalizePlaca,
};

const { randomUUID } = require('crypto');
const prisma = require('../config/prisma');
const { assertUbigeoPeru } = require('../utils/ubigeo');

function parseAddressInput(body) {
  const raw = body?.address ?? body?.direccion;
  if (!raw) return null;
  if (typeof raw === 'string') {
    const linea = raw.trim();
    return linea ? { direccion: linea } : null;
  }
  if (typeof raw === 'object') return raw;
  return null;
}

function buildAddressFields(input) {
  if (!input || typeof input !== 'object') return null;

  const ubigeo = String(input.ubigeo || '').trim();
  const direccion = String(input.direccion || input.linea || '').trim();
  const departamento = String(input.departamento || '').trim();
  const provincia = String(input.provincia || '').trim();
  const distrito = String(input.distrito || '').trim();
  const urbanizacion = String(input.urbanizacion || '').trim();
  const codLocal = String(input.cod_local || input.codLocal || '0000').trim() || '0000';

  if (!ubigeo || !direccion) return null;

  const ubigeoValido = assertUbigeoPeru(ubigeo, 'ubicación GRE');

  return {
    ubigeo: ubigeoValido,
    departamento: departamento || null,
    provincia: provincia || null,
    distrito: distrito || null,
    urbanizacion: urbanizacion || null,
    direccion,
    codLocal,
  };
}

function toApi(row) {
  if (!row) return null;
  return {
    id: row.id,
    company_ruc: row.companyRuc,
    etiqueta: row.etiqueta,
    // Misma forma anidada que espera la app móvil.
    address: {
      ubigeo: row.ubigeo,
      departamento: row.departamento,
      provincia: row.provincia,
      distrito: row.distrito,
      urbanizacion: row.urbanizacion,
      direccion: row.direccion,
      cod_local: row.codLocal,
    },
  };
}

async function listByCompany(companyRuc) {
  return prisma.address.findMany({
    where: {
      companyRuc,
      etiqueta: { not: null },
    },
    orderBy: [{ creadoEn: 'desc' }, { etiqueta: 'asc' }],
  });
}

async function create(companyRuc, body) {
  const etiqueta = String(body?.etiqueta || '').trim();
  if (!etiqueta) {
    const err = new Error('La etiqueta es obligatoria');
    err.status = 400;
    throw err;
  }

  const fields = buildAddressFields(parseAddressInput(body));
  if (!fields) {
    const err = new Error('Indica ubigeo y dirección completos');
    err.status = 400;
    throw err;
  }

  return prisma.address.create({
    data: {
      id: randomUUID(),
      companyRuc,
      etiqueta,
      ...fields,
    },
  });
}

async function update(companyRuc, id, body) {
  const existing = await prisma.address.findFirst({
    where: { id, companyRuc, etiqueta: { not: null } },
  });
  if (!existing) {
    const err = new Error('Ubicación no encontrada');
    err.status = 404;
    throw err;
  }

  const etiqueta = String(body?.etiqueta ?? existing.etiqueta).trim();
  if (!etiqueta) {
    const err = new Error('La etiqueta es obligatoria');
    err.status = 400;
    throw err;
  }

  const fields = buildAddressFields(parseAddressInput(body) || existing);
  if (!fields) {
    const err = new Error('Indica ubigeo y dirección completos');
    err.status = 400;
    throw err;
  }

  return prisma.address.update({
    where: { id },
    data: {
      etiqueta,
      ...fields,
    },
  });
}

async function remove(companyRuc, id) {
  const existing = await prisma.address.findFirst({
    where: { id, companyRuc, etiqueta: { not: null } },
    select: { id: true },
  });
  if (!existing) {
    const err = new Error('Ubicación no encontrada');
    err.status = 404;
    throw err;
  }

  await prisma.address.delete({ where: { id: existing.id } });
  return { id: existing.id };
}

module.exports = {
  listByCompany,
  create,
  update,
  remove,
  toApi,
};

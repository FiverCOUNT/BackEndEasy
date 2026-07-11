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

function buildAddressData(input) {
  const fields = buildAddressFields(input);
  if (!fields) return null;
  return { id: randomUUID(), ...fields };
}

function toApi(row) {
  if (!row) return null;
  return {
    id: row.id,
    company_ruc: row.companyRuc,
    etiqueta: row.etiqueta,
    address: row.address
      ? {
          ubigeo: row.address.ubigeo,
          departamento: row.address.departamento,
          provincia: row.address.provincia,
          distrito: row.address.distrito,
          urbanizacion: row.address.urbanizacion,
          direccion: row.address.direccion,
          cod_local: row.address.codLocal,
        }
      : null,
  };
}

async function listByCompany(companyRuc) {
  return prisma.empresaUbicacion.findMany({
    where: { companyRuc },
    include: { address: true },
    orderBy: { creadoEn: 'desc' },
  });
}

async function create(companyRuc, body) {
  const etiqueta = String(body?.etiqueta || '').trim();
  if (!etiqueta) {
    const err = new Error('La etiqueta es obligatoria');
    err.status = 400;
    throw err;
  }

  const addressData = buildAddressData(parseAddressInput(body));
  if (!addressData) {
    const err = new Error('Indica ubigeo y dirección completos');
    err.status = 400;
    throw err;
  }

  return prisma.$transaction(async (tx) => {
    await tx.address.create({ data: addressData });
    return tx.empresaUbicacion.create({
      data: {
        id: randomUUID(),
        companyRuc,
        etiqueta,
        addressId: addressData.id,
      },
      include: { address: true },
    });
  });
}

async function update(companyRuc, id, body) {
  const existing = await prisma.empresaUbicacion.findFirst({
    where: { id, companyRuc },
    include: { address: true },
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

  const addressFields = buildAddressFields(parseAddressInput(body) || existing.address);
  if (!addressFields) {
    const err = new Error('Indica ubigeo y dirección completos');
    err.status = 400;
    throw err;
  }

  return prisma.empresaUbicacion.update({
    where: { id },
    data: {
      etiqueta,
      address: { update: addressFields },
    },
    include: { address: true },
  });
}

async function remove(companyRuc, id) {
  const existing = await prisma.empresaUbicacion.findFirst({
    where: { id, companyRuc },
    select: { id: true, addressId: true },
  });
  if (!existing) {
    const err = new Error('Ubicación no encontrada');
    err.status = 404;
    throw err;
  }

  // Borrar address cascada a empresa_ubicaciones (onDelete Cascade).
  await prisma.address.delete({ where: { id: existing.addressId } });
  return { id: existing.id };
}

module.exports = {
  listByCompany,
  create,
  update,
  remove,
  toApi,
};

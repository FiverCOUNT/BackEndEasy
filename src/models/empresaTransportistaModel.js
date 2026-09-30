const { randomUUID } = require('crypto');
const prisma = require('../config/prisma');

function normalizeRuc(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 11);
}

function toApi(row) {
  if (!row) return null;
  return {
    id: row.id,
    ruc: row.ruc,
    razon_social: row.razonSocial,
    nro_mtc: row.nroMtc || null,
  };
}

async function listAll({ q = null } = {}) {
  const query = String(q || '').trim();
  const digits = normalizeRuc(query);
  return prisma.transportista.findMany({
    where: query
      ? {
          OR: [
            ...(digits ? [{ ruc: { contains: digits } }] : []),
            { razonSocial: { contains: query } },
            { nroMtc: { contains: query } },
          ],
        }
      : undefined,
    orderBy: [{ razonSocial: 'asc' }],
  });
}

async function findById(id) {
  return prisma.transportista.findUnique({ where: { id } });
}

async function create(body) {
  const ruc = normalizeRuc(body?.ruc || body?.numero_doc || body?.numeroDoc);
  if (ruc.length !== 11) {
    const err = new Error('El RUC del transportista debe tener 11 dígitos');
    err.status = 400;
    throw err;
  }
  const razonSocial = String(body?.razon_social || body?.razonSocial || body?.nombre || '').trim();
  if (!razonSocial) {
    const err = new Error('La razón social es obligatoria');
    err.status = 400;
    throw err;
  }
  const nroMtc = String(body?.nro_mtc || body?.nroMtc || body?.mtc || '').trim() || null;

  try {
    return await prisma.transportista.create({
      data: {
        id: randomUUID(),
        ruc,
        razonSocial: razonSocial.slice(0, 255),
        nroMtc: nroMtc ? nroMtc.slice(0, 40) : null,
      },
    });
  } catch (err) {
    if (err.code === 'P2002') {
      const dup = new Error(`Ya existe un transportista con RUC ${ruc}`);
      dup.status = 409;
      throw dup;
    }
    throw err;
  }
}

async function update(id, body) {
  const existing = await findById(id);
  if (!existing) {
    const err = new Error('Transportista no encontrado');
    err.status = 404;
    throw err;
  }

  const ruc = body?.ruc !== undefined || body?.numero_doc !== undefined
    ? normalizeRuc(body?.ruc || body?.numero_doc || body?.numeroDoc)
    : existing.ruc;
  if (ruc.length !== 11) {
    const err = new Error('El RUC del transportista debe tener 11 dígitos');
    err.status = 400;
    throw err;
  }

  const razonSocial = body?.razon_social !== undefined || body?.razonSocial !== undefined
    ? String(body?.razon_social || body?.razonSocial || '').trim()
    : existing.razonSocial;
  if (!razonSocial) {
    const err = new Error('La razón social es obligatoria');
    err.status = 400;
    throw err;
  }

  const nroMtc = body?.nro_mtc !== undefined || body?.nroMtc !== undefined || body?.mtc !== undefined
    ? (String(body?.nro_mtc || body?.nroMtc || body?.mtc || '').trim() || null)
    : existing.nroMtc;

  try {
    return await prisma.transportista.update({
      where: { id },
      data: {
        ruc,
        razonSocial: razonSocial.slice(0, 255),
        nroMtc: nroMtc ? String(nroMtc).slice(0, 40) : null,
      },
    });
  } catch (err) {
    if (err.code === 'P2002') {
      const dup = new Error(`Ya existe un transportista con RUC ${ruc}`);
      dup.status = 409;
      throw dup;
    }
    throw err;
  }
}

async function remove(id) {
  const existing = await findById(id);
  if (!existing) {
    const err = new Error('Transportista no encontrado');
    err.status = 404;
    throw err;
  }
  await prisma.transportista.delete({ where: { id } });
  return { id: existing.id };
}

module.exports = {
  listAll,
  findById,
  create,
  update,
  remove,
  toApi,
};

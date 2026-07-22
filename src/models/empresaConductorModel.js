const { randomUUID } = require('crypto');
const prisma = require('../config/prisma');

function normalizeDoc(value) {
  return String(value || '').replace(/\D/g, '');
}

function resolveNombresCompletos(body, fallback = '') {
  const directo = String(
    body?.nombres_completos
    || body?.nombresCompletos
    || body?.nombre_completo
    || body?.nombreCompleto
    || '',
  ).trim();
  if (directo) return directo;

  const nombres = String(body?.nombres || body?.nombre || '').trim();
  const apellidos = String(body?.apellidos || '').trim();
  const joined = [nombres, apellidos].filter(Boolean).join(' ').trim();
  return joined || String(fallback || '').trim();
}

function toApi(row) {
  if (!row) return null;
  const nombresCompletos = String(row.nombresCompletos || '').trim();
  return {
    id: row.id,
    tipo_doc: row.tipoDoc || '1',
    numero_doc: row.numeroDoc,
    nombres_completos: nombresCompletos,
    nombres: nombresCompletos,
    apellidos: null,
    nombre_completo: nombresCompletos,
    licencia: row.licencia || null,
  };
}

async function listAll({ q = null } = {}) {
  const query = String(q || '').trim();
  const digits = normalizeDoc(query);
  return prisma.conductor.findMany({
    where: query
      ? {
          OR: [
            ...(digits ? [{ numeroDoc: { contains: digits } }] : []),
            { nombresCompletos: { contains: query } },
            { licencia: { contains: query } },
          ],
        }
      : undefined,
    orderBy: [{ nombresCompletos: 'asc' }],
  });
}

async function findById(id) {
  return prisma.conductor.findUnique({ where: { id } });
}

async function findByDocumento(tipoDoc, numeroDoc) {
  const numero = normalizeDoc(numeroDoc);
  if (!numero) return null;
  const tipo = String(tipoDoc || '1').trim() || '1';
  return prisma.conductor.findFirst({
    where: { tipoDoc: tipo, numeroDoc: numero },
  });
}

async function create(body) {
  const tipoDoc = String(body?.tipo_doc || body?.tipoDoc || '1').trim() || '1';
  const numeroDoc = normalizeDoc(body?.numero_doc || body?.numeroDoc || body?.num_doc);
  if (!numeroDoc || numeroDoc.length < 8) {
    const err = new Error('El número de documento debe tener al menos 8 dígitos');
    err.status = 400;
    throw err;
  }

  const nombresCompletos = resolveNombresCompletos(body);
  if (!nombresCompletos) {
    const err = new Error('Los nombres completos son obligatorios');
    err.status = 400;
    throw err;
  }

  const licencia = String(body?.licencia || '').trim().toUpperCase() || null;

  try {
    return await prisma.conductor.create({
      data: {
        id: randomUUID(),
        tipoDoc: tipoDoc.slice(0, 2),
        numeroDoc: numeroDoc.slice(0, 20),
        nombresCompletos: nombresCompletos.slice(0, 255),
        licencia: licencia ? licencia.slice(0, 40) : null,
      },
    });
  } catch (err) {
    if (err.code === 'P2002') {
      const dup = new Error(`Ya existe un conductor con documento ${numeroDoc}`);
      dup.status = 409;
      throw dup;
    }
    throw err;
  }
}

async function update(id, body) {
  const existing = await findById(id);
  if (!existing) {
    const err = new Error('Conductor no encontrado');
    err.status = 404;
    throw err;
  }

  const tipoDoc = body?.tipo_doc !== undefined || body?.tipoDoc !== undefined
    ? (String(body?.tipo_doc || body?.tipoDoc || '1').trim() || '1')
    : existing.tipoDoc;

  const numeroDoc = body?.numero_doc !== undefined
    || body?.numeroDoc !== undefined
    || body?.num_doc !== undefined
    ? normalizeDoc(body?.numero_doc || body?.numeroDoc || body?.num_doc)
    : existing.numeroDoc;

  if (!numeroDoc || numeroDoc.length < 8) {
    const err = new Error('El número de documento debe tener al menos 8 dígitos');
    err.status = 400;
    throw err;
  }

  const nombresCompletos = resolveNombresCompletos(body, existing.nombresCompletos);
  if (!nombresCompletos) {
    const err = new Error('Los nombres completos son obligatorios');
    err.status = 400;
    throw err;
  }

  const licencia = body?.licencia !== undefined
    ? (String(body.licencia || '').trim().toUpperCase() || null)
    : existing.licencia;

  try {
    return await prisma.conductor.update({
      where: { id },
      data: {
        tipoDoc: String(tipoDoc).slice(0, 2),
        numeroDoc: String(numeroDoc).slice(0, 20),
        nombresCompletos: nombresCompletos.slice(0, 255),
        licencia: licencia ? String(licencia).slice(0, 40) : null,
      },
    });
  } catch (err) {
    if (err.code === 'P2002') {
      const dup = new Error(`Ya existe un conductor con documento ${numeroDoc}`);
      dup.status = 409;
      throw dup;
    }
    throw err;
  }
}

async function remove(id) {
  const existing = await findById(id);
  if (!existing) {
    const err = new Error('Conductor no encontrado');
    err.status = 404;
    throw err;
  }
  await prisma.conductor.delete({ where: { id } });
  return { id: existing.id };
}

module.exports = {
  listAll,
  findById,
  findByDocumento,
  create,
  update,
  remove,
  toApi,
};

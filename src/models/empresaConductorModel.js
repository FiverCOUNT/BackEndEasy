const { randomUUID } = require('crypto');
const prisma = require('../config/prisma');

function normalizeDoc(value) {
  return String(value || '').replace(/\D/g, '');
}

function normalizeCompanyRuc(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 11);
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
    company_ruc: row.companyRuc || null,
    tipo_doc: row.tipoDoc || '1',
    numero_doc: row.numeroDoc,
    nombres_completos: nombresCompletos,
    nombres: nombresCompletos,
    apellidos: null,
    nombre_completo: nombresCompletos,
    licencia: row.licencia || null,
  };
}

function buildWhereConductor(companyRuc, q = null) {
  const ruc = normalizeCompanyRuc(companyRuc);
  const where = { companyRuc: ruc };
  const query = String(q || '').trim();
  if (!query) return where;
  const digits = normalizeDoc(query);
  where.AND = [{
    OR: [
      ...(digits ? [{ numeroDoc: { contains: digits } }] : []),
      { nombresCompletos: { contains: query } },
      { licencia: { contains: query } },
    ],
  }];
  return where;
}

async function listAll(companyRuc, { q = null, skip = 0, take = null } = {}) {
  const ruc = normalizeCompanyRuc(companyRuc);
  if (!ruc) return [];
  const opts = {
    where: buildWhereConductor(ruc, q),
    orderBy: [{ nombresCompletos: 'asc' }],
  };
  if (take != null) {
    opts.skip = Math.max(0, Number(skip) || 0);
    opts.take = Math.min(Math.max(Number(take) || 10, 1), 100);
  }
  return prisma.conductor.findMany(opts);
}

async function countAll(companyRuc, { q = null } = {}) {
  const ruc = normalizeCompanyRuc(companyRuc);
  if (!ruc) return 0;
  return prisma.conductor.count({ where: buildWhereConductor(ruc, q) });
}

async function findById(id, companyRuc = null) {
  const row = await prisma.conductor.findUnique({ where: { id } });
  if (!row) return null;
  if (companyRuc && normalizeCompanyRuc(companyRuc) !== String(row.companyRuc || '')) {
    return null;
  }
  return row;
}

async function findByDocumento(companyRuc, tipoDoc, numeroDoc) {
  const ruc = normalizeCompanyRuc(companyRuc);
  const numero = normalizeDoc(numeroDoc);
  if (!ruc || !numero) return null;
  const tipo = String(tipoDoc || '1').trim() || '1';
  return prisma.conductor.findFirst({
    where: { companyRuc: ruc, tipoDoc: tipo, numeroDoc: numero },
  });
}

async function create(companyRuc, body) {
  const ruc = normalizeCompanyRuc(companyRuc);
  if (!ruc || ruc.length !== 11) {
    const err = new Error('Empresa inválida para registrar el conductor');
    err.status = 400;
    throw err;
  }

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

  const licenciaRaw = String(body?.licencia || '').trim().toUpperCase().replace(/[\s-]+/g, '') || null;
  if (licenciaRaw && !/^[A-Z]\d{8,9}$/.test(licenciaRaw)) {
    const err = new Error('Licencia inválida: debe ser letra + 8 o 9 dígitos (ej. Q007444402)');
    err.status = 400;
    throw err;
  }
  const licencia = licenciaRaw;

  try {
    return await prisma.conductor.create({
      data: {
        id: randomUUID(),
        companyRuc: ruc,
        tipoDoc: tipoDoc.slice(0, 2),
        numeroDoc: numeroDoc.slice(0, 20),
        nombresCompletos: nombresCompletos.slice(0, 255),
        licencia: licencia ? licencia.slice(0, 40) : null,
      },
    });
  } catch (err) {
    if (err.code === 'P2002') {
      const dup = new Error(`Ya existe un conductor con documento ${numeroDoc} en esta empresa`);
      dup.status = 409;
      throw dup;
    }
    throw err;
  }
}

async function update(id, companyRuc, body) {
  const existing = await findById(id, companyRuc);
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
    ? (String(body.licencia || '').trim().toUpperCase().replace(/[\s-]+/g, '') || null)
    : existing.licencia;
  if (licencia && !/^[A-Z]\d{8,9}$/.test(String(licencia))) {
    const err = new Error('Licencia inválida: debe ser letra + 8 o 9 dígitos (ej. Q007444402)');
    err.status = 400;
    throw err;
  }

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
      const dup = new Error(`Ya existe un conductor con documento ${numeroDoc} en esta empresa`);
      dup.status = 409;
      throw dup;
    }
    throw err;
  }
}

async function remove(id, companyRuc) {
  const existing = await findById(id, companyRuc);
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
  countAll,
  findById,
  findByDocumento,
  create,
  update,
  remove,
  toApi,
};

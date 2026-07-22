const { randomUUID } = require('crypto');
const prisma = require('../config/prisma');
const {
  buildSeriesConfigFromBody,
  seriesConfigToFormFields,
  normalizeStoredSeriesConfig,
} = require('../utils/seriesConfig');

function normalizeUbigeoForStorage(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length === 6 ? digits : null;
}

function toPublic(company) {
  if (!company) return null;
  return {
    id: company.id.toString(),
    ruc: company.ruc,
    nombre: company.nombre,
    nombreComercial: company.nombreComercial,
    tipoDoc: company.tipoDoc,
    numeroDoc: company.numeroDoc,
    email: company.email,
    telefono: company.telefono,
    entorno: company.entorno,
    plan: company.plan,
    taxRegime: company.taxRegime,
    activo: company.activo,
    isActive: company.isActive,
    creadoEn: company.creadoEn,
    addressId: company.addressId,
    solUser: company.solUser,
    clientId: company.clientId,
    tieneCertificado: company.tieneCertificado,
    rutaFirma: company.rutaFirma,
    tieneSolPass: Boolean(company.solPass),
    tieneClientSecret: Boolean(company.clientSecret),
    tieneCertificatePassword: Boolean(company.certificatePassword),
    nroMtc: company.nroMtc || null,
    nro_mtc: company.nroMtc || null,
    seriesConfig: normalizeStoredSeriesConfig(company.seriesConfigJson),
    usuariosCount: company._count?.usuarios ?? 0,
    address: company.address
      ? {
          ubigeo: company.address.ubigeo,
          departamento: company.address.departamento,
          provincia: company.address.provincia,
          distrito: company.address.distrito,
          direccion: company.address.direccion,
          codLocal: company.address.codLocal,
        }
      : null,
  };
}

function buildAddressData(body) {
  const ubigeo = (body.ubigeo || '').trim();
  const direccion = (body.direccion || '').trim();
  if (!ubigeo && !direccion && !body.departamento) return null;

  return {
    id: randomUUID(),
    ubigeo: normalizeUbigeoForStorage(body.ubigeo),
    departamento: (body.departamento || '').trim() || null,
    provincia: (body.provincia || '').trim() || null,
    distrito: (body.distrito || '').trim() || null,
    direccion: direccion || null,
    codLocal: (() => {
      const raw = String(body.codLocal || '0000').trim() || '0000';
      return /^\d{4}$/.test(raw) ? raw : '0000';
    })(),
  };
}

function buildCompanyData(body, options = {}) {
  const { existing = null, keepEmptyPasswords = true } = options;

  const data = {
    // Si viene vacío en un update parcial, no pisar RUC/nombre existentes
    // (evita empresas con ruc="" al subir solo el certificado).
    ruc: (body.ruc || '').trim() || existing?.ruc || '',
    nombre: (body.nombre || '').trim() || existing?.nombre || '',
    nombreComercial: (body.nombreComercial || '').trim() || null,
    tipoDoc: (body.tipoDoc || '').trim() || null,
    numeroDoc: (body.numeroDoc || '').trim() || null,
    email: (body.email || '').trim() || null,
    telefono: (body.telefono || '').trim() || null,
    entorno: (body.entorno || '').trim() || existing?.entorno || null,
    plan: (body.plan || '').trim() || null,
    taxRegime: (body.taxRegime || '').trim() || null,
    creadoEn: (body.creadoEn || '').trim() || null,
    activo: body.activo === 'on' || body.activo === 'true' || body.activo === true,
    isActive: body.isActive === 'on' || body.isActive === 'true' || body.isActive === true,
    solUser: (body.solUser || '').trim() || (existing && body.solUser === undefined ? existing.solUser : null),
    clientId: (body.clientId || '').trim() || (existing && body.clientId === undefined ? existing.clientId : null),
    nroMtc: (body.nroMtc || body.nro_mtc || '').trim() || null,
  };

  const clientSecret = (body.clientSecret || '').trim();
  if (clientSecret) {
    data.clientSecret = clientSecret;
  } else if (!keepEmptyPasswords || !existing) {
    data.clientSecret = null;
  }

  const solPass = (body.solPass || '').trim();
  if (solPass) {
    data.solPass = solPass;
  } else if (!keepEmptyPasswords || !existing) {
    data.solPass = null;
  }

  const certificatePassword = (body.certificatePassword || '').trim();
  if (certificatePassword) {
    data.certificatePassword = certificatePassword;
  } else if (!keepEmptyPasswords || !existing) {
    data.certificatePassword = null;
  }

  if (body.rutaFirma !== undefined) {
    data.rutaFirma = body.rutaFirma || null;
  }
  if (body.tieneCertificado !== undefined) {
    data.tieneCertificado =
      body.tieneCertificado === 'on'
      || body.tieneCertificado === 'true'
      || body.tieneCertificado === true;
  }

  const seriesConfig = buildSeriesConfigFromBody(body);
  if (seriesConfig) {
    data.seriesConfigJson = seriesConfig;
  }

  return data;
}

function buildSearchWhere(q) {
  const term = (q || '').trim();
  if (!term) return {};

  const or = [
    { ruc: { contains: term } },
    { nombre: { contains: term } },
    { nombreComercial: { contains: term } },
    { email: { contains: term } },
    { telefono: { contains: term } },
    { numeroDoc: { contains: term } },
    { entorno: { contains: term } },
  ];

  return { OR: or };
}

async function findPaginated({ q = '', page = 1, pageSize = 25, skip = 0 }) {
  const where = buildSearchWhere(q);

  const [total, rows] = await Promise.all([
    prisma.company.count({ where }),
    prisma.company.findMany({
      where,
      orderBy: { id: 'asc' },
      skip,
      take: pageSize,
      include: {
        address: true,
        _count: { select: { usuarios: true } },
      },
    }),
  ]);

  return { total, items: rows.map(toPublic) };
}

async function findById(id) {
  return prisma.company.findUnique({
    where: { id: BigInt(id) },
    include: { address: true, _count: { select: { usuarios: true } } },
  });
}

async function findByRuc(ruc) {
  return prisma.company.findFirst({
    where: { ruc },
    include: { address: true },
  });
}

async function findByRucExceptId(ruc, id) {
  return prisma.company.findFirst({
    where: { ruc, NOT: { id: BigInt(id) } },
  });
}

async function create(body, { certFile = null } = {}) {
  const companyData = buildCompanyData(body, { keepEmptyPasswords: false });
  const addressData = buildAddressData(body);

  if (certFile?.buffer?.length) {
    const companyCertificadoService = require('../services/companyCertificadoService');
    const uploaded = await companyCertificadoService.uploadCertificado(companyData.ruc, certFile, {
      password: companyData.certificatePassword || '',
    });
    if (uploaded) {
      companyData.rutaFirma = uploaded.key;
      companyData.tieneCertificado = true;
    }
  }

  return prisma.$transaction(async (tx) => {
    if (addressData) {
      await tx.address.create({ data: addressData });
      companyData.addressId = addressData.id;
    }
    const row = await tx.company.create({ data: companyData });
    return tx.company.findUnique({
      where: { id: row.id },
      include: { address: true },
    });
  });
}

async function update(id, body, { certFile = null, existing = null } = {}) {
  const current =
    existing
    || (await prisma.company.findUnique({
      where: { id: BigInt(id) },
      include: { address: true },
    }));
  if (!current) return null;

  const companyData = buildCompanyData(body, { existing: current, keepEmptyPasswords: true });
  const addressData = buildAddressData(body);

  if (certFile?.buffer?.length) {
    const companyCertificadoService = require('../services/companyCertificadoService');
    const ruc = companyData.ruc || current.ruc;
    const certPassword = companyData.certificatePassword || current.certificatePassword || '';
    const uploaded = await companyCertificadoService.uploadCertificado(ruc, certFile, {
      password: certPassword,
    });
    if (uploaded) {
      companyData.rutaFirma = uploaded.key;
      companyData.tieneCertificado = true;
    }
  }

  return prisma.$transaction(async (tx) => {
    if (addressData) {
      if (current.addressId) {
        await tx.address.update({
          where: { id: current.addressId },
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
        companyData.addressId = addressData.id;
      }
    }

    return tx.company.update({
      where: { id: BigInt(id) },
      data: companyData,
      include: { address: true, _count: { select: { usuarios: true } } },
    });
  });
}

async function setActive(id, active) {
  return prisma.company.update({
    where: { id: BigInt(id) },
    data: { activo: active, isActive: active },
  });
}

async function remove(id) {
  const company = await prisma.company.findUnique({
    where: { id: BigInt(id) },
    include: { _count: { select: { usuarios: true } } },
  });
  if (!company) return { error: 'not_found' };
  if (company._count.usuarios > 0) return { error: 'has_users' };

  if (company.addressId) {
    await prisma.company.update({
      where: { id: BigInt(id) },
      data: { addressId: null },
    });
    await prisma.address.delete({ where: { id: company.addressId } });
  }

  await prisma.company.delete({ where: { id: BigInt(id) } });
  return { ok: true };
}

async function updateNroMtcByRuc(companyRuc, nroMtcRaw) {
  const ruc = String(companyRuc || '').trim();
  if (!ruc) {
    const err = new Error('Empresa sin RUC');
    err.status = 400;
    throw err;
  }
  const nroMtc = String(nroMtcRaw || '').trim().toUpperCase() || null;
  const company = await prisma.company.findFirst({ where: { ruc } });
  if (!company) {
    const err = new Error('Empresa no encontrada');
    err.status = 404;
    throw err;
  }
  return prisma.company.update({
    where: { id: company.id },
    data: { nroMtc },
    select: { id: true, ruc: true, nroMtc: true },
  });
}

function buildSearchWhereTransporte(q) {
  const query = String(q || '').trim();
  if (!query) return {};
  const digits = query.replace(/\D/g, '');
  return {
    OR: [
      ...(digits ? [{ ruc: { contains: digits } }] : []),
      { nombre: { contains: query } },
      { nombreComercial: { contains: query } },
      { nroMtc: { contains: query } },
    ],
  };
}

/** Catálogo de empresas (companies) para elegir transportista en GRE. */
async function listForTransporte({ q = null, soloConMtc = false } = {}) {
  const search = buildSearchWhereTransporte(q);
  const finalWhere = {
    AND: [
      { ruc: { not: '' } },
      ...(soloConMtc ? [{ NOT: { nroMtc: null } }, { nroMtc: { not: '' } }] : []),
      ...(Object.keys(search).length ? [search] : []),
    ],
  };
  return prisma.company.findMany({
    where: finalWhere,
    orderBy: { nombre: 'asc' },
    take: 200,
    include: { address: true, _count: { select: { usuarios: true } } },
  });
}

async function upsertTransporte(body) {
  const ruc = String(body?.ruc || body?.numero_doc || body?.numeroDoc || '').replace(/\D/g, '').slice(0, 11);
  if (ruc.length !== 11) {
    const err = new Error('El RUC debe tener 11 dígitos');
    err.status = 400;
    throw err;
  }
  const nombre = String(body?.nombre || body?.razon_social || body?.razonSocial || '').trim();
  if (!nombre) {
    const err = new Error('La razón social es obligatoria');
    err.status = 400;
    throw err;
  }
  const nroMtc = String(body?.nro_mtc || body?.nroMtc || '').trim().toUpperCase() || null;

  const existing = await prisma.company.findFirst({ where: { ruc } });
  if (existing) {
    return prisma.company.update({
      where: { id: existing.id },
      data: {
        nombre: nombre.slice(0, 255),
        nroMtc: nroMtc ? nroMtc.slice(0, 40) : null,
        tipoDoc: existing.tipoDoc || '6',
        numeroDoc: existing.numeroDoc || ruc,
      },
      include: { address: true, _count: { select: { usuarios: true } } },
    });
  }

  return prisma.company.create({
    data: {
      ruc,
      nombre: nombre.slice(0, 255),
      nroMtc: nroMtc ? nroMtc.slice(0, 40) : null,
      tipoDoc: '6',
      numeroDoc: ruc,
      activo: true,
      isActive: true,
    },
    include: { address: true, _count: { select: { usuarios: true } } },
  });
}

async function updateTransporte(id, body) {
  const current = await findById(id);
  if (!current) {
    const err = new Error('Empresa no encontrada');
    err.status = 404;
    throw err;
  }
  const ruc = body?.ruc !== undefined
    ? String(body.ruc || '').replace(/\D/g, '').slice(0, 11)
    : current.ruc;
  if (ruc.length !== 11) {
    const err = new Error('El RUC debe tener 11 dígitos');
    err.status = 400;
    throw err;
  }
  const nombre = body?.nombre !== undefined || body?.razon_social !== undefined || body?.razonSocial !== undefined
    ? String(body?.nombre || body?.razon_social || body?.razonSocial || '').trim()
    : current.nombre;
  if (!nombre) {
    const err = new Error('La razón social es obligatoria');
    err.status = 400;
    throw err;
  }
  const nroMtc = body?.nro_mtc !== undefined || body?.nroMtc !== undefined
    ? (String(body?.nro_mtc || body?.nroMtc || '').trim().toUpperCase() || null)
    : current.nroMtc;

  const dup = await findByRucExceptId(ruc, id);
  if (dup) {
    const err = new Error(`Ya existe otra empresa con RUC ${ruc}`);
    err.status = 409;
    throw err;
  }

  return prisma.company.update({
    where: { id: BigInt(id) },
    data: {
      ruc,
      nombre: nombre.slice(0, 255),
      nroMtc: nroMtc ? String(nroMtc).slice(0, 40) : null,
      tipoDoc: current.tipoDoc || '6',
      numeroDoc: current.numeroDoc || ruc,
    },
    include: { address: true, _count: { select: { usuarios: true } } },
  });
}

/**
 * Solo elimina si la empresa no tiene usuarios (p. ej. creada solo como transportista).
 */
async function removeTransporteIfSafe(id) {
  const current = await findById(id);
  if (!current) {
    const err = new Error('Empresa no encontrada');
    err.status = 404;
    throw err;
  }
  const usuarios = current._count?.usuarios ?? 0;
  if (usuarios > 0) {
    const err = new Error('No se puede eliminar: la empresa tiene usuarios registrados');
    err.status = 409;
    throw err;
  }
  await remove(id);
  return { id: String(id) };
}

module.exports = {
  toPublic,
  buildCompanyData,
  seriesConfigToFormFields,
  findPaginated,
  findById,
  findByRuc,
  findByRucExceptId,
  create,
  update,
  updateNroMtcByRuc,
  listForTransporte,
  upsertTransporte,
  updateTransporte,
  removeTransporteIfSafe,
  setActive,
  remove,
};

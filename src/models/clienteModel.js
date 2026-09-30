const { randomUUID } = require('crypto');
const prisma = require('../config/prisma');
const {
  parseAddressInput,
  toAddressSnapshot,
  toAddressApi,
  registerCatalogAddress,
} = require('../utils/addressHelper');

const TIPO_DOC_LABEL = {
  '1': 'DNI',
  '6': 'RUC',
  '4': 'CE',
  '7': 'Pasaporte',
};

function addressOf(cliente) {
  return toAddressApi(cliente?.addressJson || cliente?.address) || undefined;
}

function toApi(cliente) {
  if (!cliente) return null;
  return {
    id: cliente.id,
    company_ruc: cliente.companyRuc,
    tipo_doc: cliente.tipoDoc,
    tipo_doc_label: TIPO_DOC_LABEL[cliente.tipoDoc] || cliente.tipoDoc,
    numero_doc: cliente.numeroDoc,
    razon_social: cliente.razonSocial,
    telefono: cliente.telefono,
    activo: cliente.activo,
    address: addressOf(cliente),
  };
}

function toPublic(cliente) {
  if (!cliente) return null;
  const addr = addressOf(cliente) || {};
  return {
    id: cliente.id,
    companyRuc: cliente.companyRuc,
    tipoDoc: cliente.tipoDoc,
    tipoDocLabel: TIPO_DOC_LABEL[cliente.tipoDoc] || cliente.tipoDoc,
    numeroDoc: cliente.numeroDoc,
    razonSocial: cliente.razonSocial,
    telefono: cliente.telefono,
    activo: cliente.activo,
    comprobantesCount: cliente._count?.invoices ?? 0,
    distrito: addr.distrito,
    direccion: addr.direccion,
  };
}

function parseCreateBody(body) {
  return {
    tipoDoc: String(body.tipo_doc || body.tipoDoc || '1').trim(),
    numeroDoc: String(body.numero_doc || body.numeroDoc || '').trim(),
    razonSocial: String(body.razon_social || body.razonSocial || '').trim(),
    telefono: (body.telefono || '').trim() || null,
    addressInput: parseAddressInput(body),
  };
}

function parseUpdateBody(body) {
  const parsed = {};
  if (body.razon_social != null || body.razonSocial != null) {
    parsed.razonSocial = String(body.razon_social || body.razonSocial || '').trim();
  }
  if (Object.prototype.hasOwnProperty.call(body, 'telefono')) {
    parsed.telefono = (body.telefono || '').trim() || null;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'address')
    || Object.prototype.hasOwnProperty.call(body, 'direccion')) {
    parsed.addressInput = parseAddressInput(body);
  }
  return parsed;
}

function buildSearchWhere(q) {
  const term = (q || '').trim();
  if (!term) return {};

  return {
    OR: [
      { razonSocial: { contains: term } },
      { numeroDoc: { contains: term } },
      { companyRuc: { contains: term } },
      { telefono: { contains: term } },
      { tipoDoc: { contains: term } },
    ],
  };
}

async function findAllByCompany(companyRuc, { soloActivos = true } = {}) {
  const where = { companyRuc };
  if (soloActivos) where.activo = true;

  const rows = await prisma.cliente.findMany({
    where,
    orderBy: [{ razonSocial: 'asc' }, { numeroDoc: 'asc' }],
  });

  return rows.map(toApi);
}

/** Listado móvil paginado (20 por página) con búsqueda en DB. */
async function findByCompanyPaginated(
  companyRuc,
  { soloActivos = true, q = '', skip = 0, take = 20 } = {},
) {
  const where = { companyRuc };
  if (soloActivos) where.activo = true;
  const qn = String(q || '').trim();
  if (qn) {
    where.OR = [
      { razonSocial: { contains: qn } },
      { numeroDoc: { contains: qn } },
      { telefono: { contains: qn } },
    ];
  }

  const [total, rows] = await Promise.all([
    prisma.cliente.count({ where }),
    prisma.cliente.findMany({
      where,
      orderBy: [{ razonSocial: 'asc' }, { numeroDoc: 'asc' }],
      skip,
      take,
    }),
  ]);

  return { items: rows.map(toApi), total };
}

async function findById(id, companyRuc) {
  const row = await prisma.cliente.findFirst({
    where: { id, companyRuc },
  });
  return row ? toApi(row) : null;
}

async function findByDocumento(companyRuc, tipoDoc, numeroDoc) {
  return prisma.cliente.findFirst({
    where: { companyRuc, tipoDoc, numeroDoc },
  });
}

async function create({
  companyRuc,
  tipoDoc,
  numeroDoc,
  razonSocial,
  telefono = null,
  addressInput = null,
}) {
  const snapshot = toAddressSnapshot(addressInput);
  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.cliente.create({
      data: {
        id: randomUUID(),
        companyRuc,
        tipoDoc,
        numeroDoc,
        razonSocial,
        telefono,
        activo: true,
        addressJson: snapshot,
      },
    });
    if (snapshot) {
      await registerCatalogAddress(tx, {
        companyRuc,
        snapshot,
        etiqueta: `${razonSocial || 'Cliente'} · ${snapshot.distrito || snapshot.direccion || ''}`.slice(0, 120),
      });
    }
    return created;
  });

  return toApi(row);
}

async function update(id, companyRuc, { razonSocial, telefono, addressInput } = {}) {
  const existing = await prisma.cliente.findFirst({
    where: { id, companyRuc },
  });
  if (!existing) return null;

  const row = await prisma.$transaction(async (tx) => {
    const data = {};
    if (razonSocial !== undefined) data.razonSocial = razonSocial;
    if (telefono !== undefined) data.telefono = telefono;

    if (addressInput !== undefined) {
      const snapshot = toAddressSnapshot(addressInput);
      data.addressJson = snapshot;
      if (snapshot) {
        await registerCatalogAddress(tx, {
          companyRuc,
          snapshot,
          etiqueta: `${razonSocial || existing.razonSocial || 'Cliente'} · ${snapshot.distrito || snapshot.direccion || ''}`.slice(0, 120),
        });
      }
    }

    return tx.cliente.update({
      where: { id },
      data,
    });
  });

  return toApi(row);
}

async function resolveForSalida({ companyRuc, clienteId = null, clienteBody = null }) {
  const id = (clienteId || clienteBody?.id || '').trim();
  if (id) {
    const row = await prisma.cliente.findFirst({ where: { id, companyRuc, activo: true } });
    if (!row) return { error: 'cliente_not_found' };
    return { clienteId: row.id };
  }

  if (!clienteBody || typeof clienteBody !== 'object') {
    return { clienteId: null };
  }

  const tipoDoc = String(clienteBody.tipo_doc || clienteBody.tipoDoc || '1').trim();
  const numeroDoc = String(clienteBody.numero_doc || clienteBody.numeroDoc || '').trim();
  const razonSocial = String(clienteBody.razon_social || clienteBody.razonSocial || '').trim();

  if (!numeroDoc) return { clienteId: null };

  const existing = await findByDocumento(companyRuc, tipoDoc, numeroDoc);
  if (existing) return { clienteId: existing.id };

  if (!razonSocial) return { error: 'cliente_nombre_requerido' };

  const created = await create({ companyRuc, tipoDoc, numeroDoc, razonSocial });
  return { clienteId: created.id };
}

async function findPaginated({ q = '', page = 1, pageSize = 25, skip = 0 }) {
  const where = buildSearchWhere(q);

  const [total, rows] = await Promise.all([
    prisma.cliente.count({ where }),
    prisma.cliente.findMany({
      where,
      include: {
        _count: { select: { invoices: true } },
      },
      orderBy: [{ companyRuc: 'asc' }, { razonSocial: 'asc' }],
      skip,
      take: pageSize,
    }),
  ]);

  return { total, items: rows.map(toPublic) };
}

module.exports = {
  toApi,
  toPublic,
  parseCreateBody,
  parseUpdateBody,
  findAllByCompany,
  findByCompanyPaginated,
  findById,
  findByDocumento,
  create,
  update,
  resolveForSalida,
  findPaginated,
};

const prisma = require('../config/prisma');
const { runWithEntorno, isProdEntorno } = require('../config/prisma');

const ROLES = ['SUPER_ADMIN', 'ADMIN', 'USUARIO'];

const COMPANY_SELECT = {
  id: true,
  nombre: true,
  nombreComercial: true,
  ruc: true,
  activo: true,
  entorno: true,
};

function toPublicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    estado: user.estado,
    rol: user.rol,
    companyId: user.companyId ? user.companyId.toString() : null,
    almacenId: user.almacenId != null ? String(user.almacenId) : null,
    almacenNombre: user.almacen?.nombre ?? null,
    almacenCodigo: user.almacen?.codigo ?? null,
    lastUpdated: user.lastUpdated.toString(),
    companyEntorno: user._dbEntorno || user.company?.entorno || 'beta',
  };
}

function attachDbEntorno(user, entorno) {
  if (!user) return null;
  user._dbEntorno = isProdEntorno(entorno) ? 'prod' : 'beta';
  return user;
}

async function findByEmailInClient(email) {
  const trimmed = (email || '').trim();
  const normalized = trimmed.toLowerCase();
  const include = {
    company: { select: COMPANY_SELECT },
    almacen: { select: { id: true, nombre: true, codigo: true, companyRuc: true } },
  };

  const findUniqueUser = () => prisma.usuario.findUnique({
    where: { email: normalized },
    include,
  });
  let user = prisma.withDbRetry
    ? await prisma.withDbRetry(findUniqueUser)
    : await findUniqueUser();

  // Compat: emails guardados con mayúsculas (p. ej. Mili@gmail.com).
  if (!user && trimmed) {
    user = await prisma.usuario.findFirst({
      where: { email: { equals: normalized } },
      include,
    });
  }
  if (!user && trimmed && trimmed !== normalized) {
    user = await prisma.usuario.findUnique({
      where: { email: trimmed },
      include,
    });
  }
  if (!user && normalized) {
    const candidates = await prisma.usuario.findMany({
      where: { email: { contains: normalized.split('@')[0] || normalized } },
      include,
      take: 20,
    });
    user = candidates.find((u) => String(u.email || '').toLowerCase() === normalized) || null;
  }

  return user;
}

/**
 * Busca en beta y prod. Prefiere el match cuyo company.entorno coincide con la DB.
 * SUPER_ADMIN sin empresa → prod.
 */
async function findByEmail(email) {
  const [betaUser, prodUser] = await Promise.all([
    runWithEntorno('beta', () => findByEmailInClient(email)).then((u) => attachDbEntorno(u, 'beta')),
    runWithEntorno('prod', () => findByEmailInClient(email)).then((u) => attachDbEntorno(u, 'prod')),
  ]);

  const candidates = [betaUser, prodUser].filter(Boolean);
  if (!candidates.length) return null;
  if (candidates.length === 1) return candidates[0];

  const matched = candidates.find((u) => {
    if (!u.company) return u._dbEntorno === 'prod'; // SUPER_ADMIN → prod
    const companyProd = isProdEntorno(u.company.entorno);
    return companyProd === (u._dbEntorno === 'prod');
  });
  return matched || prodUser || betaUser;
}

async function findByEmailExceptId(email, id) {
  return prisma.usuario.findFirst({
    where: { email, NOT: { id } },
  });
}

async function findByIdInActive(id) {
  return prisma.usuario.findUnique({
    where: { id },
    include: {
      company: { select: COMPANY_SELECT },
      almacen: { select: { id: true, nombre: true, codigo: true, companyRuc: true } },
    },
  });
}

async function findById(id, entornoHint) {
  if (entornoHint) {
    const user = await runWithEntorno(entornoHint, () => findByIdInActive(id));
    return attachDbEntorno(user, entornoHint);
  }
  // Si ya hay contexto ALS (middleware), usarlo.
  const active = await findByIdInActive(id);
  if (active) return attachDbEntorno(active, active.company?.entorno || 'prod');

  const [betaUser, prodUser] = await Promise.all([
    runWithEntorno('beta', () => findByIdInActive(id)).then((u) => attachDbEntorno(u, 'beta')),
    runWithEntorno('prod', () => findByIdInActive(id)).then((u) => attachDbEntorno(u, 'prod')),
  ]);
  return prodUser || betaUser;
}

async function findByRefreshToken(refreshToken) {
  const include = {
    company: { select: COMPANY_SELECT },
    almacen: { select: { id: true, nombre: true, codigo: true, companyRuc: true } },
  };
  const findOne = () => prisma.usuario.findFirst({
    where: { refreshToken },
    include,
  });

  const [betaUser, prodUser] = await Promise.all([
    runWithEntorno('beta', findOne).then((u) => attachDbEntorno(u, 'beta')),
    runWithEntorno('prod', findOne).then((u) => attachDbEntorno(u, 'prod')),
  ]);
  return prodUser || betaUser;
}

function buildSearchWhere(q) {
  const term = (q || '').trim();
  if (!term) return {};

  const or = [
    { email: { contains: term } },
    { company: { is: { nombre: { contains: term } } } },
    { company: { is: { ruc: { contains: term } } } },
    { almacen: { is: { nombre: { contains: term } } } },
  ];

  const id = Number(term);
  if (Number.isInteger(id) && id > 0) {
    or.push({ id });
  }

  const estado = term.toUpperCase();
  if (['ACTIVO', 'INACTIVO', 'PENDIENTE', 'BLOQUEADO'].includes(estado)) {
    or.push({ estado });
  }

  const rol = term.toUpperCase();
  if (ROLES.includes(rol)) {
    or.push({ rol });
  }

  return { OR: or };
}

function mapListRow(row) {
  return {
    ...toPublicUser(row),
    companyNombre: row.company?.nombre ?? null,
    companyRuc: row.company?.ruc ?? null,
    companyEntornoReal: row.company?.entorno || null,
    hasSession: Boolean(row.token),
  };
}

async function findPaginated({
  q = '',
  companyId = null,
  page = 1,
  pageSize = 25,
  skip = 0,
}) {
  const searchWhere = buildSearchWhere(q);
  const where = { ...searchWhere };

  if (companyId === 'none') {
    where.companyId = null;
  } else if (companyId != null && companyId !== '') {
    const id = Number(companyId);
    if (Number.isInteger(id) && id > 0) {
      where.companyId = BigInt(id);
    }
  }

  const [total, rows] = await Promise.all([
    prisma.usuario.count({ where }),
    prisma.usuario.findMany({
      where,
      orderBy: { id: 'asc' },
      skip,
      take: pageSize,
      include: {
        company: { select: { id: true, nombre: true, ruc: true, entorno: true } },
        almacen: { select: { id: true, nombre: true, codigo: true } },
      },
    }),
  ]);

  return { total, items: rows.map(mapListRow) };
}

async function create({ email, contrasenaHash, companyId, estado, rol, almacenId }) {
  const row = await prisma.usuario.create({
    data: {
      email,
      contrasena: contrasenaHash,
      lastUpdated: BigInt(Date.now()),
      estado: estado || 'ACTIVO',
      rol: rol || 'USUARIO',
      ...(companyId !== undefined && companyId !== null && { companyId: BigInt(companyId) }),
      ...(almacenId ? { almacenId } : {}),
    },
  });
  return row;
}

async function update(id, data) {
  const { email, contrasenaHash, companyId, estado, rol, almacenId } = data;
  const patch = {
    ...(email !== undefined && { email }),
    ...(estado !== undefined && { estado }),
    ...(rol !== undefined && { rol }),
    ...(companyId !== undefined && {
      companyId: companyId ? BigInt(companyId) : null,
    }),
    ...(almacenId !== undefined && {
      almacenId: almacenId || null,
    }),
    lastUpdated: BigInt(Date.now()),
  };

  if (typeof contrasenaHash === 'string' && contrasenaHash.length > 0) {
    patch.contrasena = contrasenaHash;
  }

  return prisma.usuario.update({
    where: { id },
    data: patch,
  });
}

async function setEstado(id, estado) {
  const data = {
    estado,
    lastUpdated: BigInt(Date.now()),
  };

  if (estado !== 'ACTIVO') {
    Object.assign(data, { token: null, refreshToken: null });
  }

  return prisma.usuario.update({ where: { id }, data });
}

/** Usuarios de la empresa (para filtros de salidas/ingresos). */
async function findByCompanyRuc(companyRuc, { soloActivos = true } = {}) {
  const ruc = String(companyRuc || '').trim();
  if (!ruc) return [];
  const company = await prisma.company.findUnique({
    where: { ruc },
    select: { id: true },
  });
  if (!company) return [];

  const rows = await prisma.usuario.findMany({
    where: {
      companyId: company.id,
      ...(soloActivos ? { estado: 'ACTIVO' } : {}),
    },
    orderBy: { email: 'asc' },
    select: { id: true, email: true, rol: true },
  });

  return rows.map((u) => {
    const email = String(u.email || '').trim();
    const local = email.split('@')[0] || email;
    const nombre = local
      .replace(/[._-]+/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim();
    return {
      id: u.id,
      email,
      nombre: nombre || email,
      rol: u.rol,
    };
  });
}

function nombreDesdeEmail(email) {
  const value = String(email || '').trim();
  const local = value.split('@')[0] || value;
  return local
    .replace(/[._-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim() || value;
}

function toGestionApi(row) {
  if (!row) return null;
  const email = String(row.email || '').trim();
  return {
    id: row.id,
    email,
    nombre: nombreDesdeEmail(email),
    rol: row.rol,
    estado: row.estado,
    almacen_id: row.almacenId != null ? String(row.almacenId) : null,
    almacen_nombre: row.almacen?.nombre ?? null,
    almacenId: row.almacenId != null ? String(row.almacenId) : null,
    almacenNombre: row.almacen?.nombre ?? null,
  };
}

/** Usuarios de la empresa para gestión (ADMIN de empresa). Excluye SUPER_ADMIN. */
async function findGestionByCompanyRuc(companyRuc) {
  const ruc = String(companyRuc || '').trim();
  if (!ruc) return [];
  const company = await prisma.company.findUnique({
    where: { ruc },
    select: { id: true },
  });
  if (!company) return [];

  const rows = await prisma.usuario.findMany({
    where: {
      companyId: company.id,
      rol: { not: 'SUPER_ADMIN' },
    },
    orderBy: [{ rol: 'asc' }, { email: 'asc' }],
    include: {
      almacen: { select: { id: true, nombre: true, codigo: true } },
    },
  });
  return rows.map(toGestionApi);
}

async function countAdminsActivos(companyId, exceptUserId = null) {
  if (!companyId) return 0;
  return prisma.usuario.count({
    where: {
      companyId: BigInt(companyId),
      rol: 'ADMIN',
      estado: 'ACTIVO',
      ...(exceptUserId != null ? { id: { not: Number(exceptUserId) } } : {}),
    },
  });
}

async function remove(id) {
  return prisma.usuario.delete({ where: { id } });
}

async function saveTokens(id, { token, refreshToken }) {
  return prisma.usuario.update({
    where: { id },
    data: {
      token,
      refreshToken,
      lastUpdated: BigInt(Date.now()),
    },
  });
}

async function clearTokens(id) {
  return prisma.usuario.update({
    where: { id },
    data: {
      token: null,
      refreshToken: null,
      lastUpdated: BigInt(Date.now()),
    },
  });
}

module.exports = {
  ROLES,
  toPublicUser,
  findByEmail,
  findByEmailExceptId,
  findById,
  findByRefreshToken,
  findPaginated,
  findByCompanyRuc,
  findGestionByCompanyRuc,
  toGestionApi,
  countAdminsActivos,
  create,
  update,
  setEstado,
  remove,
  saveTokens,
  clearTokens,
};

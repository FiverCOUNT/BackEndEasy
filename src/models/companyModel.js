const { randomUUID } = require('crypto');
const prisma = require('../config/prisma');
const { runWithEntorno, isProdEntorno } = require('../config/prisma');
const {
  toAddressSnapshot,
  toAddressApi,
  registerCatalogAddress,
} = require('../utils/addressHelper');
const {
  buildSeriesConfigFromBody,
  seriesConfigToFormFields,
  normalizeStoredSeriesConfig,
} = require('../utils/seriesConfig');

function dbKeyFromEntorno(entorno) {
  return isProdEntorno(entorno) ? 'prod' : 'beta';
}

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
    creadoEn: company.creadoEn,
    addressId: null,
    solUser: company.solUser,
    clientId: company.clientId,
    tieneCertificado: company.tieneCertificado,
    rutaFirma: company.rutaFirma,
    rutaLogo: company.rutaLogo || null,
    nameLogo: company.nameLogo || null,
    logoUrl: resolveLogoUrl(company),
    tieneSolPass: Boolean(company.solPass),
    tieneClientSecret: Boolean(company.clientSecret),
    tieneCertificatePassword: Boolean(company.certificatePassword),
    nroMtc: company.nroMtc || null,
    nro_mtc: company.nroMtc || null,
    seriesConfig: normalizeStoredSeriesConfig(company.seriesConfigJson),
    usuariosCount: company._count?.usuarios ?? 0,
    address: (() => {
      const addr = toAddressApi(company.addressJson || company.address);
      if (!addr) return null;
      return {
        ubigeo: addr.ubigeo,
        departamento: addr.departamento,
        provincia: addr.provincia,
        distrito: addr.distrito,
        direccion: addr.direccion,
        codLocal: addr.cod_local,
      };
    })(),
  };
}

/** URL pública del logo (http, key R2 o ruta local /storage/...). */
function resolveLogoUrl(company) {
  if (!company) return null;
  const raw = String(company.rutaLogo || company.logoUrl || '').trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith('/storage/')) return raw;
  if (raw.startsWith('local:')) {
    const rest = raw.slice('local:'.length).replace(/^\/+/, '');
    if (rest.startsWith('logos/')) return `/storage/${rest}`;
    const file = rest.split('/').pop() || 'logo.png';
    return `/storage/configuracion/${file}`;
  }
  try {
    const { buildPublicUrl } = require('../services/objectStorageService');
    return buildPublicUrl(raw) || null;
  } catch {
    return null;
  }
}

async function updateLogoByRuc(companyRuc, { rutaLogo, nameLogo }) {
  const ruc = String(companyRuc || '').replace(/\D/g, '');
  if (!ruc) return null;
  const row = await findByRuc(ruc);
  if (!row) return null;
  return prisma.company.update({
    where: { id: row.id },
    data: {
      rutaLogo: rutaLogo || null,
      nameLogo: nameLogo || null,
    },
  });
}

function displayName(company) {
  if (!company) return 'Empresa';
  const comercial = String(company.nombreComercial || '').trim();
  const razon = String(company.nombre || '').trim();
  return comercial || razon || 'Empresa';
}

function entornoLabel(entorno) {
  const value = String(entorno || 'beta').toLowerCase();
  if (value === 'prod' || value === 'production') {
    return { key: 'prod', label: 'Producción', isProd: true };
  }
  return { key: 'beta', label: 'Beta', isProd: false };
}

function initialsFromName(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => !/^(s\.?a\.?c\.?|s\.?a\.?|e\.?i\.?r\.?l\.?|s\.?r\.?l\.?|de|del|la|las|los|y|&)$/i.test(w));
  if (!parts.length) return 'E';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function buildAddressData(body) {
  return toAddressSnapshot({
    ...body,
    codLocal: body.codLocal || body.cod_local,
  });
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

async function findPaginated({ q = '', page = 1, pageSize = 25, skip = 0, entorno = null } = {}) {
  const where = buildSearchWhere(q);
  const include = { _count: { select: { usuarios: true } } };

  if (entorno === 'prod' || entorno === 'beta') {
    return runWithEntorno(entorno, async () => {
      const [total, rows] = await Promise.all([
        prisma.company.count({ where }),
        prisma.company.findMany({
          where,
          orderBy: { id: 'asc' },
          include,
          skip,
          take: pageSize,
        }),
      ]);
      return { total, items: rows.map(toPublic) };
    });
  }

  const [betaRows, prodRows] = await Promise.all([
    runWithEntorno('beta', () =>
      prisma.company.findMany({ where, orderBy: { id: 'asc' }, include })),
    runWithEntorno('prod', () =>
      prisma.company.findMany({ where, orderBy: { id: 'asc' }, include })),
  ]);

  // Preferir fila cuyo entorno coincide con la DB (evitar duplicados post-copia).
  const byRuc = new Map();
  for (const row of betaRows) {
    if (!isProdEntorno(row.entorno)) byRuc.set(row.ruc, row);
  }
  for (const row of prodRows) {
    if (isProdEntorno(row.entorno) || !byRuc.has(row.ruc)) byRuc.set(row.ruc, row);
  }

  const merged = Array.from(byRuc.values()).sort((a, b) => Number(a.id) - Number(b.id));
  const total = merged.length;
  const pageRows = merged.slice(skip, skip + pageSize);
  return { total, items: pageRows.map(toPublic) };
}

async function findById(id, entornoHint) {
  const include = { _count: { select: { usuarios: true } } };
  if (entornoHint === 'prod' || entornoHint === 'beta') {
    const row = await runWithEntorno(entornoHint, () =>
      prisma.company.findUnique({ where: { id: BigInt(id) }, include }));
    if (!row) return null;
    row._dbEntorno = entornoHint;
    return row;
  }
  const [beta, prod] = await Promise.all([
    runWithEntorno('beta', () =>
      prisma.company.findUnique({ where: { id: BigInt(id) }, include })),
    runWithEntorno('prod', () =>
      prisma.company.findUnique({ where: { id: BigInt(id) }, include })),
  ]);
  if (prod && isProdEntorno(prod.entorno)) {
    prod._dbEntorno = 'prod';
    return prod;
  }
  if (beta && !isProdEntorno(beta.entorno)) {
    beta._dbEntorno = 'beta';
    return beta;
  }
  if (prod) {
    prod._dbEntorno = 'prod';
    return prod;
  }
  if (beta) {
    beta._dbEntorno = 'beta';
    return beta;
  }
  return null;
}

async function findByRucInClient(ruc) {
  const value = String(ruc || '').trim();
  if (!value) return null;
  const rows = await prisma.company.findMany({
    where: { ruc: value },
    take: 20,
  });
  if (!rows.length) return null;
  rows.sort((a, b) => {
    const aAct = a.activo === true ? 0 : 1;
    const bAct = b.activo === true ? 0 : 1;
    if (aAct !== bAct) return aAct - bAct;
    const aCred = a.solUser || a.clientId ? 0 : 1;
    const bCred = b.solUser || b.clientId ? 0 : 1;
    if (aCred !== bCred) return aCred - bCred;
    return Number(a.id) - Number(b.id);
  });
  return rows[0];
}

/**
 * Busca por RUC en la DB activa (ALS). Si no hay contexto, prefiere la del entorno de la empresa.
 */
async function findByRuc(ruc, { both = false } = {}) {
  if (!both) {
    return findByRucInClient(ruc);
  }
  const [beta, prod] = await Promise.all([
    runWithEntorno('beta', () => findByRucInClient(ruc)),
    runWithEntorno('prod', () => findByRucInClient(ruc)),
  ]);
  if (prod && isProdEntorno(prod.entorno)) return prod;
  if (beta && !isProdEntorno(beta.entorno)) return beta;
  return prod || beta;
}

async function findByRucExceptId(ruc, id, { both = false } = {}) {
  const exceptId = BigInt(id);
  const findOne = () => prisma.company.findFirst({
    where: { ruc, NOT: { id: exceptId } },
  });
  if (!both) return findOne();
  const [beta, prod] = await Promise.all([
    runWithEntorno('beta', findOne),
    runWithEntorno('prod', findOne),
  ]);
  return prod || beta;
}

async function findByRucAcrossDbs(ruc) {
  return findByRuc(ruc, { both: true });
}

async function findByRucExceptIdAcrossDbs(ruc, id) {
  return findByRucExceptId(ruc, id, { both: true });
}

async function create(body, { certFile = null } = {}) {
  const companyData = buildCompanyData(body, { keepEmptyPasswords: false });
  const dbKey = dbKeyFromEntorno(companyData.entorno || body.entorno || 'beta');

  return runWithEntorno(dbKey, async () => {
    const snapshot = buildAddressData(body);
    if (snapshot) {
      snapshot.ubigeo = normalizeUbigeoForStorage(snapshot.ubigeo) || snapshot.ubigeo;
    }

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
      companyData.addressJson = snapshot;
      const row = await tx.company.create({ data: companyData });
      if (snapshot) {
        await registerCatalogAddress(tx, {
          companyRuc: companyData.ruc,
          snapshot,
          etiqueta: `Sede · ${snapshot.distrito || snapshot.direccion || companyData.nombre || ''}`.slice(0, 120),
        });
      }
      return tx.company.findUnique({ where: { id: row.id } });
    });
  });
}

async function update(id, body, { certFile = null, existing = null } = {}) {
  const current = existing || (await findById(id));
  if (!current) return null;

  const targetEntorno = body.entorno != null ? body.entorno : current.entorno;
  const homeDb = current._dbEntorno || dbKeyFromEntorno(current.entorno);
  const nextDb = dbKeyFromEntorno(targetEntorno);

  const saved = await runWithEntorno(homeDb, async () => {
    const companyData = buildCompanyData(body, { existing: current, keepEmptyPasswords: true });
    const snapshot = buildAddressData(body);
    if (snapshot) {
      snapshot.ubigeo = normalizeUbigeoForStorage(snapshot.ubigeo) || snapshot.ubigeo;
    }

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
      if (snapshot !== undefined && (body.ubigeo !== undefined || body.direccion !== undefined
        || body.departamento !== undefined || body.address)) {
        companyData.addressJson = snapshot;
        if (snapshot) {
          await registerCatalogAddress(tx, {
            companyRuc: companyData.ruc || current.ruc,
            snapshot,
            etiqueta: `Sede · ${snapshot.distrito || snapshot.direccion || companyData.nombre || current.nombre || ''}`.slice(0, 120),
          });
        }
      }

      return tx.company.update({
        where: { id: BigInt(id) },
        data: companyData,
        include: { _count: { select: { usuarios: true } } },
      });
    });
  });

  const ruc = String(saved?.ruc || current.ruc || '').trim();
  if (ruc) {
    await asegurarEntornoEnDestino(ruc, nextDb, homeDb);
  }
  return saved;
}

/**
 * Beta usa la base de prueba. Prod usa db_easy.
 * Marca ese entorno en ambas copias del RUC. Si el destino aún no tiene la empresa,
 * copia la ficha y sus usuarios (sin facturas) para que el login entre ahí.
 */
async function asegurarEntornoEnDestino(ruc, nextDb, homeDb) {
  const entorno = nextDb === 'prod' ? 'prod' : 'beta';
  const usuarios = await runWithEntorno(homeDb, async () => {
    const company = await prisma.company.findFirst({ where: { ruc }, select: { id: true } });
    if (!company) return [];
    return prisma.usuario.findMany({
      where: { companyId: company.id },
      select: {
        email: true,
        contrasena: true,
        estado: true,
        rol: true,
      },
    });
  });

  for (const db of ['beta', 'prod']) {
    await runWithEntorno(db, async () => {
      let company = await prisma.company.findFirst({ where: { ruc } });
      if (!company && db === entorno) {
        const origen = await runWithEntorno(homeDb, () => prisma.company.findFirst({ where: { ruc } }));
        if (!origen) return;
        const data = { ...origen };
        delete data.id;
        data.entorno = entorno;
        company = await prisma.company.create({ data });
      }
      if (!company) return;
      if (company.entorno !== entorno) {
        company = await prisma.company.update({
          where: { id: company.id },
          data: { entorno },
        });
      }
      if (db !== entorno) return;
      for (const user of usuarios) {
        const email = String(user.email || '').trim().toLowerCase();
        if (!email) continue;
        const ya = await prisma.usuario.findUnique({ where: { email } });
        if (ya) continue;
        try {
          await prisma.usuario.create({
            data: {
              email,
              contrasena: user.contrasena,
              estado: user.estado,
              rol: user.rol,
              companyId: company.id,
              lastUpdated: BigInt(Date.now()),
            },
          });
        } catch (_) {
          // El correo ya existe en esa base (mayúsculas distintas).
        }
      }
    });
  }
}

async function setActive(id, active, entornoHint) {
  const current = await findById(id, entornoHint);
  if (!current) return null;
  const homeDb = current._dbEntorno || dbKeyFromEntorno(current.entorno);
  return runWithEntorno(homeDb, () =>
    prisma.company.update({
      where: { id: BigInt(id) },
      data: { activo: active },
    }));
}

async function countCompanyBusinessData(companyRuc, homeDb) {
  return runWithEntorno(homeDb, async () => {
    const ruc = String(companyRuc || '').trim();
    if (!ruc) return {};
    const [
      almacenes,
      catalogItems,
      invoices,
      compras,
      movimientos,
      clientes,
      ordenes,
    ] = await Promise.all([
      prisma.almacen.count({ where: { companyRuc: ruc } }).catch(() => 0),
      prisma.catalogItem.count({ where: { companyRuc: ruc } }).catch(() => 0),
      prisma.invoice.count({ where: { companyRuc: ruc } }).catch(() => 0),
      prisma.compra.count({ where: { companyRuc: ruc } }).catch(() => 0),
      prisma.movimiento.count({ where: { companyRuc: ruc } }).catch(() => 0),
      prisma.cliente.count({ where: { companyRuc: ruc } }).catch(() => 0),
      prisma.orden.count({ where: { companyRuc: ruc } }).catch(() => 0),
    ]);
    return { almacenes, catalogItems, invoices, compras, movimientos, clientes, ordenes };
  });
}

async function remove(id, entornoHint) {
  const company = await findById(id, entornoHint);
  if (!company) return { error: 'not_found' };
  if (company._count?.usuarios > 0) return { error: 'has_users' };

  const homeDb = company._dbEntorno || dbKeyFromEntorno(company.entorno);
  const related = await countCompanyBusinessData(company.ruc, homeDb);
  const hasData = Object.values(related).some((n) => Number(n) > 0);
  if (hasData) {
    return { error: 'has_data', related };
  }

  await runWithEntorno(homeDb, () =>
    prisma.company.delete({ where: { id: BigInt(id) } }));
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

function buildWhereTransporte({ q = null, soloConMtc = false } = {}) {
  const search = buildSearchWhereTransporte(q);
  return {
    AND: [
      { ruc: { not: '' } },
      { OR: [{ activo: true }, { activo: null }] },
      ...(soloConMtc ? [{ NOT: { nroMtc: null } }, { nroMtc: { not: '' } }] : []),
      ...(Object.keys(search).length ? [search] : []),
    ],
  };
}

/** Catálogo de empresas (companies) para elegir transportista en GRE.
 * Sin filtro: todas con RUC. Con soloConMtc: las que tienen nro_mtc (típicas de transporte).
 */
async function listForTransporte({
  q = null,
  soloConMtc = false,
  skip = 0,
  take = 200,
} = {}) {
  const finalWhere = buildWhereTransporte({ q, soloConMtc });
  const limit = Math.min(Math.max(Number(take) || 200, 1), 200);
  const offset = Math.max(0, Number(skip) || 0);
  return prisma.company.findMany({
    where: finalWhere,
    orderBy: [{ nroMtc: 'desc' }, { nombre: 'asc' }],
    skip: offset,
    take: limit,
    include: { _count: { select: { usuarios: true } } },
  });
}

async function countForTransporte({ q = null, soloConMtc = false } = {}) {
  return prisma.company.count({ where: buildWhereTransporte({ q, soloConMtc }) });
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
      include: { _count: { select: { usuarios: true } } },
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
    },
    include: { _count: { select: { usuarios: true } } },
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
    include: { _count: { select: { usuarios: true } } },
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
  resolveLogoUrl,
  displayName,
  entornoLabel,
  initialsFromName,
  updateLogoByRuc,
  findPaginated,
  findById,
  findByRuc,
  findByRucExceptId,
  findByRucAcrossDbs,
  findByRucExceptIdAcrossDbs,
  create,
  update,
  updateNroMtcByRuc,
  listForTransporte,
  countForTransporte,
  upsertTransporte,
  updateTransporte,
  removeTransporteIfSafe,
  setActive,
  remove,
};

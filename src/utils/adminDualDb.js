const prisma = require('../config/prisma');
const { runWithEntorno, isProdEntorno } = require('../config/prisma');

function dbKeyFromCompany(company) {
  if (!company) return 'prod';
  if (company._dbEntorno === 'beta' || company._dbEntorno === 'prod') {
    return company._dbEntorno;
  }
  return isProdEntorno(company.entorno) ? 'prod' : 'beta';
}

/** Empresas de ambas DBs (sin duplicar RUC: beta↔prod según entorno). */
async function loadCompaniesMerged() {
  const select = { id: true, nombre: true, ruc: true, entorno: true };
  const [beta, prod] = await Promise.all([
    runWithEntorno('beta', () =>
      prisma.company.findMany({ select, orderBy: { id: 'asc' } })),
    runWithEntorno('prod', () =>
      prisma.company.findMany({ select, orderBy: { id: 'asc' } })),
  ]);
  const byRuc = new Map();
  for (const row of beta) {
    if (!isProdEntorno(row.entorno)) {
      byRuc.set(row.ruc, { ...row, _dbEntorno: 'beta' });
    }
  }
  for (const row of prod) {
    if (isProdEntorno(row.entorno) || !byRuc.has(row.ruc)) {
      byRuc.set(row.ruc, { ...row, _dbEntorno: 'prod' });
    }
  }
  return Array.from(byRuc.values()).sort((a, b) => Number(a.id) - Number(b.id));
}

/** Almacenes de ambas DBs. */
async function loadAlmacenesMerged() {
  const select = {
    id: true,
    nombre: true,
    codigo: true,
    companyRuc: true,
    activo: true,
  };
  const [beta, prod] = await Promise.all([
    runWithEntorno('beta', () =>
      prisma.almacen.findMany({
        select,
        orderBy: [{ companyRuc: 'asc' }, { nombre: 'asc' }],
      })),
    runWithEntorno('prod', () =>
      prisma.almacen.findMany({
        select,
        orderBy: [{ companyRuc: 'asc' }, { nombre: 'asc' }],
      })),
  ]);
  const byKey = new Map();
  for (const row of [...beta.map((a) => ({ ...a, _dbEntorno: 'beta' })), ...prod.map((a) => ({ ...a, _dbEntorno: 'prod' }))]) {
    byKey.set(`${row._dbEntorno}:${row.id}`, row);
  }
  return Array.from(byKey.values());
}

async function findCompanyMergedById(companyId) {
  const id = Number(companyId);
  if (!Number.isInteger(id) || id < 1) return null;
  const companies = await loadCompaniesMerged();
  return companies.find((c) => Number(c.id) === id) || null;
}

async function runWithCompanyId(companyId, fn) {
  const company = await findCompanyMergedById(companyId);
  const dbKey = company ? dbKeyFromCompany(company) : 'prod';
  return runWithEntorno(dbKey, () => fn(company));
}

async function runWithCompanyRuc(companyRuc, fn) {
  const ruc = String(companyRuc || '').trim();
  const companies = await loadCompaniesMerged();
  const company = companies.find((c) => c.ruc === ruc) || null;
  const dbKey = company ? dbKeyFromCompany(company) : 'prod';
  return runWithEntorno(dbKey, () => fn(company));
}

/**
 * Busca un registro en prod y beta (admin ALS es prod).
 * Si hay ambos, elige el cuyo companyRuc pertenece a esa DB.
 */
async function findAcrossDbs(findFn, { companyRucOf } = {}) {
  const [prodRow, betaRow] = await Promise.all([
    runWithEntorno('prod', findFn),
    runWithEntorno('beta', findFn),
  ]);
  const candidates = [];
  if (prodRow) candidates.push({ row: prodRow, db: 'prod' });
  if (betaRow) candidates.push({ row: betaRow, db: 'beta' });
  if (!candidates.length) return null;
  if (candidates.length === 1) return candidates[0];

  const companies = await loadCompaniesMerged();
  for (const c of candidates) {
    const ruc = String(
      (typeof companyRucOf === 'function' ? companyRucOf(c.row) : null)
      || c.row.companyRuc
      || c.row.company_ruc
      || '',
    ).trim();
    if (!ruc) continue;
    const company = companies.find((co) => co.ruc === ruc);
    if (company && dbKeyFromCompany(company) === c.db) return c;
  }
  return { row: prodRow, db: 'prod' };
}

module.exports = {
  loadCompaniesMerged,
  loadAlmacenesMerged,
  findCompanyMergedById,
  runWithCompanyId,
  runWithCompanyRuc,
  findAcrossDbs,
  dbKeyFromCompany,
};

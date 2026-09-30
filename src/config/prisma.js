require('./env');
const { AsyncLocalStorage } = require('async_hooks');
const { PrismaClient } = require('@prisma/client');
const { buildProdDatabaseUrl, buildTestDatabaseUrl } = require('./env');

const globalForPrisma = globalThis;
const dbContext = new AsyncLocalStorage();

function createPrisma(url) {
  return new PrismaClient({
    datasources: { db: { url } },
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });
}

const prismaProd =
  globalForPrisma.__easyPrismaProd || createPrisma(buildProdDatabaseUrl());
const prismaBeta =
  globalForPrisma.__easyPrismaBeta || createPrisma(buildTestDatabaseUrl());

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__easyPrismaProd = prismaProd;
  globalForPrisma.__easyPrismaBeta = prismaBeta;
}

function isProdEntorno(entorno) {
  const v = String(entorno || 'beta').toLowerCase();
  return v === 'prod' || v === 'production';
}

function clientForEntorno(entorno) {
  return isProdEntorno(entorno) ? prismaProd : prismaBeta;
}

function getActivePrisma() {
  return dbContext.getStore()?.prisma || prismaProd;
}

function runWithEntorno(entorno, fn) {
  return dbContext.run({ prisma: clientForEntorno(entorno), entorno }, fn);
}

function runWithPrisma(client, fn) {
  return dbContext.run({ prisma: client }, fn);
}

/** Sticky para middleware Express (ALS no se pierde al salir del middleware). */
function enterWithEntorno(entorno) {
  dbContext.enterWith({ prisma: clientForEntorno(entorno), entorno });
}

const RETRY_CODES = new Set(['P2024', 'P1017', 'P1008', 'P1001']);

async function disconnectPrisma() {
  await Promise.allSettled([prismaProd.$disconnect(), prismaBeta.$disconnect()]);
}

async function withDbRetry(fn) {
  try {
    return await fn();
  } catch (err) {
    if (!RETRY_CODES.has(err?.code) && !RETRY_CODES.has(err?.errorCode)) throw err;
    const active = getActivePrisma();
    try {
      await active.$disconnect();
    } catch (_) {
      // ignore
    }
    await active.$connect();
    return fn();
  }
}

/** Proxy: todo `prisma.*` usa el cliente del entorno activo (AsyncLocalStorage). */
const prisma = new Proxy(
  {},
  {
    get(_target, prop) {
      if (prop === 'withDbRetry') return withDbRetry;
      if (prop === 'disconnectPrisma' || prop === '$disconnect') return disconnectPrisma;
      if (prop === 'runWithEntorno') return runWithEntorno;
      if (prop === 'runWithPrisma') return runWithPrisma;
      if (prop === 'enterWithEntorno') return enterWithEntorno;
      if (prop === 'clientForEntorno') return clientForEntorno;
      if (prop === 'isProdEntorno') return isProdEntorno;
      if (prop === 'prismaProd') return prismaProd;
      if (prop === 'prismaBeta') return prismaBeta;
      if (prop === 'getActivePrisma') return getActivePrisma;
      const client = getActivePrisma();
      const value = client[prop];
      return typeof value === 'function' ? value.bind(client) : value;
    },
  },
);

process.once('beforeExit', () => {
  disconnectPrisma().catch(() => {});
});

module.exports = prisma;
module.exports.runWithEntorno = runWithEntorno;
module.exports.runWithPrisma = runWithPrisma;
module.exports.enterWithEntorno = enterWithEntorno;
module.exports.clientForEntorno = clientForEntorno;
module.exports.isProdEntorno = isProdEntorno;
module.exports.prismaProd = prismaProd;
module.exports.prismaBeta = prismaBeta;
module.exports.getActivePrisma = getActivePrisma;
module.exports.withDbRetry = withDbRetry;
module.exports.disconnectPrisma = disconnectPrisma;

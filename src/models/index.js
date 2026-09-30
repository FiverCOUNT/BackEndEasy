const prisma = require('../config/prisma');

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function initDatabase() {
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await prisma.$connect();
      console.log('MySQL conectado (Prisma) — tablas listas');
      return;
    } catch (err) {
      lastErr = err;
      const code = err?.code || err?.errorCode || '';
      console.warn(`MySQL intento ${attempt}/3 falló (${code || 'sin código'}). Reintento…`);
      await prisma.$disconnect().catch(() => {});
      await sleep(1200 * attempt);
    }
  }
  throw lastErr;
}

module.exports = {
  prisma,
  initDatabase,
};

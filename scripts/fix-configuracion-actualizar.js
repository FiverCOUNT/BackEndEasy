require('dotenv').config({ path: '.env', override: true });
delete process.env.DATABASE_URL;
require('../src/config/env');
const prisma = require('../src/config/prisma');

async function main() {
  const cols = await prisma.$queryRaw`SHOW COLUMNS FROM configuracion LIKE 'actualizar'`;
  if (cols.length === 0) {
    await prisma.$executeRawUnsafe(
      'ALTER TABLE `configuracion` ADD COLUMN `actualizar` BOOLEAN NOT NULL DEFAULT false'
    );
    console.log('Columna actualizar creada.');
  } else {
    console.log('Columna actualizar ya existe.');
  }
}

main()
  .catch((e) => {
    console.error('Error:', e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

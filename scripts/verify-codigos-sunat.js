require('../src/config/env');
const prisma = require('../src/config/prisma');

(async () => {
  const total = await prisma.codigoProductoSunat.count();
  const sample = await prisma.codigoProductoSunat.findMany({
    where: { nombre: { contains: 'cemento' } },
    take: 3,
  });
  console.log('total', total);
  console.log('sample', sample);
})()
  .finally(() => prisma.$disconnect());

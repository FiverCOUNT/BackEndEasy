require('../src/config/env');
const prisma = require('../src/config/prisma');

async function main() {
  const c = await prisma.company.findFirst({
    where: { ruc: '20611016591' },
    select: {
      ruc: true,
      nombre: true,
      entorno: true,
      clientId: true,
      clientSecret: true,
      solUser: true,
      solPass: true,
      sireClientId: true,
      sireClientSecret: true,
      sireEnabled: true,
    },
  });
  console.log(JSON.stringify({
    ...c,
    clientId: c?.clientId ? `${String(c.clientId).slice(0, 8)}…` : null,
    clientSecret: c?.clientSecret ? '(set)' : null,
    solPass: c?.solPass ? '(set)' : null,
    sireClientId: c?.sireClientId ? `${String(c.sireClientId).slice(0, 8)}…` : null,
    sireClientSecret: c?.sireClientSecret ? '(set)' : null,
  }, null, 2));
}

main().finally(() => prisma.$disconnect());

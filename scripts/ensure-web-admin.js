/**
 * Crea o actualiza el ADMIN del panel web (sin empresa).
 *
 * Uso:
 *   node scripts/ensure-web-admin.js
 *   WEB_ADMIN_EMAIL=tu@email.com WEB_ADMIN_PASSWORD=ClaveSegura node scripts/ensure-web-admin.js
 */
require('../src/config/env');
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const email = String(process.env.WEB_ADMIN_EMAIL || 'admin@factapp.local')
  .trim()
  .toLowerCase();
const password = String(process.env.WEB_ADMIN_PASSWORD || 'Admin123!');

async function main() {
  if (password.length < 6) {
    throw new Error('WEB_ADMIN_PASSWORD debe tener al menos 6 caracteres');
  }

  const hash = await bcrypt.hash(password, 10);
  const existing = await prisma.usuario.findUnique({ where: { email } });

  if (existing) {
    await prisma.usuario.update({
      where: { id: existing.id },
      data: {
        contrasena: hash,
        rol: 'ADMIN',
        estado: 'ACTIVO',
        companyId: null,
        almacenId: null,
        lastUpdated: BigInt(Date.now()),
        token: null,
        refreshToken: null,
      },
    });
    console.log(`Admin actualizado: ${email}`);
  } else {
    await prisma.usuario.create({
      data: {
        email,
        contrasena: hash,
        rol: 'ADMIN',
        estado: 'ACTIVO',
        lastUpdated: BigInt(Date.now()),
      },
    });
    console.log(`Admin creado: ${email}`);
  }

  console.log('Contraseña:', password);
  console.log('Entra al panel en /login');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

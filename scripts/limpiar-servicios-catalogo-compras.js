/**
 * Elimina ítems SERVICE auto-creados al importar compras (código CMP-*).
 * Las líneas de factura recibida siguen en sale_details; solo se desvincula catalog_item_id.
 *
 *   node scripts/limpiar-servicios-catalogo-compras.js [RUC]
 */
require('../src/config/env');
const prisma = require('../src/config/prisma');

async function main() {
  const rucArg = String(process.argv[2] || '').replace(/\D/g, '');
  const where = {
    kind: 'SERVICE',
    codigo: { startsWith: 'CMP-' },
  };
  if (rucArg.length === 11) {
    where.companyRuc = rucArg;
  }

  const candidatos = await prisma.catalogItem.findMany({
    where,
    select: {
      id: true,
      companyRuc: true,
      codigo: true,
      nombre: true,
      _count: {
        select: {
          productoSeries: true,
          saleDetails: true,
          lineasCatalogo: true,
          inventario: true,
        },
      },
    },
  });

  let eliminados = 0;
  let omitidos = 0;

  for (const item of candidatos) {
    const { productoSeries, lineasCatalogo, inventario } = item._count;
    if (productoSeries > 0 || lineasCatalogo > 0 || inventario > 0) {
      omitidos += 1;
      continue;
    }
    await prisma.catalogItem.delete({ where: { id: item.id } });
    eliminados += 1;
    console.log(`- ${item.codigo} · ${item.nombre}`);
  }

  console.log(`\nEliminados: ${eliminados}. Omitidos (con inventario/movimientos): ${omitidos}.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

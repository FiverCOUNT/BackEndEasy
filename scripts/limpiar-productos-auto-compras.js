/**
 * Elimina ítems PRODUCT auto-creados al importar compras (código CMP- / nombre Compra ·).
 * Solo si no tienen inventario/series/movimientos.
 *
 *   node scripts/limpiar-productos-auto-compras.js [RUC]
 */
require('../src/config/env');
const prisma = require('../src/config/prisma');

async function main() {
  const rucArg = String(process.argv[2] || '').replace(/\D/g, '');
  const where = {
    kind: 'PRODUCT',
    OR: [
      { codigo: { startsWith: 'CMP-' } },
      { nombre: { startsWith: 'Compra ·' } },
    ],
  };
  if (rucArg.length === 11) where.companyRuc = rucArg;

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
  let desvinculados = 0;
  let omitidos = 0;

  for (const item of candidatos) {
    const { productoSeries, lineasCatalogo, inventario, saleDetails } = item._count;
    if (productoSeries > 0 || lineasCatalogo > 0 || inventario > 0) {
      omitidos += 1;
      continue;
    }
    if (saleDetails > 0) {
      await prisma.saleDetail.updateMany({
        where: { catalogItemId: item.id },
        data: { catalogItemId: null },
      });
      desvinculados += saleDetails;
    }
    await prisma.catalogItem.delete({ where: { id: item.id } });
    eliminados += 1;
    console.log(`- ${item.codigo || '(sin código)'} · ${item.nombre}`);
  }

  console.log(
    `\nEliminados: ${eliminados}. Desvinculados de facturas: ${desvinculados}. Omitidos: ${omitidos}.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

/**
 * Elimina solo comprobantes (invoices + líneas/leyendas) y clientes.
 * Conserva: empresas, usuarios, catálogo, almacenes, inventario, movimientos.
 */
require('../src/config/env');
const prisma = require('../src/config/prisma');

async function logStep(label, fn) {
  const result = await fn();
  const count = result?.count ?? result;
  console.log(`${label}: ${count}`);
  return result;
}

async function main() {
  const invoicesBefore = await prisma.invoice.count();
  const clientesBefore = await prisma.cliente.count();

  if (invoicesBefore === 0 && clientesBefore === 0) {
    console.log('No hay comprobantes ni clientes en la BD.');
    return;
  }

  console.log(`Comprobantes a eliminar: ${invoicesBefore}`);
  console.log(`Clientes a eliminar: ${clientesBefore}\n`);

  if (invoicesBefore > 0) {
    await logStep('invoices.documentoAfectadoId limpiado', () =>
      prisma.invoice.updateMany({ data: { documentoAfectadoId: null } }),
    );
    await logStep('sale_details', () => prisma.saleDetail.deleteMany());
    await logStep('legends', () => prisma.legend.deleteMany());
    await logStep('invoices', () => prisma.invoice.deleteMany());
  }

  if (clientesBefore > 0) {
    const clienteAddresses = await prisma.cliente.findMany({
      where: { addressId: { not: null } },
      select: { addressId: true },
    });
    const addressIds = [
      ...new Set(clienteAddresses.map((row) => row.addressId).filter(Boolean)),
    ];

    await logStep('movimientos.clienteId limpiado', () =>
      prisma.movimiento.updateMany({ data: { clienteId: null } }),
    );
    await logStep('clientes', () => prisma.cliente.deleteMany());

    if (addressIds.length > 0) {
      const stillUsed = new Set();
      const [companies, almacenes, ubicaciones] = await Promise.all([
        prisma.company.findMany({
          where: { addressId: { in: addressIds } },
          select: { addressId: true },
        }),
        prisma.almacen.findMany({
          where: { addressId: { in: addressIds } },
          select: { addressId: true },
        }),
        prisma.address.findMany({
          where: {
            id: { in: addressIds },
            companyRuc: { not: null },
            etiqueta: { not: null },
          },
          select: { id: true },
        }),
      ]);
      for (const row of companies) {
        if (row.addressId) stillUsed.add(row.addressId);
      }
      for (const row of almacenes) {
        if (row.addressId) stillUsed.add(row.addressId);
      }
      for (const row of ubicaciones) {
        if (row.id) stillUsed.add(row.id);
      }
      const orphanIds = addressIds.filter((id) => !stillUsed.has(id));
      if (orphanIds.length > 0) {
        await logStep('addresses de clientes', () =>
          prisma.address.deleteMany({ where: { id: { in: orphanIds } } }),
        );
      }
    }
  }

  const invoicesAfter = await prisma.invoice.count();
  const clientesAfter = await prisma.cliente.count();
  console.log(`\nQuedan ${invoicesAfter} comprobante(s) y ${clientesAfter} cliente(s).`);
  console.log('Listo.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

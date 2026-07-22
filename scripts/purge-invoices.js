/**
 * Purga todos los comprobantes (invoices) y enlaces relacionados.
 * Conserva empresas, usuarios, catálogo, almacenes, clientes.
 */
require('../src/config/env');
const prisma = require('../src/config/prisma');

async function step(label, fn) {
  const result = await fn();
  const count = result?.count ?? result;
  console.log(`${label}: ${count}`);
  return result;
}

async function main() {
  const before = await prisma.invoice.count();
  const links = await prisma.lineInvoiceInvoice.count().catch(() => 0);
  const compras = await prisma.compra.count().catch(() => 0);

  console.log(`invoices: ${before}`);
  console.log(`line_invoice_invoice: ${links}`);
  console.log(`compras: ${compras}`);

  if (before === 0 && links === 0 && compras === 0) {
    console.log('Nada que eliminar.');
    return;
  }

  // FKs / relaciones que pueden bloquear el borrado.
  await step('line_invoice_invoice', () => prisma.lineInvoiceInvoice.deleteMany());
  await step('invoices.documentoAfectadoId → null', () =>
    prisma.invoice.updateMany({ data: { documentoAfectadoId: null } }),
  );
  await step('producto_series.comprobanteId → null', () =>
    prisma.productoSerie.updateMany({ data: { comprobanteId: null } }),
  );
  await step('movimientos.comprobante/guia → null', () =>
    prisma.movimiento.updateMany({
      data: { comprobanteId: null, guiaRemisionId: null, referenciaId: null },
    }),
  );

  // Hijos (por si el cascade no cubre todo en esta BD).
  await step('sale_details', () => prisma.saleDetail.deleteMany());
  await step('legends', () => prisma.legend.deleteMany());

  await step('invoices', () => prisma.invoice.deleteMany());
  await step('compras', () => prisma.compra.deleteMany());

  const after = await prisma.invoice.count();
  console.log(`\nQuedan ${after} invoice(s). Listo.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

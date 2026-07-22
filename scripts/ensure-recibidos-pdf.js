/**
 * Genera PDF (misma plantilla que emitidos) para compras recibidas sin pdf_url.
 * Uso: node scripts/ensure-recibidos-pdf.js [RUC_RECEPTOR]
 */
require('../src/config/env');
const prisma = require('../src/config/prisma');
const comprobantePdfService = require('../src/services/comprobantePdfService');
const comprobanteArchivosService = require('../src/services/comprobanteArchivosService');

async function main() {
  const receptor = String(process.argv[2] || '20611016591').replace(/\D/g, '');
  const rows = await prisma.invoice.findMany({
    where: {
      cliente: { numeroDoc: receptor },
      companyRuc: { not: receptor },
      estado: { in: ['ACEPTADO', 'ENVIADO'] },
      OR: [{ pdfUrl: null }, { pdfUrl: '' }],
    },
    include: {
      cliente: { include: { address: true } },
      details: true,
    },
  });
  console.log(`Sin PDF: ${rows.length}`);
  let ok = 0;
  for (const inv of rows) {
    const seller = await prisma.company.findFirst({
      where: { ruc: inv.companyRuc },
      include: { address: true },
    });
    const withCompany = {
      ...inv,
      company: seller || {
        ruc: inv.companyRuc,
        nombre: inv.companyRuc,
      },
    };
    try {
      const buffer = await comprobantePdfService.generarPdfBuffer(withCompany, 'a4');
      if (!buffer?.length) continue;
      const saved = await comprobanteArchivosService.persistGeneratedPdf(inv, buffer, null);
      if (saved?.url) {
        await prisma.invoice.update({
          where: { id: inv.id },
          data: { pdfUrl: saved.url },
        });
        ok += 1;
        console.log('OK', inv.serie, inv.correlativo);
      }
    } catch (e) {
      console.warn('FAIL', inv.serie, inv.correlativo, e.message);
    }
  }
  console.log(`Generados: ${ok}/${rows.length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

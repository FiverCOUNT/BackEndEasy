/**
 * Borra invoices tipo compra recibida (cliente = Raymi) y reimporta desde
 * tmp/sire-202607.txt (o SUNAT_SIRE_LOCAL_TXT) con descripciones + catálogo.
 *
 * Uso: node scripts/reset-compras-recibidas-raymi.js
 */
require('../src/config/env');
const fs = require('fs');
const path = require('path');
const prisma = require('../src/config/prisma');
const companyModel = require('../src/models/companyModel');
const {
  parsePropuestaRceTxt,
  filaToParsedCompra,
} = require('../src/services/sireRceImportService');
const { registrarInvoiceRecibido } = require('../src/services/ssppReceptorService');

const RECEPTOR_RUC = process.env.RESET_COMPRAS_RUC || '20611016591';

async function main() {
  const company = await companyModel.findByRuc(RECEPTOR_RUC);
  if (!company) {
    throw new Error(`Empresa ${RECEPTOR_RUC} no encontrada`);
  }

  const clienteRows = await prisma.cliente.findMany({
    where: { numeroDoc: RECEPTOR_RUC },
    select: { id: true, companyRuc: true },
  });
  const clienteIds = clienteRows.map((c) => c.id);
  console.log(`Clientes «receptor ${RECEPTOR_RUC}»: ${clienteIds.length}`);

  if (clienteIds.length) {
    // Solo CPE de terceros (emisor ≠ Raymi). No tocar GRE/facturas propias
    // aunque el destinatario sea el mismo RUC (motivo compra).
    const invoices = await prisma.invoice.findMany({
      where: {
        clienteId: { in: clienteIds },
        NOT: { companyRuc: RECEPTOR_RUC },
      },
      select: { id: true, companyRuc: true, serie: true, correlativo: true, tipoDoc: true },
    });
    console.log(`Compras recibidas a eliminar: ${invoices.length}`);
    for (const inv of invoices) {
      console.log(`  - ${inv.companyRuc} ${inv.tipoDoc} ${inv.serie}-${inv.correlativo}`);
    }

    if (invoices.length) {
      const ids = invoices.map((i) => i.id);
      await prisma.invoice.updateMany({
        where: { id: { in: ids } },
        data: { documentoAfectadoId: null },
      });
      const del = await prisma.invoice.deleteMany({ where: { id: { in: ids } } });
      console.log(`Eliminadas: ${del.count}`);
    }
  } else {
    console.log('No había compras recibidas.');
  }

  const localTxt = process.env.SUNAT_SIRE_LOCAL_TXT
    || path.join(__dirname, '..', 'tmp', 'sire-202607.txt');
  if (!fs.existsSync(localTxt)) {
    console.log(`No hay TXT local (${localTxt}). Solo se borró; importa con SIRE en prod.`);
    return;
  }

  const txt = fs.readFileSync(localTxt, 'utf8');
  const filas = parsePropuestaRceTxt(txt, RECEPTOR_RUC);
  console.log(`\nReimportando ${filas.length} fila(s) desde ${localTxt}`);

  let creados = 0;
  let duplicados = 0;
  let errores = 0;
  for (const fila of filas) {
    try {
      const parsed = filaToParsedCompra(fila, RECEPTOR_RUC);
      const r = await registrarInvoiceRecibido(company, parsed, { fuente: 'sire_rce' });
      if (r.creado) {
        creados += 1;
        const d0 = r.invoice?.details?.[0] || r.invoice?.lineas?.[0];
        console.log(
          `  OK ${parsed.serie}-${parsed.correlativo}`
            + ` · ${d0?.nombre || d0?.descripcion || ''}`
            + ` · cat=${d0?.catalog_item_id || d0?.catalogItemId || '?'}`,
        );
      } else if (r.duplicado) {
        duplicados += 1;
        console.log(`  DUP ${parsed.serie}-${parsed.correlativo}`);
      }
    } catch (e) {
      errores += 1;
      console.error(`  ERR ${fila.serie}-${fila.correlativo}:`, e.message);
    }
  }
  console.log(`\nListo. creados=${creados} duplicados=${duplicados} errores=${errores}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

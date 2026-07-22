/**
 * Para cada compra recibida de Raymi (resumen SIRE), intenta SSPP/XML
 * y reemplaza las líneas con el detalle UBL real.
 *
 * Uso: node scripts/enrich-compras-sspp-raymi.js
 */
require('../src/config/env');
const prisma = require('../src/config/prisma');
const companyModel = require('../src/models/companyModel');
const {
  intentarParsedDesdeSspp,
  registrarInvoiceRecibido,
} = require('../src/services/ssppReceptorService');

const RECEPTOR_RUC = process.env.RESET_COMPRAS_RUC || '20611016591';

function toFechaEmisionApi(value) {
  if (!value) return null;
  const s = String(value);
  // stored like "2026-07-06 12:00:00" or ISO
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return s;
}

async function main() {
  const company = await companyModel.findByRuc(RECEPTOR_RUC);
  if (!company) throw new Error(`Empresa ${RECEPTOR_RUC} no encontrada`);

  const invoices = await prisma.invoice.findMany({
    where: {
      cliente: { numeroDoc: RECEPTOR_RUC },
      NOT: { companyRuc: RECEPTOR_RUC },
    },
    include: { details: true },
    orderBy: { fechaEmision: 'desc' },
  });

  console.log(`Compras a enriquecer: ${invoices.length}\n`);

  let ok = 0;
  let skip = 0;
  let fail = 0;

  for (const inv of invoices) {
    const etiqueta = `${inv.serie}-${inv.correlativo}`;
    const emisor = await prisma.company.findFirst({
      where: { ruc: inv.companyRuc },
      select: { nombre: true },
    });
    const parsedSspp = await intentarParsedDesdeSspp(company, {
      emisor_ruc: inv.companyRuc,
      tipo_doc: inv.tipoDoc,
      serie: inv.serie,
      correlativo: inv.correlativo,
      fecha_emision: toFechaEmisionApi(inv.fechaEmision),
      monto: inv.mtoImpVenta,
    });

    if (!parsedSspp?.lineas?.length) {
      fail += 1;
      console.log(`  FAIL ${etiqueta} · sin XML SSPP (queda resumen SIRE)`);
      continue;
    }

    if (emisor?.nombre) {
      parsedSspp.proveedor = {
        ...parsedSspp.proveedor,
        razon_social: emisor.nombre,
      };
    }

    const r = await registrarInvoiceRecibido(company, parsedSspp, {
      fuente: 'sire_sspp',
      reemplazarResumen: true,
    });

    if (r.enriquecido || r.creado) {
      ok += 1;
      const lines = (r.invoice?.details || r.invoice?.lineas || [])
        .map((d) => `${d.cantidad || '?'}× ${(d.nombre || d.descripcion || '').slice(0, 60)}`)
        .join(' | ');
      console.log(`  OK  ${etiqueta} · ${parsedSspp.lineas.length} línea(s): ${lines}`);
    } else {
      skip += 1;
      console.log(`  SKIP ${etiqueta} · ya tenía detalle / no era resumen`);
    }
  }

  console.log(`\nListo. enriquecidos=${ok} skip=${skip} sin_xml=${fail}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

/**
 * Importa propuesta RCE (compras SIRE) del periodo y guarda invoices recibidos.
 *
 * Uso:
 *   node scripts/import-sire-compras-mes.js 20611016591
 *   node scripts/import-sire-compras-mes.js 20611016591 202607
 */
require('../src/config/env');
const sireRceImportService = require('../src/services/sireRceImportService');

async function main() {
  const ruc = process.argv[2] || process.env.IMPORT_RUC;
  const periodo = process.argv[3] || process.env.IMPORT_PERIODO || null;
  if (!ruc) {
    console.error('Uso: node scripts/import-sire-compras-mes.js <RUC> [YYYYMM]');
    process.exit(1);
  }

  console.log(`Importando SIRE RCE · RUC ${ruc} · periodo ${periodo || '(mes actual PE)'}`);
  const result = await sireRceImportService.importarComprasDelPeriodo(ruc, periodo);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  if (err.sunat) console.error('SUNAT:', JSON.stringify(err.sunat, null, 2));
  process.exit(1);
});

/**
 * Importa el CSV UNSPSC v14_0801 (español) a codigo_producto_sunat.
 * Fuente: Colombia Compra Eficiente / misma versión que cita SUNAT (Catálogo 25).
 *
 *   npm run db:import-codigos-sunat
 */
require('../src/config/env');
const fs = require('fs');
const path = require('path');
const prisma = require('../src/config/prisma');

const CSV = path.join(
  __dirname,
  '..',
  'data',
  'codigo_producto_sunat_unspsc_v14_0801.csv',
);
const BATCH = 1000;

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

async function main() {
  if (!fs.existsSync(CSV)) {
    throw new Error(`No existe ${CSV}. Ejecuta: node scripts/build-codigos-producto-sunat-csv.js`);
  }

  const raw = fs.readFileSync(CSV, 'utf8').replace(/^\uFEFF/, '');
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  const rows = [];

  for (let i = 1; i < lines.length; i += 1) {
    const cols = parseCsvLine(lines[i]);
    const codigo = String(cols[0] || '').trim();
    const nombre = String(cols[1] || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 255);
    if (!/^\d{8}$/.test(codigo) || !nombre) continue;
    rows.push({ codigo, nombre });
  }

  console.log(`Importando ${rows.length} códigos…`);
  await prisma.codigoProductoSunat.deleteMany();

  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    await prisma.codigoProductoSunat.createMany({ data: chunk, skipDuplicates: true });
    process.stdout.write(`\r  ${Math.min(i + BATCH, rows.length)} / ${rows.length}`);
  }
  console.log('\nListo.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

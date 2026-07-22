/**
 * Convierte el Excel oficial UNSPSC v14.0801 (español) a CSV codigo,nombre.
 * Fuente alineada con Catálogo N° 25 SUNAT (UNSPSC v14_0801).
 *
 * Uso:
 *   node scripts/build-codigos-producto-sunat-csv.js [ruta.xls]
 */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const input =
  process.argv[2] ||
  path.join(__dirname, '..', 'tmp', 'unspsc', 'unspsc_v14_es.xls');
const outDir = path.join(__dirname, '..', 'data');
const outFile = path.join(outDir, 'codigo_producto_sunat_unspsc_v14_0801.csv');

function csvEscape(value) {
  const s = String(value ?? '');
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

if (!fs.existsSync(input)) {
  console.error('No se encontró el Excel:', input);
  process.exit(1);
}

const wb = XLSX.readFile(input);
const sheet = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
const map = new Map();

for (let i = 0; i < rows.length; i += 1) {
  const row = rows[i];
  const codigo = String(row[6] ?? '')
    .trim()
    .replace(/\D/g, '');
  const nombre = String(row[7] ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!/^\d{8}$/.test(codigo) || !nombre) continue;
  map.set(codigo, nombre.slice(0, 255));
}

fs.mkdirSync(outDir, { recursive: true });
const lines = ['codigo,nombre'];
for (const [codigo, nombre] of map) {
  lines.push(`${codigo},${csvEscape(nombre)}`);
}
fs.writeFileSync(outFile, `${lines.join('\n')}\n`, 'utf8');

console.log(`OK: ${map.size} códigos → ${outFile}`);

/**
 * Suite unitaria exhaustiva (sin DB / sin red).
 *
 *   npm run test:unit
 *   node tests/run-unit.js
 */
const fs = require('fs');
const path = require('path');
const { reset, summary, getState } = require('./harness');

const unitDir = path.join(__dirname, 'unit');

function listTests() {
  return fs.readdirSync(unitDir)
    .filter((f) => f.endsWith('.test.js'))
    .sort();
}

async function main() {
  reset();
  console.log('Easy · suite unitaria');
  console.log(`Directorio: ${unitDir}`);

  const files = listTests();
  if (!files.length) {
    console.error('No hay archivos *.test.js en tests/unit');
    process.exit(1);
  }

  for (const file of files) {
    const full = path.join(unitDir, file);
    // Cada archivo registra tests vía harness; se ejecutan al require.
    // eslint-disable-next-line import/no-dynamic-require, global-require
    const mod = require(full);
    if (typeof mod === 'function') {
      await mod();
    } else if (mod && typeof mod.run === 'function') {
      await mod.run();
    }
  }

  const ok = summary();
  const { passed, failed } = getState();
  console.log(`Archivos: ${files.length} · casos: ${passed + failed}`);
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

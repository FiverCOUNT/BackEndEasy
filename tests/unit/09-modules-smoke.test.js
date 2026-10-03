const { assert, section, test } = require('../harness');
const fs = require('fs');
const path = require('path');

section('smoke · módulos cargan sin error');
const roots = [
  'src/models',
  'src/utils',
  'src/config',
];

function listJs(dir) {
  const abs = path.join(__dirname, '../..', dir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs)
    .filter((f) => f.endsWith('.js'))
    .map((f) => path.join(dir, f).replace(/\\/g, '/'));
}

const files = roots.flatMap(listJs).filter((f) => {
  // Evitar side-effects pesados / env obligatorios en smoke
  if (f.includes('env.js')) return false;
  if (f.includes('prisma.js')) return true;
  return true;
});

for (const rel of files) {
  test(`require ${rel}`, () => {
    const full = path.join(__dirname, '../..', rel);
    // eslint-disable-next-line import/no-dynamic-require, global-require
    const mod = require(full);
    assert.ok(mod != null);
  });
}

section('smoke · controllers principales');
const controllers = [
  'src/controllers/appCatalogWebController.js',
  'src/controllers/appAnalisisWebController.js',
  'src/controllers/appModulesWebController.js',
];
for (const rel of controllers) {
  test(`require ${rel}`, () => {
    // eslint-disable-next-line import/no-dynamic-require, global-require
    const mod = require(path.join(__dirname, '../..', rel));
    assert.ok(mod && typeof mod === 'object');
  });
}

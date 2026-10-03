'use strict';

/**
 * Suite de integración contra API/web (beta por defecto).
 *
 * Env:
 *   INTEGRATION_BASE_URL  default http://127.0.0.1:3000
 *   INTEGRATION_EMAIL     default mili@gmail.com
 *   INTEGRATION_PASSWORD  default 123456
 *   INTEGRATION_ALLOW_PROD=1  permite correr si empresa no es beta
 *
 * Uso:
 *   npm run test:integration
 *   INTEGRATION_BASE_URL=https://esy.lat npm run test:integration
 */

const path = require('path');
const { loadConfig, createRunner } = require('./lib/harness');

const SUITES = [
  ['01 auth', require('./01-auth.test')],
  ['02 empresa API', require('./02-empresa-api.test')],
  ['03 web app', require('./03-web-app.test')],
  ['04 análisis + lotes', require('./04-analisis-lotes.test')],
  ['05 salidas validación', require('./05-salidas-validacion.test')],
];

async function main() {
  const cfg = loadConfig();
  const { test, summary, assert } = createRunner();
  const ctx = {};

  console.log(`\nIntegration · ${cfg.base}`);
  console.log(`  user: ${cfg.email} · requireBeta=${cfg.requireBeta}\n`);

  // Health rápido
  const { request } = require('./lib/http');
  try {
    const health = await request(cfg.base, 'GET', '/api/health').catch(() => null);
    const home = health && health.status < 500
      ? health
      : await request(cfg.base, 'GET', '/');
    if (home.status >= 500) {
      throw new Error(`Servidor no saludable (status ${home.status})`);
    }
  } catch (err) {
    console.error(`No se pudo conectar a ${cfg.base}: ${err.message}`);
    process.exit(2);
  }

  for (const [label, fn] of SUITES) {
    console.log(`[${label}]`);
    await fn({ test, assert, cfg, ctx });
    console.log('');
  }

  const { passed, failed, failures } = summary();
  console.log(`Resultado: ${passed} ok · ${failed} fail`);
  if (failed) {
    console.log('\nFallos:');
    for (const f of failures) {
      console.log(`  - ${f.name}: ${f.err && f.err.message ? f.err.message : f.err}`);
    }
    process.exit(1);
  }
  console.log(`Contexto: ruc=${ctx.ruc || '?'} entorno=${ctx.entorno || '?'} almacenes=${(ctx.almacenes || []).length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

'use strict';

const { request } = require('./lib/http');

/**
 * @param {{ test: Function, assert: typeof import('assert'), cfg: object, ctx: object }} h
 */
module.exports = async function webAppTests({ test, assert, cfg, ctx }) {
  async function getApp(path) {
    const res = await request(cfg.base, 'GET', path, { jar: ctx.jar });
    return res;
  }

  await test('GET /app → dashboard o redirect OK', async () => {
    const res = await getApp('/app');
    assert.ok(
      res.status === 200 || (res.status >= 300 && res.status < 400),
      `status ${res.status}`
    );
    if (res.status === 200) {
      assert.ok(res.body.includes('app') || res.body.includes('Easy') || res.body.length > 200);
    }
  });

  await test('GET /app/catalogo', async () => {
    const res = await getApp('/app/catalogo');
    assert.strictEqual(res.status, 200, `status ${res.status}`);
    assert.ok(res.body.includes('Catálogo') || res.body.includes('catalogo') || res.body.length > 500);
  });

  await test('GET /app/salidas', async () => {
    const res = await getApp('/app/salidas');
    assert.ok(
      res.status === 200 || res.status === 302,
      `status ${res.status}`
    );
    if (res.status === 200) {
      assert.ok(
        res.body.includes('Salida') ||
          res.body.includes('salida') ||
          res.body.includes('Entrega') ||
          res.body.length > 300
      );
    }
  });

  await test('GET /app/ingresos (admin)', async () => {
    const res = await getApp('/app/ingresos');
    assert.ok(
      res.status === 200 || res.status === 302 || res.status === 403,
      `status ${res.status}`
    );
  });

  await test('GET /app/almacenes (admin)', async () => {
    const res = await getApp('/app/almacenes');
    assert.ok(
      res.status === 200 || res.status === 302 || res.status === 403,
      `status ${res.status}`
    );
  });

  await test('GET /app/clientes', async () => {
    const res = await getApp('/app/clientes');
    assert.strictEqual(res.status, 200, `status ${res.status}`);
  });

  await test('GET /app/comprobantes', async () => {
    const res = await getApp('/app/comprobantes');
    assert.ok(res.status === 200 || res.status === 302, `status ${res.status}`);
  });
};

'use strict';

const { request, bearer } = require('./lib/http');

/**
 * Validaciones de escritura sin mutar inventario real (payloads incompletos → 4xx).
 * @param {{ test: Function, assert: typeof import('assert'), cfg: object, ctx: object }} h
 */
module.exports = async function salidasValidacionTests({ test, assert, cfg, ctx }) {
  function auth() {
    return bearer(ctx.token);
  }

  function baseEmp() {
    return `/api/empresas/${ctx.ruc}`;
  }

  await test('POST /inventario/salidas sin body → 4xx', async () => {
    const res = await request(cfg.base, 'POST', `${baseEmp()}/inventario/salidas`, {
      headers: auth(),
      body: {},
      json: true,
    });
    assert.ok(res.status >= 400 && res.status < 500, `status ${res.status}`);
  });

  await test('POST /entregas sin items → 4xx', async () => {
    const res = await request(cfg.base, 'POST', `${baseEmp()}/entregas`, {
      headers: auth(),
      body: { tipo: 'ENTREGA_CLIENTE', items: [] },
      json: true,
    });
    assert.ok(res.status >= 400 && res.status < 500, `status ${res.status}`);
  });

  await test('POST /inventario/movimientos origen→destino incompleto → 4xx', async () => {
    const res = await request(cfg.base, 'POST', `${baseEmp()}/inventario/movimientos`, {
      headers: auth(),
      body: { tipo: 'TRANSFERENCIA' },
      json: true,
    });
    assert.ok(res.status >= 400 && res.status < 500, `status ${res.status}`);
  });

  await test('Guard: entorno beta antes de mutaciones', async () => {
    if (!cfg.requireBeta) return;
    const entorno = String(ctx.entorno || '').toLowerCase();
    assert.ok(
      entorno === 'beta' || entorno === '',
      `abort: entorno="${entorno}" no es beta`
    );
  });
};

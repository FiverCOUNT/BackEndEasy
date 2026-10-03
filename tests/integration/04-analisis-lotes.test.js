'use strict';

const { request } = require('./lib/http');

/**
 * @param {{ test: Function, assert: typeof import('assert'), cfg: object, ctx: object }} h
 */
module.exports = async function analisisLotesTests({ test, assert, cfg, ctx }) {
  async function getApp(path) {
    return request(cfg.base, 'GET', path, { jar: ctx.jar });
  }

  await test('GET /app/analisis → charts + tips medios', async () => {
    const res = await getApp('/app/analisis');
    assert.strictEqual(res.status, 200, `status ${res.status}`);
    assert.ok(res.body.includes('analisis-charts-data'), 'JSON de charts embebido');
    assert.ok(
      res.body.includes('chartUnidades') || res.body.includes('chartIngresos'),
      'canvas de charts'
    );
    assert.ok(
      res.body.includes('Precios medios') || res.body.includes('precio medio') || res.body.includes('medios'),
      'tips de precios medios'
    );
    assert.ok(
      res.body.includes('chartAlmacenes') || res.body.includes('por_almacen'),
      'ranking por almacén'
    );

    const m = res.body.match(
      /<script type="application\/json" id="analisis-charts-data">([\s\S]*?)<\/script>/
    );
    assert.ok(m, 'bloque analisis-charts-data parseable');
    const charts = JSON.parse(m[1]);
    assert.ok(charts && typeof charts === 'object');
    if (Array.isArray(charts.por_almacen)) {
      ctx.analisisPorAlmacen = charts.por_almacen.length;
    }
  });

  await test('GET /app/analisis?vista=ingresos', async () => {
    const res = await getApp('/app/analisis?vista=ingresos');
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.includes('analisis-charts-data'));
  });

  await test('GET /app/analisis con filtro almacén (si hay)', async () => {
    const almId = ctx.almacenId;
    if (!almId) {
      assert.ok(true, 'skip sin almacén');
      return;
    }
    const res = await getApp(`/app/analisis?almacen=${encodeURIComponent(almId)}`);
    assert.strictEqual(res.status, 200, `status ${res.status}`);
    assert.ok(res.body.includes('analisis-charts-data'));
  });

  await test('GET /app/lotes (admin · por vencer)', async () => {
    const res = await getApp('/app/lotes');
    assert.ok(
      res.status === 200 || res.status === 302 || res.status === 403,
      `status ${res.status}`
    );
    if (res.status === 200) {
      assert.ok(
        res.body.includes('Lote') ||
          res.body.includes('lote') ||
          res.body.includes('vencer') ||
          res.body.includes('Entregar'),
        'página de lotes'
      );
      assert.ok(
        res.body.includes('loteEntregar') ||
          res.body.includes('Entregar al cliente') ||
          res.body.includes('entregar') ||
          res.body.includes('ios-lote'),
        'UI entrega lote'
      );
    }
  });

  await test('GET /app/lotes?vence=1 si aplica', async () => {
    const res = await getApp('/app/lotes?vence=1');
    assert.ok(
      res.status === 200 || res.status === 302 || res.status === 403,
      `status ${res.status}`
    );
  });
};

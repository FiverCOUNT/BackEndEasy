'use strict';

const { request, bearer } = require('./lib/http');

/**
 * @param {{ test: Function, assert: typeof import('assert'), cfg: object, ctx: object }} h
 */
module.exports = async function empresaApiTests({ test, assert, cfg, ctx }) {
  function auth() {
    return bearer(ctx.token);
  }

  function baseEmp() {
    assert.ok(ctx.ruc, 'ctx.ruc requerido');
    return `/api/empresas/${ctx.ruc}`;
  }

  await test('GET /api/empresas/:ruc perfil', async () => {
    const res = await request(cfg.base, 'GET', baseEmp(), {
      headers: auth(),
      json: true,
    });
    assert.strictEqual(res.status, 200, `status ${res.status} ${res.body?.slice?.(0, 120)}`);
    const ruc = res.json?.ruc || res.json?.company?.ruc || res.json?.empresa?.ruc;
    assert.ok(ruc, 'perfil con RUC');
    assert.strictEqual(String(ruc), String(ctx.ruc));
    if (res.json?.entorno) ctx.entorno = String(res.json.entorno).toLowerCase();
  });

  await test('GET /api/empresas/:ruc/catalogo', async () => {
    const res = await request(cfg.base, 'GET', `${baseEmp()}/catalogo`, {
      headers: auth(),
      json: true,
    });
    assert.strictEqual(res.status, 200);
    const items = Array.isArray(res.json)
      ? res.json
      : res.json?.items || res.json?.data || res.json?.catalogo || [];
    assert.ok(Array.isArray(items), 'catálogo es lista');
    ctx.catalogo = items;
    if (items.length) {
      const first = items[0];
      assert.ok(first.id != null || first.codigo != null, 'ítem con id/código');
    }
  });

  await test('GET /api/empresas/:ruc/almacenes', async () => {
    const res = await request(cfg.base, 'GET', `${baseEmp()}/almacenes`, {
      headers: auth(),
      json: true,
    });
    assert.strictEqual(res.status, 200);
    const list = Array.isArray(res.json)
      ? res.json
      : res.json?.items || res.json?.almacenes || res.json?.data || [];
    assert.ok(Array.isArray(list) && list.length >= 1, 'al menos 1 almacén');
    ctx.almacenes = list;
    ctx.almacenId = list[0].id;
  });

  await test('GET /api/empresas/:ruc/clientes', async () => {
    const res = await request(cfg.base, 'GET', `${baseEmp()}/clientes`, {
      headers: auth(),
      json: true,
    });
    assert.strictEqual(res.status, 200);
    const list = Array.isArray(res.json)
      ? res.json
      : res.json?.items || res.json?.clientes || res.json?.data || [];
    assert.ok(Array.isArray(list), 'clientes lista');
    ctx.clientes = list;
  });

  await test('GET /api/empresas/:ruc/comprobantes (lista)', async () => {
    const res = await request(cfg.base, 'GET', `${baseEmp()}/comprobantes?limit=5`, {
      headers: auth(),
      json: true,
    });
    assert.strictEqual(res.status, 200);
    const list = Array.isArray(res.json)
      ? res.json
      : res.json?.items || res.json?.comprobantes || res.json?.data || [];
    assert.ok(Array.isArray(list), 'comprobantes lista');
  });

  await test('GET /api/empresas/:ruc/inventario', async () => {
    const res = await request(cfg.base, 'GET', `${baseEmp()}/inventario`, {
      headers: auth(),
      json: true,
    });
    assert.strictEqual(res.status, 200);
    const list = Array.isArray(res.json)
      ? res.json
      : res.json?.items || res.json?.inventario || res.json?.data || [];
    assert.ok(Array.isArray(list), 'inventario lista');
    ctx.inventario = list;
  });

  await test('GET /api/empresas/:ruc/inventario/movimientos', async () => {
    const res = await request(cfg.base, 'GET', `${baseEmp()}/inventario/movimientos?limit=10`, {
      headers: auth(),
      json: true,
    });
    assert.strictEqual(res.status, 200);
    const list = Array.isArray(res.json)
      ? res.json
      : res.json?.items || res.json?.movimientos || res.json?.data || [];
    assert.ok(Array.isArray(list), 'movimientos lista');
  });

  await test('GET /api/empresas/:ruc/entregas (salidas)', async () => {
    const res = await request(cfg.base, 'GET', `${baseEmp()}/entregas`, {
      headers: auth(),
      json: true,
    });
    assert.strictEqual(res.status, 200);
    const list = Array.isArray(res.json)
      ? res.json
      : res.json?.items || res.json?.entregas || res.json?.data || [];
    assert.ok(Array.isArray(list), 'entregas lista');
  });

  await test('GET series-disponibles de un ítem (con almacen_id)', async () => {
    const items = ctx.catalogo || [];
    const alm = ctx.almacenId;
    if (!alm || !items.length) {
      assert.ok(true, 'skip sin catálogo/almacén');
      return;
    }
    let probed = false;
    for (const item of items.slice(0, 15)) {
      const id = item.id;
      if (id == null) continue;
      const res = await request(
        cfg.base,
        'GET',
        `${baseEmp()}/catalogo/${id}/series-disponibles?almacen_id=${encodeURIComponent(alm)}`,
        { headers: auth(), json: true }
      );
      if (res.status === 404) continue;
      assert.ok(res.status === 200 || res.status === 400, `status ${res.status} item ${id}`);
      probed = true;
      if (res.status === 200) {
        const series = Array.isArray(res.json)
          ? res.json
          : res.json?.series || res.json?.items || [];
        assert.ok(Array.isArray(series), 'series lista');
        if (series.length) {
          ctx.serieSample = { catalogItemId: id, serie: series[0] };
          break;
        }
      }
    }
    assert.ok(probed, 'se consultó al menos un ítem');
  });
};

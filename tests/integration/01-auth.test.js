'use strict';

const { request, apiLogin, webLogin, bearer, unwrapData } = require('./lib/http');

/**
 * @param {{ test: Function, assert: typeof import('assert'), cfg: object, ctx: object }} h
 */
module.exports = async function authTests({ test, assert, cfg, ctx }) {
  await test('API login milí → token + empresa beta', async () => {
    const session = await apiLogin(cfg.base, cfg.email, cfg.password);
    assert.ok(session.token, 'token presente');
    ctx.token = session.token;
    ctx.user = session.user;
    ctx.company = session.company;

    const me = await request(cfg.base, 'GET', '/api/auth/me', {
      headers: bearer(session.token),
      json: true,
    });
    assert.strictEqual(me.status, 200, `me status ${me.status}`);
    const data = unwrapData(me.json) || {};
    const user = data.user || data.usuario || data;
    const company =
      data.company ||
      user?.company ||
      data.configuracion?.empresa ||
      data.empresa ||
      null;
    assert.ok(user || company, 'respuesta /me con usuario/empresa');
    ctx.company = company || ctx.company;
    ctx.user = user || ctx.user;

    // Entorno viene en el JWT (claim `entorno`).
    let jwtEntorno = '';
    try {
      const payload = JSON.parse(
        Buffer.from(session.token.split('.')[1], 'base64url').toString('utf8')
      );
      jwtEntorno = String(payload.entorno || '').toLowerCase();
    } catch {
      /* ignore */
    }
    const entorno = String(
      jwtEntorno ||
        ctx.company?.entorno ||
        ctx.user?.company?.entorno ||
        data.entorno ||
        ''
    ).toLowerCase();
    if (cfg.requireBeta) {
      assert.ok(
        entorno === 'beta',
        `entorno debe ser beta (got "${entorno || 'vacío'}"). Use INTEGRATION_ALLOW_PROD=1 para forzar.`
      );
    }
    ctx.entorno = entorno || 'beta';
    ctx.ruc = String(
      ctx.user?.companyRuc ||
        ctx.company?.ruc ||
        session.raw?.configuracion?.empresa?.ruc ||
        session.user?.companyRuc ||
        ''
    );
    assert.ok(ctx.ruc, 'RUC de empresa en sesión');
  });

  await test('API login credenciales inválidas → 401', async () => {
    const res = await request(cfg.base, 'POST', '/api/auth/login', {
      body: { email: cfg.email, contrasena: '__wrong__' },
      json: true,
    });
    assert.ok(res.status === 401 || res.status === 400, `status ${res.status}`);
  });

  await test('Web login milí → cookie de sesión', async () => {
    const jar = await webLogin(cfg.base, cfg.email, cfg.password);
    assert.ok(Object.keys(jar).length > 0);
    ctx.jar = jar;
  });

  await test('API sin token → 401 en /empresas/:ruc', async () => {
    const ruc = ctx.ruc || '20100000000';
    const res = await request(cfg.base, 'GET', `/api/empresas/${ruc}`, { json: true });
    assert.strictEqual(res.status, 401);
  });
};

const { assert, section, test } = require('../harness');
const prisma = require('../../src/config/prisma');
const { APP_NAV_ITEMS, APP_BASE, appPath } = require('../../src/config/appPanel');
const { isWebCompanyAdmin, navItemsForUser } = require('../../src/utils/appWebHelpers');

section('Prisma import');
test('prisma.saleDetail existe (export default, no destructuring)', () => {
  assert.ok(prisma);
  assert.ok(prisma.saleDetail);
  assert.strictEqual(typeof prisma.saleDetail.findMany, 'function');
});
test('{ prisma } del módulo es undefined', () => {
  const mod = require('../../src/config/prisma');
  const { prisma: broken } = mod;
  assert.strictEqual(broken, undefined);
});

section('App panel / nav');
test('APP_BASE y appPath', () => {
  assert.strictEqual(APP_BASE, '/app');
  assert.strictEqual(appPath('/'), '/app');
  assert.strictEqual(appPath('/analisis'), '/app/analisis');
  assert.strictEqual(appPath('lotes'), '/app/lotes');
});
test('nav tiene Análisis y Lotes adminOnly', () => {
  const analisis = APP_NAV_ITEMS.find((i) => i.id === 'analisis');
  const lotes = APP_NAV_ITEMS.find((i) => i.id === 'lotes');
  assert.ok(analisis && analisis.adminOnly);
  assert.ok(lotes && lotes.adminOnly);
});
test('isWebCompanyAdmin solo ADMIN', () => {
  assert.strictEqual(isWebCompanyAdmin({ rol: 'ADMIN' }), true);
  assert.strictEqual(isWebCompanyAdmin({ rol: 'USUARIO' }), false);
  assert.strictEqual(isWebCompanyAdmin(null), false);
});
test('navItemsForUser oculta adminOnly a usuario', () => {
  const admin = navItemsForUser({ rol: 'ADMIN' });
  const user = navItemsForUser({ rol: 'USUARIO' });
  assert.ok(admin.some((i) => i.id === 'analisis'));
  assert.ok(!user.some((i) => i.id === 'analisis'));
  assert.ok(user.some((i) => i.id === 'catalogo'));
  assert.ok(user.some((i) => i.id === 'salidas'));
});

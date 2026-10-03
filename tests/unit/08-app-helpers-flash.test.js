const { assert, section, test } = require('../harness');
const {
  parseFlash,
  layoutLocals,
  formatDocRef,
  formatFecha,
  esGrePorEvento,
  labelMotivoNota,
} = require('../../src/utils/appWebHelpers');

section('appWebHelpers · flash / layout / labels');
test('parseFlash de query', () => {
  const flash = parseFlash({
    query: { msg: 'Hola', tipo: 'ok' },
  });
  assert.ok(flash);
  assert.ok(String(flash.text || flash.message || '').includes('Hola') || flash.type);
});
test('layoutLocals incluye isWebAdmin y catalogoPorVencer', () => {
  const locals = layoutLocals({
    locals: {
      webUser: { rol: 'ADMIN', email: 'a@b.com' },
      appBase: '/app',
      companyNombre: 'Demo',
      companyRuc: '20611016591',
      catalogoPorVencer: 2,
      ordenesNoVistas: 0,
      navItems: [],
    },
  });
  assert.strictEqual(locals.isWebAdmin, true);
  assert.strictEqual(locals.catalogoPorVencer, 2);
});
test('formatDocRef', () => {
  assert.strictEqual(formatDocRef({ serie: 'F001', correlativo: '00000001' }), 'F001-00000001');
  assert.ok(formatDocRef({}));
});
test('esGrePorEvento', () => {
  assert.strictEqual(esGrePorEvento({ tipoDoc: '01' }), false);
  assert.strictEqual(esGrePorEvento({
    tipoDoc: '09',
    envio: { gre_por_evento: true },
  }), true);
});
test('labelMotivoNota NC', () => {
  const s = labelMotivoNota('07', '01', 'Anulación');
  assert.ok(String(s).length > 0);
});
test('formatFecha no truena', () => {
  const s = formatFecha('2026-10-02');
  assert.ok(s == null || typeof s === 'string');
});

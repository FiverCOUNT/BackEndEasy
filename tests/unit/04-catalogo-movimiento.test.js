const { assert, section, test } = require('../harness');
const catalogItemModel = require('../../src/models/catalogItemModel');
const { validarLoteIngreso, normalizeIncomingLineas } = require('../../src/models/movimientoModel');

section('catálogo · flags lote/serie');
test('producto con lote y vencimiento', () => {
  const p = catalogItemModel.parseBody({
    kind: 'PRODUCT', nombre: 'Paracetamol', manejaLote: 'on', manejaVencimiento: 'on',
  });
  assert.strictEqual(p.manejaLote, true);
  assert.strictEqual(p.manejaVencimiento, true);
});
test('sin marca no pide lote', () => {
  const p = catalogItemModel.parseBody({ kind: 'PRODUCT', nombre: 'Cable' });
  assert.strictEqual(p.manejaLote, false);
  assert.strictEqual(p.manejaVencimiento, false);
});
test('servicio ignora lote/vencimiento', () => {
  const p = catalogItemModel.parseBody({
    kind: 'SERVICE', nombre: 'Consulta', manejaLote: 'on', manejaVencimiento: 'on',
  });
  assert.strictEqual(p.manejaLote, false);
  assert.strictEqual(p.manejaVencimiento, false);
});

section('movimiento · validarLoteIngreso / normalize');
test('lote opcional siempre pasa', () => {
  assert.strictEqual(validarLoteIngreso({ manejaLote: true }, { lote: 'L-1' }), null);
  assert.strictEqual(validarLoteIngreso({ manejaVencimiento: true }, { fechaVencimiento: '2027-07-02' }), null);
  assert.strictEqual(validarLoteIngreso({ manejaLote: false, manejaVencimiento: false }, {}), null);
});
test('normalizeIncomingLineas conserva producto_lote_id', () => {
  const [ln] = normalizeIncomingLineas([{
    catalog_item_id: 'item-1',
    cantidad: 100,
    producto_lote_id: 'lot-leche',
    lote: 'LOTELECHE',
    fecha_vencimiento: '2027-01-01',
  }]);
  assert.strictEqual(ln.productoLoteId, 'lot-leche');
  assert.strictEqual(ln.catalogItemId, 'item-1');
  assert.strictEqual(ln.cantidad, 100);
});
test('normalizeIncomingLineas serie por id', () => {
  const [ln] = normalizeIncomingLineas([{
    catalog_item_id: 'p1',
    cantidad: 1,
    producto_serie_id: 's1',
  }]);
  assert.strictEqual(ln.productoSerieId, 's1');
  assert.strictEqual(ln.catalogItemId, 'p1');
});
test('normalizeIncomingLineas serie_ids expande líneas', () => {
  const lines = normalizeIncomingLineas([{
    catalog_item_id: 'p1',
    cantidad: 2,
    serie_ids: ['s1', 's2'],
  }]);
  assert.strictEqual(lines.length, 2);
  assert.strictEqual(lines[0].productoSerieId, 's1');
  assert.strictEqual(lines[1].productoSerieId, 's2');
});

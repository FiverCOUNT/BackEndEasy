const { assert, section, test } = require('../harness');
const comprobanteModel = require('../../src/models/comprobanteModel');

section('comprobante · snapshotPrecioCompra');
test('null si vacío', () => {
  assert.strictEqual(comprobanteModel.snapshotPrecioCompra({}), null);
  assert.strictEqual(comprobanteModel.snapshotPrecioCompra({ precioCompra: null }), null);
  assert.strictEqual(comprobanteModel.snapshotPrecioCompra({ precio_compra: '' }), null);
});
test('lee precioCompra o precio_compra', () => {
  assert.strictEqual(comprobanteModel.snapshotPrecioCompra({ precioCompra: 12.5 }), 12.5);
  assert.strictEqual(comprobanteModel.snapshotPrecioCompra({ precio_compra: '9.99' }), 9.99);
});

section('comprobante · calcularLinea');
test('gravada 10: IGV 18% y conserva precio compra', () => {
  const line = comprobanteModel.calcularLinea({
    nombre: 'X',
    descripcion: 'X',
    unidad: 'NIU',
    precioUnitario: 118,
    afectacionIgv: '10',
    precioCompra: 80,
  }, 2);
  assert.strictEqual(line.cantidad, 2);
  assert.strictEqual(line.mtoPrecioUnitario, 118);
  assert.strictEqual(line.porcentajeIgv, 18);
  assert.strictEqual(line.precioCompra, 80);
  assert.ok(Math.abs(line.totalFactura - 236) < 0.02);
  assert.ok(line.mtoIgv > 0);
});
test('exonerada 20: sin IGV', () => {
  const line = comprobanteModel.calcularLinea({
    nombre: 'Y',
    precioUnitario: 50,
    afectacionIgv: '20',
  }, 1);
  assert.strictEqual(line.mtoIgv, 0);
  assert.strictEqual(line.totalFactura, 50);
  assert.strictEqual(line.precioCompra, null);
});
test('precio override', () => {
  const line = comprobanteModel.calcularLinea({
    nombre: 'Z',
    precioUnitario: 100,
    afectacionIgv: '10',
  }, 1, 200);
  assert.strictEqual(line.mtoPrecioUnitario, 200);
});

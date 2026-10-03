const { assert, section, test } = require('../harness');
const { resolveOrigenDestino } = require('../../src/models/ubicacionModel');
const { resolveOrigenDestinoLabels } = require('../../src/utils/movimientoOrigenDestino');

section('origen/destino · ubicacionModel');
test('ENTRADA devolución: cliente → almacén', () => {
  const r = resolveOrigenDestino({
    tipo: 'ENTRADA',
    cliente: { razonSocial: 'CLIENTE DEMO', numeroDoc: '20547854268' },
    almacen: { nombre: 'Almacen virtual' },
  });
  assert.strictEqual(r.origenNombre, 'CLIENTE DEMO');
  assert.strictEqual(r.destinoNombre, 'Almacen virtual');
  assert.strictEqual(r.esTraslado, false);
});
test('ENTRADA sin cliente: recepción externa', () => {
  const r = resolveOrigenDestino({
    tipo: 'ENTRADA',
    almacen: { nombre: 'Trash' },
  });
  assert.strictEqual(r.origenNombre, 'Recepción externa');
  assert.strictEqual(r.destinoNombre, 'Trash');
});
test('SALIDA venta: almacén → cliente', () => {
  const r = resolveOrigenDestino({
    tipo: 'SALIDA',
    almacen: { nombre: 'Trash' },
    cliente: { razonSocial: 'Juan Perez', numeroDoc: '45678901' },
  });
  assert.strictEqual(r.origenNombre, 'Trash');
  assert.strictEqual(r.destinoNombre, 'Juan Perez');
});
test('TRASLADO: almacén → almacén destino', () => {
  const r = resolveOrigenDestino({
    tipo: 'SALIDA',
    almacenId: 'a1',
    almacen: { nombre: 'Trash' },
    almacenDestinoId: 'a2',
    almacenDestino: { nombre: 'Virtual' },
  });
  assert.strictEqual(r.esTraslado, true);
  assert.strictEqual(r.origenNombre, 'Trash');
  assert.strictEqual(r.destinoNombre, 'Virtual');
});

section('origen/destino · labels listado web');
test('devolución ENTRADA con cliente', () => {
  const r = resolveOrigenDestinoLabels({
    tipo: 'ENTRADA',
    refTipo: 'DEVOLUCION_CLIENTE',
    clienteNombre: 'CLIENTE DESTINO DEMO S.A.C.',
    almacenNombre: 'Almacen virtual',
  });
  assert.strictEqual(r.origenNombre, 'CLIENTE DESTINO DEMO S.A.C.');
  assert.strictEqual(r.destinoNombre, 'Almacen virtual');
});
test('compra ENTRADA sin cliente → Proveedor', () => {
  const r = resolveOrigenDestinoLabels({
    tipo: 'ENTRADA',
    refTipo: 'COMPRA',
    almacen_id: 'a1',
  }, { a1: 'Trash' });
  assert.strictEqual(r.origenNombre, 'Proveedor');
  assert.strictEqual(r.destinoNombre, 'Trash');
});
test('salida a cliente', () => {
  const r = resolveOrigenDestinoLabels({
    tipo: 'SALIDA',
    almacen_id: 'a1',
    clienteNombre: 'ACME',
  }, { a1: 'Trash' });
  assert.strictEqual(r.origenNombre, 'Trash');
  assert.strictEqual(r.destinoNombre, 'ACME');
});
test('traslado por almacenesById', () => {
  const r = resolveOrigenDestinoLabels({
    tipo: 'SALIDA',
    almacen_id: 'a1',
    almacen_destino_id: 'a2',
  }, { a1: 'Origen', a2: 'Destino' });
  assert.strictEqual(r.esTraslado, true);
  assert.strictEqual(r.origenNombre, 'Origen');
  assert.strictEqual(r.destinoNombre, 'Destino');
});

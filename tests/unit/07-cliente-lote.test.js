const { assert, section, test } = require('../harness');
const clienteModel = require('../../src/models/clienteModel');
const productoLoteModel = require('../../src/models/productoLoteModel');

section('cliente · parse bodies');
test('parseCreateBody defaults y trim', () => {
  const p = clienteModel.parseCreateBody({
    tipo_doc: '6',
    numero_doc: ' 20547854268 ',
    razon_social: ' Demo SAC ',
    telefono: '999',
  });
  assert.strictEqual(p.tipoDoc, '6');
  assert.strictEqual(p.numeroDoc, '20547854268');
  assert.strictEqual(p.razonSocial, 'Demo SAC');
  assert.strictEqual(p.telefono, '999');
});
test('parseUpdateBody parcial', () => {
  const p = clienteModel.parseUpdateBody({ razon_social: 'Nuevo' });
  assert.strictEqual(p.razonSocial, 'Nuevo');
  assert.ok(!Object.prototype.hasOwnProperty.call(p, 'telefono') || p.telefono === undefined);
});
test('toApi / toPublic', () => {
  const row = {
    id: 'c1',
    companyRuc: '20611016591',
    tipoDoc: '6',
    numeroDoc: '20547854268',
    razonSocial: 'ACME',
    telefono: null,
    activo: true,
  };
  const api = clienteModel.toApi(row);
  assert.strictEqual(api.numero_doc, '20547854268');
  assert.strictEqual(api.razon_social, 'ACME');
  const pub = clienteModel.toPublic(row);
  assert.strictEqual(pub.razonSocial, 'ACME');
});

section('productoLote · normalizarFilas / diasHastaYmd');
test('normalizarFilas filtra vacíos y parsea días', () => {
  const out = productoLoteModel.normalizarFilas(
    ['LOTE-A', 'LOTE-B'],
    ['2027-01-15', ''],
    ['60', '30'],
  );
  assert.ok(!out.error);
  assert.strictEqual(out.filas.length, 2);
  const a = out.filas.find((f) => f.nombre === 'LOTE-A');
  assert.ok(a);
  assert.strictEqual(a.fecha, '2027-01-15');
  assert.strictEqual(a.diasNotificacion, 60);
});
test('normalizarFilas error si falta nombre', () => {
  const out = productoLoteModel.normalizarFilas([''], ['2027-01-15'], ['60']);
  assert.ok(out.error);
});
test('diasHastaYmd hoy = 0', () => {
  const hoy = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  assert.strictEqual(productoLoteModel.diasHastaYmd(hoy), 0);
});
test('diasHastaYmd inválido → null', () => {
  assert.strictEqual(productoLoteModel.diasHastaYmd('nope'), null);
  assert.strictEqual(productoLoteModel.diasHastaYmd(''), null);
});
test('diasHastaYmd futuro positivo', () => {
  const d = productoLoteModel.diasHastaYmd('2099-01-01');
  assert.ok(d > 0);
});

const { assert, section, test } = require('../harness');
const analisisModel = require('../../src/models/analisisModel');

section('analisis · resolvePeriodo');
test('30d: desde <= hasta', () => {
  const r = analisisModel.resolvePeriodo({ periodo: '30d' });
  assert.ok(r.desde <= r.hasta);
  assert.strictEqual(r.periodo, '30d');
});
test('hoy: mismo día', () => {
  const r = analisisModel.resolvePeriodo({ periodo: 'hoy' });
  assert.strictEqual(r.desde, r.hasta);
});
test('custom invierte si viene al revés', () => {
  const r = analisisModel.resolvePeriodo({
    periodo: 'custom',
    desde: '2026-03-10',
    hasta: '2026-03-01',
  });
  assert.strictEqual(r.desde, '2026-03-01');
  assert.strictEqual(r.hasta, '2026-03-10');
});
test('mes_ant cierra antes del mes actual', () => {
  const ant = analisisModel.resolvePeriodo({ periodo: 'mes_ant' });
  const mes = analisisModel.resolvePeriodo({ periodo: 'mes' });
  assert.ok(ant.hasta < mes.desde);
});

section('analisis · resolveAlmacenId');
test('prioriza línea sobre factura', () => {
  assert.strictEqual(
    analisisModel.resolveAlmacenId({
      almacenId: 'a1',
      invoice: { almacenId: 'a2' },
    }),
    'a1',
  );
});
test('cae a invoice.almacenId', () => {
  assert.strictEqual(
    analisisModel.resolveAlmacenId({ invoice: { almacenId: 'a2' } }),
    'a2',
  );
});
test('vacío si no hay', () => {
  assert.strictEqual(analisisModel.resolveAlmacenId({}), '');
});

section('analisis · buildResumenFromDetails');
const sample = [
  {
    cantidad: 2,
    totalFactura: 236,
    mtoPrecioUnitario: 118,
    precioCompra: 80,
    almacenId: 'a1',
    invoice: { fechaEmision: '2026-03-01', tipoDoc: '01', almacenId: 'a1' },
    catalogItem: {
      id: 'p1', nombre: 'Iphone 13', codigo: 'IP13', unidad: 'NIU',
      kind: 'PRODUCT', precioCompra: 70,
    },
  },
  {
    cantidad: 10,
    totalFactura: 50,
    precioCompra: 2,
    almacenId: null,
    invoice: { fechaEmision: '2026-03-02', tipoDoc: '03', almacenId: 'a2' },
    catalogItem: {
      id: 'p2', nombre: 'Cable', codigo: 'CBL', unidad: 'MTR',
      kind: 'PRODUCT', precioCompra: 2,
    },
  },
];

test('usa precio_compra de línea y calcula margen', () => {
  const r = analisisModel.buildResumenFromDetails(sample, {
    solo_costo: '0', top: 10,
  }, { periodo: 'custom', desde: '2026-03-01', hasta: '2026-03-02' });
  const iphone = r.productos.find((p) => p.id === 'p1');
  assert.ok(iphone);
  assert.strictEqual(iphone.costo, 160);
  assert.strictEqual(iphone.margen, 76);
  assert.strictEqual(iphone.precio_venta_medio, 118);
  assert.strictEqual(iphone.precio_compra_medio, 80);
});
test('filtro almacén a1', () => {
  const r = analisisModel.buildResumenFromDetails(sample, {
    solo_costo: '0', top: 10, almacen: 'a1',
    almacenNombres: { a1: 'Trash', a2: 'Virtual' },
  }, { periodo: 'custom', desde: '2026-03-01', hasta: '2026-03-02' });
  assert.strictEqual(r.filtros.almacen, 'a1');
  assert.strictEqual(r.kpis.venta, 236);
  assert.strictEqual(r.charts.por_almacen.length, 1);
  assert.strictEqual(r.charts.por_almacen[0].nombre, 'Trash');
});
test('ranking por almacén con todos', () => {
  const r = analisisModel.buildResumenFromDetails(sample, {
    solo_costo: '0', top: 10,
    almacenNombres: { a1: 'Trash', a2: 'Virtual' },
  }, { periodo: 'custom', desde: '2026-03-01', hasta: '2026-03-02' });
  assert.ok(r.charts.por_almacen.length >= 2);
  assert.strictEqual(r.charts.por_almacen[0].id, 'a1');
});
test('más vendido ≠ mayor margen %', () => {
  const details = [
    {
      cantidad: 100, totalFactura: 1000, precioCompra: 9,
      invoice: { fechaEmision: '2026-03-01' },
      catalogItem: {
        id: 'vol', nombre: 'Cable', unidad: 'MTR', kind: 'PRODUCT', precioCompra: 9,
      },
    },
    {
      cantidad: 2, totalFactura: 400, precioCompra: 50,
      invoice: { fechaEmision: '2026-03-01' },
      catalogItem: {
        id: 'prem', nombre: 'Equipo', unidad: 'NIU', kind: 'PRODUCT', precioCompra: 50,
      },
    },
  ];
  const r = analisisModel.buildResumenFromDetails(details, {
    solo_costo: '1', top: 10,
  }, { periodo: 'custom', desde: '2026-03-01', hasta: '2026-03-01' });
  assert.strictEqual(r.charts.top_unidades[0].id, 'vol');
  assert.strictEqual(r.charts.top_margen_pct[0].id, 'prem');
});

/**
 * Pruebas unitarias: análisis de margen + snapshot precio_compra en líneas.
 *
 * Uso:
 *   node scripts/test-analisis-margen.js
 */
const assert = require('assert');

const analisisModel = require('../src/models/analisisModel');
const comprobanteModel = require('../src/models/comprobanteModel');
const prisma = require('../src/config/prisma');
const { APP_NAV_ITEMS } = require('../src/config/appPanel');

let passed = 0;
let failed = 0;

function ok(name) {
  passed += 1;
  console.log(`  ✓ ${name}`);
}

function fail(name, err) {
  failed += 1;
  console.error(`  ✗ ${name}`);
  console.error(`    ${err && err.message ? err.message : err}`);
}

function test(name, fn) {
  try {
    fn();
    ok(name);
  } catch (err) {
    fail(name, err);
  }
}

console.log('\n== Prisma client import ==');
test('require(config/prisma) expone saleDetail (no destructuring)', () => {
  assert.ok(prisma, 'prisma debe existir');
  assert.ok(prisma.saleDetail, 'prisma.saleDetail debe existir');
  assert.strictEqual(typeof prisma.saleDetail.findMany, 'function');
});
test('destructuring { prisma } del módulo es incorrecto (undefined)', () => {
  const wrong = require('../src/config/prisma');
  const { prisma: broken } = wrong;
  // El export default ES el proxy; no hay propiedad .prisma
  assert.strictEqual(broken, undefined);
});

console.log('\n== Nav Análisis ==');
test('menú incluye Análisis como adminOnly', () => {
  const item = APP_NAV_ITEMS.find((i) => i.id === 'analisis');
  assert.ok(item, 'item analisis');
  assert.strictEqual(item.href, '/analisis');
  assert.strictEqual(item.adminOnly, true);
});

console.log('\n== resolvePeriodo ==');
test('periodo 30d: desde <= hasta', () => {
  const r = analisisModel.resolvePeriodo({ periodo: '30d' });
  assert.ok(r.desde <= r.hasta);
  assert.strictEqual(r.periodo, '30d');
});
test('periodo hoy: mismo día', () => {
  const r = analisisModel.resolvePeriodo({ periodo: 'hoy' });
  assert.strictEqual(r.desde, r.hasta);
});
test('periodo custom: respeta desde/hasta e invierte si vienen al revés', () => {
  const r = analisisModel.resolvePeriodo({
    periodo: 'custom',
    desde: '2026-03-10',
    hasta: '2026-03-01',
  });
  assert.strictEqual(r.desde, '2026-03-01');
  assert.strictEqual(r.hasta, '2026-03-10');
});
test('periodo mes_ant: termina antes del mes actual', () => {
  const r = analisisModel.resolvePeriodo({ periodo: 'mes_ant' });
  const mes = analisisModel.resolvePeriodo({ periodo: 'mes' });
  assert.ok(r.hasta < mes.desde, 'mes anterior debe cerrar antes del mes actual');
});

console.log('\n== buildResumenFromDetails (margen) ==');
const sample = [
  {
    cantidad: 2,
    totalFactura: 236,
    mtoPrecioUnitario: 118,
    precioCompra: 80,
    invoice: { fechaEmision: '2026-03-01', tipoDoc: '01' },
    catalogItem: {
      id: 'p1',
      nombre: 'Iphone 13',
      codigo: 'IP13',
      unidad: 'NIU',
      kind: 'PRODUCT',
      precioCompra: 70,
    },
  },
  {
    cantidad: 1,
    totalFactura: 118,
    mtoPrecioUnitario: 118,
    precioCompra: null,
    invoice: { fechaEmision: '2026-03-02', tipoDoc: '03' },
    catalogItem: {
      id: 'p1',
      nombre: 'Iphone 13',
      codigo: 'IP13',
      unidad: 'NIU',
      kind: 'PRODUCT',
      precioCompra: 70,
    },
  },
  {
    cantidad: 5,
    totalFactura: 500,
    mtoPrecioUnitario: 100,
    precioCompra: null,
    invoice: { fechaEmision: '2026-03-01', tipoDoc: '01' },
    catalogItem: {
      id: 'p2',
      nombre: 'Cable',
      codigo: 'CAB',
      unidad: 'MTR',
      kind: 'PRODUCT',
      precioCompra: null,
    },
  },
];

test('usa precio_compra de la línea sobre el del catálogo', () => {
  const r = analisisModel.buildResumenFromDetails(sample, {
    solo_costo: '1',
    orden: 'unidades',
    top: 20,
  }, { periodo: 'custom', desde: '2026-03-01', hasta: '2026-03-02' });
  const iphone = r.productos.find((p) => p.id === 'p1');
  assert.ok(iphone);
  // línea1: costo 80*2=160; línea2 fallback catálogo 70*1=70 → costo 230
  assert.strictEqual(iphone.costo, 230);
  assert.strictEqual(iphone.venta, 354);
  assert.strictEqual(iphone.margen, 124);
  assert.strictEqual(iphone.unidades, 3);
});

test('solo_costo=1 excluye productos sin precio de compra', () => {
  const r = analisisModel.buildResumenFromDetails(sample, {
    solo_costo: '1',
  }, { periodo: 'custom', desde: '2026-03-01', hasta: '2026-03-02' });
  assert.ok(!r.productos.some((p) => p.id === 'p2'));
  assert.strictEqual(r.kpis.productos, 1);
});

test('solo_costo=0 incluye vendidos sin costo (margen 0)', () => {
  const r = analisisModel.buildResumenFromDetails(sample, {
    solo_costo: '0',
    orden: 'venta',
  }, { periodo: 'custom', desde: '2026-03-01', hasta: '2026-03-02' });
  const cable = r.productos.find((p) => p.id === 'p2');
  assert.ok(cable);
  assert.strictEqual(cable.tiene_costo, false);
  assert.strictEqual(cable.venta, 500);
  assert.strictEqual(cable.costo, 0);
});

test('filtro q por nombre', () => {
  const r = analisisModel.buildResumenFromDetails(sample, {
    solo_costo: '0',
    q: 'cable',
  }, { periodo: 'custom', desde: '2026-03-01', hasta: '2026-03-02' });
  assert.strictEqual(r.productos.length, 1);
  assert.strictEqual(r.productos[0].id, 'p2');
});

test('orden peor_margen y top limitan resultados', () => {
  const many = [];
  for (let i = 0; i < 5; i += 1) {
    many.push({
      cantidad: 1,
      totalFactura: 100,
      precioCompra: 10 + i * 10,
      invoice: { fechaEmision: '2026-03-01' },
      catalogItem: {
        id: `x${i}`,
        nombre: `Prod ${i}`,
        codigo: `C${i}`,
        unidad: 'NIU',
        kind: 'PRODUCT',
        precioCompra: 10,
      },
    });
  }
  const r = analisisModel.buildResumenFromDetails(many, {
    solo_costo: '1',
    orden: 'peor_margen',
    top: 2,
  }, { periodo: 'custom', desde: '2026-03-01', hasta: '2026-03-01' });
  assert.strictEqual(r.productos.length, 2);
  assert.ok(r.productos[0].margen_pct <= r.productos[1].margen_pct);
  assert.strictEqual(r.total_productos, 5);
});

test('serie diaria cubre todo el rango', () => {
  const r = analisisModel.buildResumenFromDetails(sample, {
    solo_costo: '1',
  }, { periodo: 'custom', desde: '2026-03-01', hasta: '2026-03-03' });
  assert.strictEqual(r.charts.serie.length, 3);
  assert.strictEqual(r.charts.serie[0].fecha, '2026-03-01');
  assert.strictEqual(r.charts.serie[2].fecha, '2026-03-03');
  assert.strictEqual(r.charts.serie[2].venta, 0);
});

test('charts.mix cuadra con kpis', () => {
  const r = analisisModel.buildResumenFromDetails(sample, {
    solo_costo: '1',
  }, { periodo: 'custom', desde: '2026-03-01', hasta: '2026-03-02' });
  assert.strictEqual(r.charts.mix.venta, r.kpis.venta);
  assert.strictEqual(r.charts.mix.costo, r.kpis.costo);
  assert.strictEqual(r.charts.mix.margen, r.kpis.margen);
});
test('gráficos usan solo el Top N del filtro', () => {
  const many = [];
  for (let i = 0; i < 15; i += 1) {
    many.push({
      cantidad: 15 - i,
      totalFactura: (15 - i) * 20,
      precioCompra: 5,
      invoice: { fechaEmision: '2026-03-01' },
      catalogItem: {
        id: `t${i}`,
        nombre: `Top ${i}`,
        codigo: `T${i}`,
        unidad: 'NIU',
        kind: 'PRODUCT',
        precioCompra: 5,
      },
    });
  }
  const r = analisisModel.buildResumenFromDetails(many, {
    solo_costo: '1',
    orden: 'unidades',
    top: 10,
  }, { periodo: 'custom', desde: '2026-03-01', hasta: '2026-03-01' });
  assert.strictEqual(r.productos.length, 10);
  assert.strictEqual(r.charts.top_n.length, 10);
  assert.strictEqual(r.charts.top_unidades.length, 10);
  assert.ok(r.total_productos >= 10);
});
test('más vendido no tiene por qué ser el de mayor margen', () => {
  const details = [
    {
      // Muchas unidades, margen bajo
      cantidad: 100,
      totalFactura: 1000,
      precioCompra: 9,
      invoice: { fechaEmision: '2026-03-01' },
      catalogItem: {
        id: 'volumen',
        nombre: 'Cable barato',
        codigo: 'VOL',
        unidad: 'MTR',
        kind: 'PRODUCT',
        precioCompra: 9,
      },
    },
    {
      // Pocas unidades, margen alto
      cantidad: 2,
      totalFactura: 400,
      precioCompra: 50,
      invoice: { fechaEmision: '2026-03-01' },
      catalogItem: {
        id: 'premium',
        nombre: 'Equipo premium',
        codigo: 'PRE',
        unidad: 'NIU',
        kind: 'PRODUCT',
        precioCompra: 50,
      },
    },
  ];
  const r = analisisModel.buildResumenFromDetails(details, {
    solo_costo: '1',
    top: 10,
  }, { periodo: 'custom', desde: '2026-03-01', hasta: '2026-03-01' });
  assert.strictEqual(r.charts.top_unidades[0].id, 'volumen');
  assert.strictEqual(r.charts.top_margen_pct[0].id, 'premium');
  assert.notStrictEqual(r.charts.top_unidades[0].id, r.charts.top_margen_pct[0].id);
});

console.log('\n== snapshot precio_compra (emisión) ==');
test('snapshotPrecioCompra null si no hay costo', () => {
  assert.strictEqual(comprobanteModel.snapshotPrecioCompra({}), null);
  assert.strictEqual(comprobanteModel.snapshotPrecioCompra({ precioCompra: null }), null);
  assert.strictEqual(comprobanteModel.snapshotPrecioCompra({ precio_compra: '' }), null);
});
test('snapshotPrecioCompra lee precioCompra o precio_compra', () => {
  assert.strictEqual(comprobanteModel.snapshotPrecioCompra({ precioCompra: 12.5 }), 12.5);
  assert.strictEqual(comprobanteModel.snapshotPrecioCompra({ precio_compra: '9.99' }), 9.99);
});
test('calcularLinea no altera totales y copia precioCompra', () => {
  const item = {
    nombre: 'X',
    descripcion: 'X',
    unidad: 'NIU',
    precioUnitario: 118,
    afectacionIgv: '10',
    precioCompra: 80,
  };
  const linea = comprobanteModel.calcularLinea(item, 1);
  assert.strictEqual(linea.precioCompra, 80);
  assert.ok(linea.mtoPrecioUnitario === 118);
  assert.ok(linea.mtoIgv > 0);
  assert.ok(Math.abs(linea.totalFactura - 118) < 0.02);
});
test('calcularLinea sin costo deja precioCompra null (no 0 forzado)', () => {
  const linea = comprobanteModel.calcularLinea({
    nombre: 'Y',
    unidad: 'NIU',
    precioUnitario: 10,
    afectacionIgv: '20',
  }, 2);
  assert.strictEqual(linea.precioCompra, null);
  assert.strictEqual(linea.totalFactura, 20);
});

console.log(`\nResultado: ${passed} ok, ${failed} fail`);
process.exit(failed ? 1 : 0);

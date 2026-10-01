/**
 * El lote es opcional. Si el ingreso trae el id, se conserva.
 */
const catalogItemModel = require('../src/models/catalogItemModel');
const { validarLoteIngreso } = require('../src/models/movimientoModel');

let failed = 0;

function check(name, actual, expected) {
  const ok = actual === expected;
  if (!ok) {
    failed += 1;
    console.error('FAIL', name, 'esperado', expected, 'obtuvo', actual);
  } else {
    console.log('ok', name);
  }
}

const conLote = catalogItemModel.parseBody({
  kind: 'PRODUCT',
  nombre: 'Paracetamol',
  manejaLote: 'on',
  manejaVencimiento: 'on',
});
check('producto con lote', conLote.manejaLote, true);
check('producto con vencimiento', conLote.manejaVencimiento, true);

const sinMarca = catalogItemModel.parseBody({ kind: 'PRODUCT', nombre: 'Cable' });
check('sin marca no pide lote', sinMarca.manejaLote, false);
check('sin marca no pide vencimiento', sinMarca.manejaVencimiento, false);

const servicio = catalogItemModel.parseBody({
  kind: 'SERVICE',
  nombre: 'Consulta',
  manejaLote: 'on',
  manejaVencimiento: 'on',
});
check('servicio ignora lote', servicio.manejaLote, false);
check('servicio ignora vencimiento', servicio.manejaVencimiento, false);

const itemLote = { manejaLote: true, manejaVencimiento: false, nombre: 'Amox' };
check('ingreso sin lote elegido', validarLoteIngreso(itemLote, { lote: 'L-1' }), null);
check('ingreso con lote elegido', validarLoteIngreso(itemLote, { productoLoteId: 'lot-1' }), null);

const itemVence = { manejaLote: false, manejaVencimiento: true, nombre: 'Jarabe' };
check('ingreso sin fecha', validarLoteIngreso(itemVence, { fechaVencimiento: '' }), null);
check('fecha invalida', validarLoteIngreso(itemVence, { fechaVencimiento: '31/09/2026' }), null);
check('fecha valida', validarLoteIngreso(itemVence, { fechaVencimiento: '2027-07-02' }), null);

const ambos = { manejaLote: true, manejaVencimiento: true };
check('sin lote tambien pasa', validarLoteIngreso(ambos, { lote: 'L-1', fechaVencimiento: '2027-07-02' }), null);
check('lote elegido cubre la fecha', validarLoteIngreso(ambos, { productoLoteId: 'lot-1' }), null);
check('producto sin control', validarLoteIngreso({ manejaLote: false, manejaVencimiento: false }, {}), null);

const { normalizeIncomingLineas } = require('../src/models/movimientoModel');
const conservado = normalizeIncomingLineas([{
  catalog_item_id: 'item-1',
  cantidad: 100,
  producto_lote_id: 'lot-leche',
  lote: 'LOTELECHE',
  fecha_vencimiento: '2027-01-01',
}])[0];
check('el id del lote se conserva', conservado && conservado.productoLoteId, 'lot-leche');

if (failed) {
  console.error(failed + ' fallas');
  process.exit(1);
}
console.log('todo ok');

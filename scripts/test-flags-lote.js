/**
 * Reglas de lote y vencimiento: el catálogo solo marca las opciones
 * y el ingreso exige el dato cuando el producto las tiene.
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
check('ingreso sin lote', validarLoteIngreso(itemLote, { lote: '' }), 'lote_requerido');
check('ingreso con lote', validarLoteIngreso(itemLote, { lote: 'L-1' }), null);

const itemVence = { manejaLote: false, manejaVencimiento: true, nombre: 'Jarabe' };
check('ingreso sin fecha', validarLoteIngreso(itemVence, { fechaVencimiento: '' }), 'vencimiento_requerido');
check('fecha invalida', validarLoteIngreso(itemVence, { fechaVencimiento: '31/09/2026' }), 'vencimiento_requerido');
check('fecha valida', validarLoteIngreso(itemVence, { fechaVencimiento: '2027-07-02' }), null);

const ambos = { manejaLote: true, manejaVencimiento: true };
check('pide fecha aunque haya lote', validarLoteIngreso(ambos, { lote: 'L-1', fechaVencimiento: '' }), 'vencimiento_requerido');
check('completo', validarLoteIngreso(ambos, { lote: 'L-1', fechaVencimiento: '2027-07-02' }), null);
check('regreso con id no vuelve a pedir', validarLoteIngreso(ambos, { productoLoteId: 'abc' }), null);
check('producto sin control', validarLoteIngreso({ manejaLote: false, manejaVencimiento: false }, {}), null);

if (failed) {
  console.error(failed + ' fallas');
  process.exit(1);
}
console.log('todo ok');

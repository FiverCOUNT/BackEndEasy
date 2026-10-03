/**
 * Origen / destino legibles de un movimiento (quién → dónde).
 * No usa el tipo de referencia como "origen".
 */

function resolveOrigenDestinoLabels(m, almacenesById = {}) {
  const tipo = String(m.tipo || '').toUpperCase();
  const alm = almacenesById[m.almacen_id] || m.almacenNombre || 'Almacén';
  const destAlm = almacenesById[m.almacen_destino_id] || m.almacenDestinoNombre || '';
  const cliente = m.cliente?.razon_social
    || m.clienteNombre
    || (m.cliente?.numero_doc || m.clienteDoc
      ? `Doc. ${m.cliente?.numero_doc || m.clienteDoc}`
      : '');
  const ref = String(m.referencia_tipo || m.refTipo || '').toUpperCase();
  const esCompra = ref === 'COMPRA' || ref.startsWith('COMPRA');

  if (tipo === 'ENTRADA') {
    const origen = cliente || (esCompra ? 'Proveedor' : 'Recepción externa');
    return { origenNombre: origen, destinoNombre: alm, esTraslado: false };
  }
  if (destAlm) {
    return { origenNombre: alm, destinoNombre: destAlm, esTraslado: true };
  }
  return {
    origenNombre: alm,
    destinoNombre: cliente || 'Cliente',
    esTraslado: false,
  };
}

module.exports = { resolveOrigenDestinoLabels };

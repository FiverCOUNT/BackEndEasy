/** GRE por evento — RS 000123-2022 arts. 7 y 19-B (SEE-SOL). */

const TIPOS_EVENTO_GRE = [
  {
    codigo: '1',
    titulo: 'Transbordo no programado',
    // Art. 7.2: otro vehículo del mismo remitente (privado) o del mismo transportista (público).
    // En SOL solo se actualizan vehículo y conductor; partida/llegada se mantienen.
    detalle: 'Otro vehículo del mismo emisor. Solo cambian placa y conductor.',
    pidePartida: false,
    pideLlegada: false,
    pideVehiculo: true,
    pideConductor: true,
    vehiculoNuevo: true,
    tramoFijo: true,
  },
  {
    codigo: '2',
    titulo: 'Imposibilidad de arribo al punto de llegada',
    // Art. 7.1: parte a otro lugar; destinatario el mismo.
    detalle: 'No se puede arribar al destino. Nuevo punto de llegada; destinatario igual.',
    pidePartida: true,
    pideLlegada: true,
    pideVehiculo: true,
    pideConductor: true,
    vehiculoNuevo: false,
    llegadaNueva: true,
  },
  {
    codigo: '3',
    titulo: 'Imposibilidad de entrega de los bienes en el punto de llegada',
    // Art. 7.1: no se puede entregar; destinatario el mismo.
    detalle: 'No se puede entregar en el destino. Nuevo punto de llegada; destinatario igual.',
    pidePartida: true,
    pideLlegada: true,
    pideVehiculo: true,
    pideConductor: true,
    vehiculoNuevo: false,
    llegadaNueva: true,
  },
];

const PASOS_GRE_EVENTO = [
  { id: 1, key: 'evento', titulo: 'Tipo de evento', corto: 'Evento' },
  { id: 2, key: 'documento', titulo: 'Documento relacionado', corto: 'Documento' },
  { id: 3, key: 'detalle', titulo: 'Detalle de la GRE', corto: 'Detalle' },
  { id: 4, key: 'tramo', titulo: 'Nuevo tramo', corto: 'Tramo' },
  { id: 5, key: 'transporte', titulo: 'Vehículo y conductor', corto: 'Transporte' },
  { id: 6, key: 'resumen', titulo: 'Observación y resumen', corto: 'Resumen' },
];

function tipoEventoPorCodigo(codigo) {
  const raw = String(codigo || '').trim();
  if (!raw) return null;
  const n = String(Number.parseInt(raw, 10));
  return TIPOS_EVENTO_GRE.find((t) => t.codigo === raw || t.codigo === n) || null;
}

module.exports = {
  TIPOS_EVENTO_GRE,
  PASOS_GRE_EVENTO,
  tipoEventoPorCodigo,
};

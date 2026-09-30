/** Catálogo N.° 20 SUNAT — motivos GRE remitente (alineado a la app móvil). */
const MOTIVOS_TRASLADO_GRE = [
  {
    codigo: '01',
    titulo: 'Venta',
    detalle: 'Entrega de mercadería al cliente como parte de una venta.',
    docs: 'facturas',
  },
  {
    codigo: '04',
    titulo: 'Traslado entre establecimientos',
    detalle: 'Mover bienes entre almacenes, sucursales o locales propios.',
    docs: 'ninguno',
    destinatarioFijo: true,
  },
  {
    codigo: '02',
    titulo: 'Compra',
    detalle: 'El comprador traslada los bienes. Destinatario = tu RUC (bloqueado).',
    docs: 'compras',
    destinatarioFijo: true,
  },
  {
    codigo: '06',
    titulo: 'Devolución',
    detalle: 'Devolver productos al proveedor o recibir devoluciones de clientes.',
    docs: 'mixto',
  },
  {
    codigo: '03',
    titulo: 'Venta con entrega a terceros',
    detalle: 'Quien recibe no es el comprador. Edita el destinatario.',
    docs: 'facturas',
  },
  {
    codigo: '13',
    titulo: 'Otros',
    detalle: 'Otros motivos de traslado.',
    docs: 'opcional',
  },
];

const MODALIDADES_TRANSPORTE = [
  {
    codigo: '01',
    titulo: 'Transporte público',
    detalle: 'Empresa de transporte regular (ajeno)',
  },
  {
    codigo: '02',
    titulo: 'Transporte privado',
    detalle: 'Vehículo propio o contratado (default)',
  },
];

const UNIDADES_PESO = [
  { codigo: 'KGM', titulo: 'Kilogramos (kg)' },
  { codigo: 'TNE', titulo: 'Toneladas (t)' },
];

const PASOS_GRE_REMITENTE = [
  { id: 1, key: 'motivo', titulo: 'Motivo SUNAT', corto: 'Motivo' },
  { id: 2, key: 'bienes', titulo: 'Detalle de bienes', corto: 'Bienes' },
  { id: 3, key: 'carga', titulo: 'Datos de la carga', corto: 'Carga' },
  { id: 4, key: 'ruta', titulo: 'Ruta', corto: 'Ruta' },
  { id: 5, key: 'modalidad', titulo: 'Modalidad', corto: 'Modalidad' },
  { id: 6, key: 'transporte', titulo: 'Transporte', corto: 'Transporte' },
  { id: 7, key: 'resumen', titulo: 'Fechas y resumen', corto: 'Resumen' },
];

function motivoPorCodigo(codigo) {
  return MOTIVOS_TRASLADO_GRE.find((m) => m.codigo === String(codigo || '')) || MOTIVOS_TRASLADO_GRE[0];
}

module.exports = {
  MOTIVOS_TRASLADO_GRE,
  MODALIDADES_TRANSPORTE,
  UNIDADES_PESO,
  PASOS_GRE_REMITENTE,
  motivoPorCodigo,
};

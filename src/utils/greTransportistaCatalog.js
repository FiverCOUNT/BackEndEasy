/** Wizard GRE transportista — alineado a la app móvil (RS 123-2022 / Anexo IX). */

const PASOS_GRE_TRANSPORTISTA = [
  { id: 1, key: 'documento', titulo: 'Documento relacionado', corto: 'Documento' },
  { id: 2, key: 'remitente', titulo: 'Remitente', corto: 'Remitente' },
  { id: 3, key: 'destinatario', titulo: 'Destinatario', corto: 'Destino' },
  { id: 4, key: 'bienes', titulo: 'Bienes y peso', corto: 'Bienes' },
  { id: 5, key: 'ruta', titulo: 'Ruta', corto: 'Ruta' },
  { id: 6, key: 'transporte', titulo: 'Vehículo y conductor', corto: 'Transporte' },
  { id: 7, key: 'pagador', titulo: 'Fecha y flete', corto: 'Flete' },
  { id: 8, key: 'resumen', titulo: 'Resumen', corto: 'Resumen' },
];

/** Catálogo campo 29 — pagador del flete (GRE-T). */
const PAGADORES_FLETE_GRE = [
  {
    codigo: 'REMITENTE',
    titulo: 'Remitente',
    detalle: 'Usa los datos del remitente del traslado',
  },
  {
    codigo: 'SUBCONTRATADO',
    titulo: 'Transportista subcontratado',
    detalle: 'Quien te subcontrató paga el flete (pon su RUC, no el tuyo)',
  },
  {
    codigo: 'TERCERO',
    titulo: 'Tercero (otros)',
    detalle: 'Un tercero distinto asume el costo',
  },
];

const UNIDADES_PESO_GRE_T = [
  { codigo: 'KGM', titulo: 'Kilogramos (kg)' },
  { codigo: 'TNE', titulo: 'Toneladas (t)' },
];

const UNIDADES_BIEN_GRE = [
  { codigo: 'NIU', titulo: 'Unidad' },
  { codigo: 'ZZ', titulo: 'Servicio' },
  { codigo: 'KGM', titulo: 'Kilogramo' },
  { codigo: 'LTR', titulo: 'Litro' },
  { codigo: 'MTR', titulo: 'Metro' },
  { codigo: 'BOX', titulo: 'Caja' },
  { codigo: 'PK', titulo: 'Paquete' },
];

function pagadorPorCodigo(codigo) {
  return PAGADORES_FLETE_GRE.find((p) => p.codigo === String(codigo || '').toUpperCase())
    || PAGADORES_FLETE_GRE[0];
}

module.exports = {
  PASOS_GRE_TRANSPORTISTA,
  PAGADORES_FLETE_GRE,
  UNIDADES_PESO_GRE_T,
  UNIDADES_BIEN_GRE,
  pagadorPorCodigo,
};

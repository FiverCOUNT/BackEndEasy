/** Indicadores SUNAT del bloque envío GRE (Anexo V / RS 123-2022). */

const GRE_ENVIO_INDICADORES = {
  /** Traslado en vehículos categoría M1 o L (moto/cuatri/auto ≤8 asientos). */
  VEHICULO_M1_L: 'SUNAT_Envio_IndicadorTrasladoVehiculoM1L',
  /** Registrar vehículos/conductores del transportista (GRE-R público). */
  VEHICULO_CONDUCTORES_TRANSP: 'SUNAT_Envio_IndicadorVehiculoConductoresTransp',
  TRANSBORDO_PROGRAMADO: 'SUNAT_Envio_IndicadorTransbordoProgramado',
};

const M1_L_ALIASES = [
  /^SUNAT_Envio_IndicadorTrasladoVehiculoM1L$/i,
  /^SUNAT_Envio_IndicadorVehiculoCategoriaM1L$/i,
  /^VEHICULO_M1_L$/i,
  /^M1_L$/i,
];

function normalizeIndicadores(list) {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.map((x) => String(x || '').trim()).filter(Boolean))];
}

function tieneIndicadorVehiculoM1L(envioOrIndicadores) {
  const list = Array.isArray(envioOrIndicadores)
    ? envioOrIndicadores
    : (envioOrIndicadores?.indicadores || []);
  return normalizeIndicadores(list).some((tag) => M1_L_ALIASES.some((re) => re.test(tag)));
}

/**
 * Aplica el flag UI `traslado_vehiculo_m1_l` → tag SUNAT en envio.indicadores.
 * Si es false, quita aliases previos del tag.
 */
function aplicarIndicadorVehiculoM1L(envio, activo) {
  if (!envio || typeof envio !== 'object') return;
  const prev = normalizeIndicadores(envio.indicadores);
  const sinM1 = prev.filter((tag) => !M1_L_ALIASES.some((re) => re.test(tag)));
  envio.indicadores = activo
    ? [...sinM1, GRE_ENVIO_INDICADORES.VEHICULO_M1_L]
    : sinM1;
  envio.traslado_vehiculo_m1_l = Boolean(activo);
}

function truthyFlag(value) {
  if (value === true || value === 1) return true;
  const s = String(value || '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'si' || s === 'sí' || s === 'yes' || s === 'on';
}

module.exports = {
  GRE_ENVIO_INDICADORES,
  normalizeIndicadores,
  tieneIndicadorVehiculoM1L,
  aplicarIndicadorVehiculoM1L,
  truthyFlag,
};

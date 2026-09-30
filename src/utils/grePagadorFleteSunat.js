/** Catálogo SUNAT campo 29 — pagador del flete en GRE transportista (Anexo IX / RS 123-2022). */
const PAGADOR_FLETE_TAGS = {
  REMITENTE: 'SUNAT_Envio_IndicadorPagadorFlete_Remitente',
  SUBCONTRATADO: 'SUNAT_Envio_IndicadorPagadorFlete_Subcontratador',
  TERCERO: 'SUNAT_Envio_IndicadorPagadorFlete_Tercero',
};

const INDICADORES_PAGADOR_LEGACY = [
  /^SUNAT_Envio_IndicadorPagadorFlete_/i,
  /^SUNAT_Envio_IndicadorTransporteSubcontratado$/i,
  /^SUNAT_Envio_IndicadorTrasporteSubcontratado$/i,
];

function indicadorPagadorFleteSunat(indicador) {
  const ind = String(indicador || 'REMITENTE').trim().toUpperCase();
  if (ind === 'SUBCONTRATADO') return PAGADOR_FLETE_TAGS.SUBCONTRATADO;
  if (ind === 'TERCERO') return PAGADOR_FLETE_TAGS.TERCERO;
  return PAGADOR_FLETE_TAGS.REMITENTE;
}

/** Reemplaza indicadores de pagador erróneos y deja solo el tag SUNAT válido para GRE-T. */
function aplicarIndicadorPagadorFleteGreT(envio, indicadorPagador) {
  if (!envio || typeof envio !== 'object') return;
  const tag = indicadorPagadorFleteSunat(indicadorPagador);
  const prev = Array.isArray(envio.indicadores) ? envio.indicadores : [];
  const filtrados = prev.filter((x) => {
    const v = String(x || '').trim();
    return !INDICADORES_PAGADOR_LEGACY.some((re) => re.test(v));
  });
  envio.indicadores = [...new Set([...filtrados, tag])];
}

function esGreTransportistaBody(body) {
  const tipo = String(body?.tipo || '').trim().toUpperCase();
  const tipoDoc = String(body?.tipo_doc || body?.tipoDoc || '').padStart(2, '0');
  return tipo.includes('TRANSPORTISTA') || tipoDoc === '31';
}

module.exports = {
  PAGADOR_FLETE_TAGS,
  indicadorPagadorFleteSunat,
  aplicarIndicadorPagadorFleteGreT,
  esGreTransportistaBody,
};

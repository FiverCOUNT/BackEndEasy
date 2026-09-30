const TIPO_DOC_LABEL = {
  '01': 'Factura',
  '03': 'Boleta',
  '07': 'Nota crédito',
  '08': 'Nota débito',
  '09': 'Guía remisión remitente',
  '31': 'Guía remisión transportista',
};

const COD_TO_TIPO = {
  '01': 'FACTURA',
  '03': 'BOLETA',
  '07': 'NOTA_CREDITO',
  '08': 'NOTA_DEBITO',
  '09': 'GUIA_EMISION',
  '31': 'GUIA_TRANSPORTISTA',
};

/** correlativoInicio = último número ya usado (0 = el siguiente será 1). */
const TIPO_CONFIG = {
  FACTURA: { tipoDoc: '01', serie: 'F001', correlativoInicio: 0 },
  BOLETA: { tipoDoc: '03', serie: 'B001', correlativoInicio: 0 },
  NOTA_CREDITO: { tipoDoc: '07', serie: 'FC01', correlativoInicio: 0 },
  NOTA_DEBITO: { tipoDoc: '08', serie: 'FD01', correlativoInicio: 0 },
  GUIA_EMISION: { tipoDoc: '09', serie: 'T001', correlativoInicio: 0 },
  GUIA_TRANSPORTISTA: { tipoDoc: '31', serie: 'V001', correlativoInicio: 0 },
};

const EMITIBLE_TIPO_DOCS = ['01', '03', '07', '08', '09'];
const ALL_SERIE_TIPO_DOCS = [...EMITIBLE_TIPO_DOCS, '31'];
const SERIES_FORM_TIPO_DOCS = ALL_SERIE_TIPO_DOCS;
const DEFAULT_CORRELATIVO_DIGITOS = 8;
const MIN_CORRELATIVO_DIGITOS = 1;
const MAX_CORRELATIVO_DIGITOS = 20;
const SERIE_SUNAT_LENGTH = 4;
const SERIE_SUNAT_PATTERN = /^[A-Z0-9]{4}$/;

function normalizeSerie(value, fallback) {
  const serie = String(value || '').trim().toUpperCase();
  return serie || fallback;
}

function validateSerieSunat(serie, tipoDoc = '01') {
  const label = TIPO_DOC_LABEL[tipoDoc] || `tipo ${tipoDoc}`;
  const normalized = String(serie || '').trim().toUpperCase();

  if (normalized.length !== SERIE_SUNAT_LENGTH) {
    return `La serie de ${label} debe tener exactamente ${SERIE_SUNAT_LENGTH} caracteres (ej. F001). Valor: "${normalized || '(vacío)'}".`;
  }
  if (!SERIE_SUNAT_PATTERN.test(normalized)) {
    return `La serie de ${label} solo admite letras y números (${SERIE_SUNAT_LENGTH} caracteres).`;
  }
  return null;
}

function validateSeriesConfig(seriesConfig) {
  const map = normalizeStoredSeriesConfig(seriesConfig);
  const errors = [];

  for (const tipoDoc of SERIES_FORM_TIPO_DOCS) {
    const error = validateSerieSunat(map[tipoDoc].serie, tipoDoc);
    if (error) errors.push(error);
  }

  return errors.length ? errors.join(' ') : null;
}

function parseCorrelativoNumber(value) {
  const n = Number.parseInt(String(value ?? '').replace(/\D/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
}

function normalizeCorrelativoDigitos(value, fallback = DEFAULT_CORRELATIVO_DIGITOS) {
  const n = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MAX_CORRELATIVO_DIGITOS, Math.max(MIN_CORRELATIVO_DIGITOS, n));
}

function formatCorrelativo(number, width = DEFAULT_CORRELATIVO_DIGITOS) {
  const n = Math.max(1, Number.parseInt(String(number), 10) || 1);
  const digits = normalizeCorrelativoDigitos(width);
  return String(n).padStart(digits, '0');
}

function normalizeCorrelativoInicio(value, fallback = 0) {
  const n = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

function defaultSeriesConfig() {
  return {
    '01': { serie: 'F001', correlativo_inicio: 0, correlativo_digitos: DEFAULT_CORRELATIVO_DIGITOS },
    '03': { serie: 'B001', correlativo_inicio: 0, correlativo_digitos: DEFAULT_CORRELATIVO_DIGITOS },
    '07': { serie: 'FC01', correlativo_inicio: 0, correlativo_digitos: DEFAULT_CORRELATIVO_DIGITOS },
    '08': { serie: 'FD01', correlativo_inicio: 0, correlativo_digitos: DEFAULT_CORRELATIVO_DIGITOS },
    '09': { serie: 'T001', correlativo_inicio: 0, correlativo_digitos: DEFAULT_CORRELATIVO_DIGITOS },
    '31': { serie: 'V001', correlativo_inicio: 0, correlativo_digitos: DEFAULT_CORRELATIVO_DIGITOS },
  };
}

function normalizeStoredSeriesConfig(raw) {
  if (!raw || typeof raw !== 'object') return defaultSeriesConfig();

  const defaults = defaultSeriesConfig();
  const merged = { ...defaults };

  for (const tipoDoc of ALL_SERIE_TIPO_DOCS) {
    const entry = raw[tipoDoc];
    if (!entry || typeof entry !== 'object') continue;

    const serie = normalizeSerie(entry.serie || entry.serie_doc, defaults[tipoDoc].serie);
    const inicio = normalizeCorrelativoInicio(
      entry.correlativo_inicio ?? entry.correlativoInicio,
      defaults[tipoDoc].correlativo_inicio,
    );
    const digitos = normalizeCorrelativoDigitos(
      entry.correlativo_digitos ?? entry.correlativoDigitos,
      defaults[tipoDoc].correlativo_digitos,
    );

    merged[tipoDoc] = {
      serie: serie || defaults[tipoDoc].serie,
      correlativo_inicio: inicio,
      correlativo_digitos: digitos,
    };
  }

  return merged;
}

function resolveTipoConfig(tipoRaw, company = null) {
  const key = String(tipoRaw || '').trim().toUpperCase();
  let base = TIPO_CONFIG[key];
  if (!base && COD_TO_TIPO[key]) base = TIPO_CONFIG[COD_TO_TIPO[key]];
  if (!base) throw new Error(`Tipo de comprobante no válido: ${tipoRaw}`);

  const seriesMap = normalizeStoredSeriesConfig(company?.seriesConfigJson);
  const stored = seriesMap[base.tipoDoc] || {};

  return {
    tipoDoc: base.tipoDoc,
    serie: stored.serie || base.serie,
    correlativoInicio: stored.correlativo_inicio ?? base.correlativoInicio ?? 0,
    correlativoDigitos: stored.correlativo_digitos ?? DEFAULT_CORRELATIVO_DIGITOS,
  };
}

function buildSeriesConfigFromBody(body) {
  const config = {};
  const defaults = defaultSeriesConfig();

  for (const tipoDoc of SERIES_FORM_TIPO_DOCS) {
    const serie = String(body[`serie_${tipoDoc}`] || '').trim();
    const inicioRaw = String(body[`correlativo_inicio_${tipoDoc}`] || '').trim();
    const digitosRaw = String(body[`correlativo_digitos_${tipoDoc}`] || '').trim();

    if (!serie && !inicioRaw && !digitosRaw) continue;

    config[tipoDoc] = {
      serie: normalizeSerie(serie, defaults[tipoDoc].serie),
      correlativo_inicio: inicioRaw
        ? normalizeCorrelativoInicio(inicioRaw, defaults[tipoDoc].correlativo_inicio)
        : defaults[tipoDoc].correlativo_inicio,
      correlativo_digitos: digitosRaw
        ? normalizeCorrelativoDigitos(digitosRaw, defaults[tipoDoc].correlativo_digitos)
        : defaults[tipoDoc].correlativo_digitos,
    };
  }

  return Object.keys(config).length
    ? { ...normalizeStoredSeriesConfig(config), _correlativoSemantics: 'last_used' }
    : null;
}

function seriesConfigToFormFields(seriesConfigJson) {
  const map = normalizeStoredSeriesConfig(seriesConfigJson);
  const form = {};

  for (const tipoDoc of SERIES_FORM_TIPO_DOCS) {
    form[`serie_${tipoDoc}`] = map[tipoDoc].serie;
    form[`correlativo_inicio_${tipoDoc}`] = String(map[tipoDoc].correlativo_inicio);
    form[`correlativo_digitos_${tipoDoc}`] = String(map[tipoDoc].correlativo_digitos);
  }

  return form;
}

module.exports = {
  TIPO_DOC_LABEL,
  COD_TO_TIPO,
  TIPO_CONFIG,
  EMITIBLE_TIPO_DOCS,
  ALL_SERIE_TIPO_DOCS,
  SERIES_FORM_TIPO_DOCS,
  DEFAULT_CORRELATIVO_DIGITOS,
  MIN_CORRELATIVO_DIGITOS,
  MAX_CORRELATIVO_DIGITOS,
  SERIE_SUNAT_LENGTH,
  validateSerieSunat,
  validateSeriesConfig,
  parseCorrelativoNumber,
  normalizeCorrelativoInicio,
  normalizeCorrelativoDigitos,
  formatCorrelativo,
  defaultSeriesConfig,
  normalizeStoredSeriesConfig,
  resolveTipoConfig,
  buildSeriesConfigFromBody,
  seriesConfigToFormFields,
};

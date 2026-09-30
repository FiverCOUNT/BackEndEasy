/**
 * Datos iniciales de factura, alineados al asistente de SUNAT.
 * Por defecto, igual que el portal: contado, soles y No en cada pregunta.
 * En boleta solo cuentan contado/crédito y moneda. El resto no se declara.
 */

const FLAGS = [
  ['detraccion', 'operaciones sujetas a detracción'],
  ['colaboracion', 'contrato de colaboración empresarial'],
  ['anticipo', 'pago anticipado'],
  ['itinerante', 'emisor itinerante'],
  ['establecimiento', 'establecimiento del emisor'],
  ['direccion_entrega', 'dirección de entrega distinta'],
  ['combustible', 'venta de combustible o mantenimiento de vehículo'],
  ['descuentos', 'descuentos o anticipos'],
  ['isc', 'ISC'],
  ['gratuita', 'operaciones gratuitas'],
  ['otros_tributos', 'otros tributos fuera de la base del IGV'],
];

/** Catálogo SUNAT de medios de pago usado en la detracción. */
const MEDIOS_PAGO_DETRACCION = [
  ['001', 'Depósito en cuenta'],
  ['002', 'Giro'],
  ['003', 'Transferencia de fondos'],
  ['004', 'Orden de pago'],
  ['005', 'Tarjeta de débito'],
  ['006', 'Tarjeta de crédito emitida en el país por una empresa del sistema financiero'],
  ['007', 'Cheques con la cláusula de NO NEGOCIABLE, INTRANSFERIBLES, NO A LA ORDEN u otra equivalente'],
  ['008', 'Efectivo, por operaciones en las que no existe obligación de utilizar medio de pago'],
  ['009', 'Efectivo, en los demás casos'],
  ['010', 'Medios de pago usados en comercio exterior'],
  ['011', 'Documentos emitidos por las EDPYMES y las cooperativas de ahorro y crédito no autorizadas a captar depósitos del público'],
  ['012', 'Tarjeta de crédito emitida en el país o en el exterior por una empresa no perteneciente al sistema financiero'],
  ['013', 'Tarjetas de crédito emitidas en el exterior por empresas bancarias o financieras no domiciliadas'],
  ['101', 'Transferencias - Comercio exterior'],
  ['102', 'Cheques bancarios - Comercio exterior'],
  ['103', 'Orden de pago simple - Comercio exterior'],
  ['104', 'Orden de pago documentario - Comercio exterior'],
  ['105', 'Remesa simple - Comercio exterior'],
  ['106', 'Remesa documentaria - Comercio exterior'],
  ['107', 'Carta de crédito simple - Comercio exterior'],
  ['108', 'Carta de crédito documentario - Comercio exterior'],
  ['999', 'Otros medios de pago'],
];

const MEDIOS_PAGO_DETRACCION_SET = new Set(MEDIOS_PAGO_DETRACCION.map(([codigo]) => codigo));

/** Sí que aún no se mandan en el XML (SUNAT pediría pantallas extra). */
const BLOQUEA_SI = new Set([
  'colaboracion',
  'anticipo',
  'itinerante',
  'direccion_entrega',
  'combustible',
  'descuentos',
  'isc',
  'gratuita',
  'otros_tributos',
]);

function yn(value) {
  const s = String(value ?? '').trim().toLowerCase();
  if (s === 'si' || s === 'sí' || s === '1' || s === 'true') return 'si';
  if (s === 'no' || s === '0' || s === 'false') return 'no';
  return '';
}

function isoDay(value) {
  const s = String(value || '').trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const pe = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (pe) return `${pe[3]}-${pe[2].padStart(2, '0')}-${pe[1].padStart(2, '0')}`;
  return '';
}

function emptySunatDatos() {
  const flags = {};
  for (const [key] of FLAGS) flags[key] = 'no';
  return {
    forma_pago: 'contado',
    tipo_moneda: 'PEN',
    fecha_pago: '',
    detraccion_codigo: '',
    detraccion_porcentaje: '',
    detraccion_cuenta: '',
    detraccion_medio_pago: '001',
    detraccion_tipo: '',
    detraccion_extra: {},
    flags,
  };
}

/** Boleta: SUNAT no lleva detracción ni las demás preguntas del paso de factura. */
function sunatParaBoleta(datos) {
  if (!datos) return datos;
  const flags = { ...(datos.flags || {}) };
  for (const [key] of FLAGS) flags[key] = 'no';
  return {
    ...datos,
    flags,
    detraccion_codigo: '',
    detraccion_porcentaje: '',
    detraccion_cuenta: '',
    detraccion_medio_pago: '',
    detraccion_tipo: '',
    detraccion_extra: {},
    tipo_operacion: '0101',
    bloqueos: [],
  };
}

function bodyHasSunat(body) {
  if (!body || typeof body !== 'object') return false;
  return Boolean(
    body.forma_pago
    || body.formaPago
    || body.sunat_datos
    || body.tipo_moneda && body.detraccion,
  );
}

/**
 * @param {object} body
 * @returns {{ ok: true, datos: object } | { ok: false, error: string, datos: object }}
 */
function parseSunatDatos(body = {}) {
  const base = emptySunatDatos();
  const src = body.sunat_datos && typeof body.sunat_datos === 'object' ? body.sunat_datos : body;
  const forma = String(src.forma_pago || src.formaPago || '').trim().toLowerCase();
  base.forma_pago = forma === 'credito' || forma === 'crédito' ? 'credito' : (forma === 'contado' ? 'contado' : '');
  const moneda = String(src.tipo_moneda || src.tipoMoneda || src.moneda || '').trim().toUpperCase();
  base.tipo_moneda = moneda === 'PEN' || moneda === 'USD' ? moneda : '';
  base.fecha_pago = isoDay(src.fecha_pago || src.fechaPago || src.fec_vencimiento || src.fecha_vencimiento);
  base.detraccion_codigo = String(src.detraccion_codigo || '').replace(/\D/g, '').slice(0, 3);
  base.detraccion_porcentaje = String(src.detraccion_porcentaje || '').replace(',', '.').trim();
  base.detraccion_cuenta = String(src.detraccion_cuenta || '').replace(/\D/g, '').slice(0, 20);
  const medio = String(src.detraccion_medio_pago || src.medio_pago || '').replace(/\D/g, '').slice(0, 3);
  base.detraccion_medio_pago = MEDIOS_PAGO_DETRACCION_SET.has(medio) ? medio : '';
  const tipoDet = String(src.detraccion_tipo || '').replace(/\D/g, '').slice(0, 4);
  base.detraccion_tipo = ['1001', '1002', '1003', '1004'].includes(tipoDet) ? tipoDet : '';
  const extraSrc = src.detraccion_extra && typeof src.detraccion_extra === 'object' ? src.detraccion_extra : {};
  const extra = {};
  for (const [key, value] of Object.entries(extraSrc)) {
    const limpio = String(value || '').trim().slice(0, 180);
    if (limpio) extra[String(key).slice(0, 40)] = limpio;
  }
  for (const [key, value] of Object.entries(src)) {
    if (!key.startsWith('dx_')) continue;
    const elegido = Array.isArray(value) ? value[value.length - 1] : value;
    const limpio = String(elegido || '').trim().slice(0, 180);
    if (limpio) extra[key.slice(3, 43)] = limpio;
  }
  base.detraccion_extra = extra;

  for (const [key] of FLAGS) {
    base.flags[key] = yn(src[key] ?? src.flags?.[key]);
  }

  if (!base.forma_pago) {
    return { ok: false, error: 'Indica si la operación es al contado o al crédito.', datos: base };
  }
  if (base.forma_pago === 'credito' && !base.fecha_pago) {
    return {
      ok: false,
      error: 'Al crédito SUNAT exige la fecha en que el cliente pagará la cuota.',
      datos: base,
    };
  }
  if (!base.tipo_moneda) {
    return { ok: false, error: 'Elige la moneda (soles o dólares).', datos: base };
  }
  for (const [key, label] of FLAGS) {
    if (!base.flags[key]) {
      return { ok: false, error: `Responde Sí o No: ${label}.`, datos: base };
    }
  }
  if (base.flags.detraccion === 'si') {
    const pct = Number(base.detraccion_porcentaje);
    if (!base.detraccion_codigo || !Number.isFinite(pct) || pct <= 0 || pct > 100 || base.detraccion_cuenta.length < 4) {
      return {
        ok: false,
        error: 'Detracción: indica el código SUNAT del bien o servicio, el porcentaje y la cuenta del Banco de la Nación.',
        datos: base,
      };
    }
    if (!base.detraccion_tipo) {
      return { ok: false, error: 'Detracción: elige el tipo de operación.', datos: base };
    }
    if (!base.detraccion_medio_pago) {
      return {
        ok: false,
        error: 'Detracción: elige el medio de pago de SUNAT.',
        datos: base,
      };
    }
  }

  const bloqueos = [];
  for (const [key, label] of FLAGS) {
    if (BLOQUEA_SI.has(key) && base.flags[key] === 'si') bloqueos.push(label);
  }

  return {
    ok: true,
    datos: {
      ...base,
      tipo_operacion: base.flags.detraccion === 'si' ? base.detraccion_tipo : '0101',
      bloqueos,
    },
  };
}

function sunatDesdeInvoice(invoice) {
  const meta = invoice?.guiaMetaJson || invoice?.guia_meta || {};
  return meta.sunat_emision || null;
}

module.exports = {
  FLAGS,
  MEDIOS_PAGO_DETRACCION,
  emptySunatDatos,
  sunatParaBoleta,
  bodyHasSunat,
  parseSunatDatos,
  sunatDesdeInvoice,
};

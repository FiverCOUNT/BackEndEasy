/**
 * Fechas como epoch ms (UTC). La app formatea en la zona horaria del dispositivo.
 */

function nowTimestampMs() {
  return Date.now();
}

/** Valor persistido en VARCHAR (ms como string). */
function toStoredTimestamp(ms = nowTimestampMs()) {
  return String(ms);
}

function parseStoredTimestamp(value) {
  if (value == null || value === '') return null;

  const raw = String(value).trim();
  if (/^-?\d{10}$/.test(raw)) return Number(raw) * 1000;
  if (/^-?\d{11,}$/.test(raw)) return Number(raw);

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw) || /^\d{4}-\d{2}-\d{2}T00:00:00(\.0+)?Z?$/i.test(raw)) {
    // Día calendario (date-only o medianoche UTC) → mediodía PE = 17:00 UTC.
    const [y, m, d] = raw.slice(0, 10).split('-').map(Number);
    return Date.UTC(y, m - 1, d, 17, 0, 0, 0);
  }

  const pe = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (pe) {
    // DD/MM/YYYY → día calendario Perú (mediodía PE = 17:00 UTC), igual que YYYY-MM-DD.
    const d = Number(pe[1]);
    const m = Number(pe[2]);
    const y = Number(pe[3]);
    return Date.UTC(y, m - 1, d, 17, 0, 0, 0);
  }

  let iso = raw;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(raw)) {
    iso = `${raw}Z`;
  }

  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/** Normaliza a YYYY-MM-DD (ISO) para filtros y persistencia. */
function normalizeFechaEmision(value) {
  if (value == null || value === '') return null;
  const raw = String(value).trim();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const pe = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (pe) {
    return `${pe[3]}-${pe[2].padStart(2, '0')}-${pe[1].padStart(2, '0')}`;
  }
  const ms = parseStoredTimestamp(raw);
  if (ms == null) return raw.slice(0, 30);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms));
}

/** Respuesta JSON: número epoch ms o null. */
function toApiTimestamp(value) {
  const ms = parseStoredTimestamp(value);
  return ms == null ? null : ms;
}

function compareStoredTimestamps(a, b) {
  const ma = parseStoredTimestamp(a) ?? 0;
  const mb = parseStoredTimestamp(b) ?? 0;
  return ma - mb;
}

/** Inicio del día calendario en Perú (UTC-5, sin DST) para filtros desde/hasta YYYY-MM-DD. */
function calendarDayStartMsPe(yyyyMmDd) {
  if (!yyyyMmDd || !/^\d{4}-\d{2}-\d{2}$/.test(String(yyyyMmDd).trim())) return null;
  const [y, m, d] = String(yyyyMmDd).trim().split('-').map(Number);
  return Date.UTC(y, m - 1, d, 5, 0, 0, 0);
}

/** Fin del día calendario en Perú (23:59:59.999) para filtros desde/hasta YYYY-MM-DD. */
function calendarDayEndMsPe(yyyyMmDd) {
  if (!yyyyMmDd || !/^\d{4}-\d{2}-\d{2}$/.test(String(yyyyMmDd).trim())) return null;
  const [y, m, d] = String(yyyyMmDd).trim().split('-').map(Number);
  return Date.UTC(y, m - 1, d + 1, 4, 59, 59, 999);
}

/** YYYYMM según calendario Perú (America/Lima). */
function periodoActualYyyyMmPe() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(new Date()).map((p) => [p.type, p.value]),
  );
  return `${parts.year}${parts.month}`;
}

/** Hoy YYYY-MM-DD en Perú. */
function hoyIsoPe() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** Suma/resta días a un YYYY-MM-DD (calendario). */
function addDaysIso(yyyyMmDd, deltaDays) {
  const raw = String(yyyyMmDd || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const [y, m, d] = raw.split('-').map(Number);
  const utc = Date.UTC(y, m - 1, d + Number(deltaDays || 0));
  const nd = new Date(utc);
  return `${nd.getUTCFullYear()}-${String(nd.getUTCMonth() + 1).padStart(2, '0')}-${String(nd.getUTCDate()).padStart(2, '0')}`;
}

function ayerIsoPe() {
  return addDaysIso(hoyIsoPe(), -1);
}

/**
 * Presets de periodo estilo app móvil.
 * @param {{ periodo?: string, desde?: string, hasta?: string, fecha?: string }} query
 */
function resolvePeriodoPreset(query = {}) {
  const hoy = hoyIsoPe();
  let periodo = String(query.periodo || '').trim().toLowerCase();
  const fechaQ = String(query.fecha || '').trim().slice(0, 10);
  const desdeQ = String(query.desde || '').trim().slice(0, 10);
  const hastaQ = String(query.hasta || '').trim().slice(0, 10);

  if (!periodo) {
    if (fechaQ || (desdeQ && hastaQ && desdeQ === hastaQ)) periodo = 'fecha';
    else if (desdeQ || hastaQ) periodo = 'rango';
    else periodo = 'hoy';
  }

  if (periodo === 'ayer') {
    const ayer = ayerIsoPe();
    return { periodo: 'ayer', desde: ayer, hasta: ayer, fecha: ayer };
  }
  if (periodo === '7d' || periodo === '7dias' || periodo === '7') {
    return { periodo: '7d', desde: addDaysIso(hoy, -6), hasta: hoy, fecha: hoy };
  }
  if (periodo === 'fecha') {
    const f = (/^\d{4}-\d{2}-\d{2}$/.test(fechaQ) && fechaQ)
      || (/^\d{4}-\d{2}-\d{2}$/.test(desdeQ) && desdeQ)
      || hoy;
    return { periodo: 'fecha', desde: f, hasta: f, fecha: f };
  }
  if (periodo === 'mes' || periodo === 'rango') {
    if (periodo === 'rango' && desdeQ && hastaQ) {
      return { periodo: 'rango', desde: desdeQ, hasta: hastaQ, fecha: hastaQ };
    }
    const y = hoy.slice(0, 4);
    const m = hoy.slice(5, 7);
    const lastDay = new Date(Date.UTC(Number(y), Number(m), 0)).getUTCDate();
    return {
      periodo: 'mes',
      desde: `${y}-${m}-01`,
      hasta: `${y}-${m}-${String(lastDay).padStart(2, '0')}`,
      fecha: hoy,
    };
  }

  // hoy (default, como la app)
  return { periodo: 'hoy', desde: hoy, hasta: hoy, fecha: hoy };
}

function formatPeriodoElegante(desde, hasta) {
  const a = String(desde || '').slice(0, 10);
  const b = String(hasta || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a)) return 'Periodo';
  const opts = { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' };
  const fa = new Date(`${a}T12:00:00Z`).toLocaleDateString('es-PE', opts);
  if (!b || a === b) {
    return fa.charAt(0).toUpperCase() + fa.slice(1);
  }
  const fb = new Date(`${b}T12:00:00Z`).toLocaleDateString('es-PE', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
  return `${a.slice(8, 10)}–${fb}`;
}

/**
 * Rango ISO del periodo YYYYMM (mes selector app).
 * @param {string} periodo YYYYMM
 * @param {{ capHoy?: boolean }} [options] Si true, mes en curso termina hoy (no futuro).
 */
function periodoYyyyMmToRangoIso(periodo, { capHoy = true } = {}) {
  const digits = String(periodo || '').replace(/\D/g, '');
  if (!/^\d{6}$/.test(digits)) {
    const err = new Error('periodo inválido (usa YYYYMM).');
    err.status = 400;
    throw err;
  }
  const y = Number(digits.slice(0, 4));
  const m = Number(digits.slice(4, 6));
  const mes = String(m).padStart(2, '0');
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  let hasta = `${y}-${mes}-${String(lastDay).padStart(2, '0')}`;
  const desde = `${y}-${mes}-01`;
  if (capHoy && digits === periodoActualYyyyMmPe()) {
    const hoy = hoyIsoPe();
    if (hoy < hasta) hasta = hoy;
  }
  return {
    desde,
    hasta,
    fecha_inicio: desde,
    fecha_fin: hasta,
    periodo: `${y}-${mes}`,
  };
}

module.exports = {
  nowTimestampMs,
  toStoredTimestamp,
  parseStoredTimestamp,
  toApiTimestamp,
  compareStoredTimestamps,
  calendarDayStartMsPe,
  calendarDayEndMsPe,
  normalizeFechaEmision,
  periodoActualYyyyMmPe,
  hoyIsoPe,
  ayerIsoPe,
  addDaysIso,
  resolvePeriodoPreset,
  formatPeriodoElegante,
  periodoYyyyMmToRangoIso,
};

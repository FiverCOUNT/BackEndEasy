/** Catálogo SUNAT 13: ubigeo peruano (6 dígitos INEI). */

function normalizeUbigeoDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function isValidUbigeoPeru(value) {
  const digits = normalizeUbigeoDigits(value);
  if (digits.length !== 6) return false;
  const departamento = Number.parseInt(digits.slice(0, 2), 10);
  return Number.isFinite(departamento) && departamento >= 1 && departamento <= 25;
}

function assertUbigeoPeru(value, campo = 'dirección') {
  const digits = normalizeUbigeoDigits(value);
  if (!isValidUbigeoPeru(digits)) {
    const mostrado = digits || String(value || '').trim() || '(vacío)';
    const err = new Error(
      `Ubigeo inválido en ${campo}: "${mostrado}". Debe ser 6 dígitos del catálogo SUNAT/INEI (ej. 150101 para Lima).`,
    );
    err.status = 400;
    throw err;
  }
  return digits;
}

/** Une códigos INEI: región(2) + provincia local(2) + distrito local(2). */
function formarUbigeo(regionCodigo, provinciaLocal, distritoLocal) {
  const r = String(regionCodigo || '').replace(/\D/g, '').padStart(2, '0').slice(-2);
  const p = String(provinciaLocal || '').replace(/\D/g, '').padStart(2, '0').slice(-2);
  const d = String(distritoLocal || '').replace(/\D/g, '').padStart(2, '0').slice(-2);
  return assertUbigeoPeru(`${r}${p}${d}`, 'códigos de ubicación');
}

/** Parte un ubigeo 6 dígitos en región / provincia / distrito. */
function partirUbigeo(ubigeo) {
  const digits = assertUbigeoPeru(ubigeo);
  return {
    regionCodigo: digits.slice(0, 2),
    provinciaLocal: digits.slice(2, 4),
    provinciaCodigo: digits.slice(0, 4),
    distritoLocal: digits.slice(4, 6),
    distritoCodigo: digits,
    ubigeo: digits,
  };
}

module.exports = {
  isValidUbigeoPeru,
  normalizeUbigeoDigits,
  assertUbigeoPeru,
  formarUbigeo,
  partirUbigeo,
};

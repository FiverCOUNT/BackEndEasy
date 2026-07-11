/** Catálogo SUNAT 13: ubigeo peruano (6 dígitos, departamento 01–25). */
function isValidUbigeoPeru(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length !== 6) return false;
  const departamento = Number.parseInt(digits.slice(0, 2), 10);
  return Number.isFinite(departamento) && departamento >= 1 && departamento <= 25;
}

function normalizeUbigeoDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function assertUbigeoPeru(value, campo = 'dirección') {
  const digits = normalizeUbigeoDigits(value);
  if (!isValidUbigeoPeru(digits)) {
    const mostrado = digits || String(value || '').trim() || '(vacío)';
    const err = new Error(
      `Ubigeo inválido en ${campo}: "${mostrado}". Debe ser 6 dígitos del catálogo SUNAT (ej. 150101 para Lima).`,
    );
    err.status = 400;
    throw err;
  }
  return digits;
}

module.exports = {
  isValidUbigeoPeru,
  normalizeUbigeoDigits,
  assertUbigeoPeru,
};

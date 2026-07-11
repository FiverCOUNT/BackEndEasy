require('./env');

const JWT_SECRET = process.env.JWT_SECRET || 'cambiar-en-produccion';
const JWT_REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET || 'cambiar-refresh-en-produccion';

if (process.env.NODE_ENV === 'production' && JWT_SECRET.includes('cambiar')) {
  throw new Error('Define JWT_SECRET y JWT_REFRESH_SECRET en producción');
}

/**
 * Convierte valores tipo "15m", "8h", "30d" a milisegundos.
 * Si no se puede parsear, usa el fallback en ms.
 */
function parseDurationMs(value, fallbackMs) {
  const raw = String(value || '').trim().toLowerCase();
  const match = raw.match(/^(\d+)\s*([smhd])$/);
  if (!match) return fallbackMs;

  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return fallbackMs;

  const unit = match[2];
  const multipliers = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };

  return amount * multipliers[unit];
}

const accessExpiresIn = process.env.JWT_ACCESS_EXPIRES || '30d';
const refreshExpiresIn = process.env.JWT_REFRESH_EXPIRES || '30d';
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

module.exports = {
  jwtSecret: JWT_SECRET,
  jwtRefreshSecret: JWT_REFRESH_SECRET,
  accessExpiresIn,
  refreshExpiresIn,
  refreshExpiresMs: parseDurationMs(refreshExpiresIn, THIRTY_DAYS_MS),
};

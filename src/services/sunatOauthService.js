const TOKEN_URL_EXTRANET =
  'https://api-seguridad.sunat.gob.pe/v1/clientesextranet/{client_id}/oauth2/token/';
const TOKEN_URL_SOL =
  'https://api-seguridad.sunat.gob.pe/v1/clientessol/{client_id}/oauth2/token/';

const DEFAULT_SCOPE =
  process.env.SUNAT_API_SCOPE || 'https://api.sunat.gob.pe/v1/contribuyente/contribuyentes';
const SIRE_SCOPE = process.env.SUNAT_SIRE_SCOPE || 'https://api-sire.sunat.gob.pe';

const tokenCache = new Map();

async function requestToken(url, params) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams(params),
  });

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!res.ok || !data?.access_token) {
    const err = new Error(
      data?.error_description
        || data?.message
        || data?.msg
        || `No se pudo obtener token SUNAT (HTTP ${res.status}).`,
    );
    err.status = res.status === 401 || res.status === 403 ? 401 : 502;
    err.sunat = data;
    throw err;
  }

  return data;
}

/**
 * OAuth2 client_credentials (Credenciales API SUNAT desde SOL).
 */
async function getAccessToken({ clientId, clientSecret, scope = DEFAULT_SCOPE }) {
  const id = String(clientId || '').trim();
  const secret = String(clientSecret || '').trim();
  if (!id || !secret) {
    const err = new Error('Faltan client_id / client_secret de la empresa (Credenciales API SUNAT).');
    err.status = 400;
    throw err;
  }

  const cacheKey = `cc|${id}|${scope}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.accessToken;
  }

  const url = TOKEN_URL_EXTRANET.replace('{client_id}', encodeURIComponent(id));
  const data = await requestToken(url, {
    grant_type: 'client_credentials',
    scope,
    client_id: id,
    client_secret: secret,
  });

  const expiresIn = Number(data.expires_in) || 3600;
  tokenCache.set(cacheKey, {
    accessToken: data.access_token,
    expiresAt: Date.now() + expiresIn * 1000,
  });

  return data.access_token;
}

/**
 * OAuth2 password grant para SIRE (RCE/RVIE).
 * username = {RUC}{usuarioSOL}, password = clave SOL.
 */
async function getSireAccessToken({
  clientId,
  clientSecret,
  ruc,
  solUser,
  solPass,
  scope = SIRE_SCOPE,
}) {
  const id = String(clientId || '').trim();
  const secret = String(clientSecret || '').trim();
  const rucDigits = String(ruc || '').replace(/\D/g, '');
  const user = String(solUser || '').trim();
  const pass = String(solPass || '').trim();

  if (!id || !secret) {
    const err = new Error('Faltan client_id / client_secret para SIRE.');
    err.status = 400;
    throw err;
  }
  if (rucDigits.length !== 11 || !user || !pass) {
    const err = new Error('SIRE requiere RUC + usuario SOL + clave SOL en la empresa.');
    err.status = 400;
    throw err;
  }

  const username = `${rucDigits}${user}`;
  const cacheKey = `pw|${id}|${username}|${scope}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.accessToken;
  }

  const url = TOKEN_URL_SOL.replace('{client_id}', encodeURIComponent(id));
  const data = await requestToken(url, {
    grant_type: 'password',
    scope,
    client_id: id,
    client_secret: secret,
    username,
    password: pass,
  });

  const expiresIn = Number(data.expires_in) || 3600;
  tokenCache.set(cacheKey, {
    accessToken: data.access_token,
    expiresAt: Date.now() + expiresIn * 1000,
  });

  return data.access_token;
}

module.exports = {
  getAccessToken,
  getSireAccessToken,
  DEFAULT_SCOPE,
  SIRE_SCOPE,
};

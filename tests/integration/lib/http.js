'use strict';

const http = require('http');
const https = require('https');
const { URL } = require('url');

function mergeSetCookie(prev, setCookieHeader) {
  const jar = { ...(prev || {}) };
  const headers = Array.isArray(setCookieHeader)
    ? setCookieHeader
    : setCookieHeader
      ? [setCookieHeader]
      : [];
  for (const raw of headers) {
    const pair = String(raw).split(';')[0];
    const eq = pair.indexOf('=');
    if (eq > 0) jar[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return jar;
}

function cookieHeader(jar) {
  return Object.entries(jar || {})
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

/**
 * @param {string} base
 * @param {string} method
 * @param {string} path
 * @param {{ jar?: object, body?: string|object, headers?: object, json?: boolean }} [opts]
 */
function request(base, method, path, opts = {}) {
  const { jar, body, headers = {}, json = false } = opts;
  return new Promise((resolve, reject) => {
    const url = new URL(path, base);
    const lib = url.protocol === 'https:' ? https : http;
    let payload = null;
    const reqHeaders = {
      Accept: 'application/json, text/html, */*',
      ...(jar ? { Cookie: cookieHeader(jar) } : {}),
      ...headers,
    };

    if (body != null) {
      if (typeof body === 'object' && !(body instanceof Buffer)) {
        payload = JSON.stringify(body);
        if (!reqHeaders['Content-Type'] && !reqHeaders['content-type']) {
          reqHeaders['Content-Type'] = 'application/json';
        }
      } else {
        payload = String(body);
      }
      reqHeaders['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = lib.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method,
        headers: reqHeaders,
        rejectUnauthorized: process.env.INTEGRATION_TLS_INSECURE === '1' ? false : true,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let parsed = null;
          if (json || String(res.headers['content-type'] || '').includes('application/json')) {
            try {
              parsed = text ? JSON.parse(text) : null;
            } catch {
              parsed = null;
            }
          }
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: text,
            json: parsed,
            location: res.headers.location || null,
            jar: mergeSetCookie(jar, res.headers['set-cookie']),
          });
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(60000, () => {
      req.destroy(new Error(`timeout ${method} ${path}`));
    });
    if (payload != null) req.write(payload);
    req.end();
  });
}

function unwrapData(json) {
  if (!json || typeof json !== 'object') return json;
  if (json.data != null && (json.success === true || json.success === undefined)) {
    return json.data;
  }
  return json;
}

async function apiLogin(base, email, password) {
  const res = await request(base, 'POST', '/api/auth/login', {
    body: { email, contrasena: password },
    json: true,
  });
  const data = unwrapData(res.json) || {};
  const token = data.accessToken || data.token || res.json?.accessToken || res.json?.token;
  if (res.status !== 200 || !token) {
    const msg = res.json?.error || res.json?.message || res.body?.slice(0, 200);
    throw new Error(`API login falló (${res.status}): ${msg}`);
  }
  return {
    token,
    user: data.user || data.usuario || null,
    company: data.user?.company || data.company || data.configuracion?.empresa || null,
    raw: data,
  };
}

async function webLogin(base, email, password) {
  const body = new URLSearchParams({ email, contrasena: password }).toString();
  const res = await request(base, 'POST', '/login', {
    body,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  if (!(res.status >= 300 && res.status < 400) && res.status !== 200) {
    throw new Error(`Web login status ${res.status}`);
  }
  if (!res.jar || !Object.keys(res.jar).length) {
    throw new Error('Web login sin cookie de sesión');
  }
  return res.jar;
}

function bearer(token) {
  return { Authorization: `Bearer ${token}` };
}

module.exports = {
  request,
  apiLogin,
  webLogin,
  bearer,
  cookieHeader,
  unwrapData,
};

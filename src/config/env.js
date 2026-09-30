require('dotenv').config({ override: true });

function buildDatabaseUrl(dbName) {
  const {
    DB_HOST = 'localhost',
    DB_PORT = '3306',
    DB_NAME,
    DB_USER,
    DB_PASSWORD = '',
  } = process.env;

  const name = dbName || DB_NAME;
  if (!name || !DB_USER) {
    throw new Error(
      'Faltan credenciales MySQL. En .env define DB_NAME, DB_USER y DB_PASSWORD (o DATABASE_URL).',
    );
  }

  const user = encodeURIComponent(DB_USER);
  const password = encodeURIComponent(DB_PASSWORD);
  return `mysql://${user}:${password}@${DB_HOST}:${DB_PORT}/${name}`;
}

function withPoolParams(url) {
  const defaults = {
    connection_limit: process.env.DB_CONNECTION_LIMIT || '15',
    pool_timeout: process.env.DB_POOL_TIMEOUT || '20',
    connect_timeout: process.env.DB_CONNECT_TIMEOUT || '10',
  };
  const raw = String(url || '');
  const qIndex = raw.indexOf('?');
  const base = qIndex >= 0 ? raw.slice(0, qIndex) : raw;
  const params = new URLSearchParams(qIndex >= 0 ? raw.slice(qIndex + 1) : '');
  for (const [key, value] of Object.entries(defaults)) {
    if (!params.has(key)) params.set(key, value);
  }
  return `${base}?${params.toString()}`;
}

/** Producción: DB_NAME (db_easy). Beta/test: DB_NAME_TEST (db_easy_test). */
function buildProdDatabaseUrl() {
  if (process.env.DATABASE_URL_PROD) {
    return withPoolParams(process.env.DATABASE_URL_PROD);
  }
  return withPoolParams(buildDatabaseUrl(process.env.DB_NAME));
}

function buildTestDatabaseUrl() {
  if (process.env.DATABASE_URL_TEST) {
    return withPoolParams(process.env.DATABASE_URL_TEST);
  }
  const testName = process.env.DB_NAME_TEST || 'db_easy_test';
  return withPoolParams(buildDatabaseUrl(testName));
}

// Prisma default datasource (migración / generate) → prod
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = buildProdDatabaseUrl();
} else {
  process.env.DATABASE_URL = withPoolParams(process.env.DATABASE_URL);
}

module.exports = {
  buildDatabaseUrl,
  withPoolParams,
  buildProdDatabaseUrl,
  buildTestDatabaseUrl,
};

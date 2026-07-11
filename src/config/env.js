require('dotenv').config({ override: true });

function buildDatabaseUrl() {
  const {
    DB_HOST = 'localhost',
    DB_PORT = '3306',
    DB_NAME,
    DB_USER,
    DB_PASSWORD = '',
  } = process.env;

  if (!DB_NAME || !DB_USER) {
    throw new Error(
      'Faltan credenciales MySQL. En .env define DB_NAME, DB_USER y DB_PASSWORD (o DATABASE_URL).'
    );
  }

  const user = encodeURIComponent(DB_USER);
  const password = encodeURIComponent(DB_PASSWORD);
  return `mysql://${user}:${password}@${DB_HOST}:${DB_PORT}/${DB_NAME}`;
}

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = buildDatabaseUrl();
}

module.exports = { buildDatabaseUrl };

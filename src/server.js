require('./config/env');
const storageConfig = require('./config/storage');
const app = require('./app');
const config = require('./config');
const prisma = require('./config/prisma');
const { initDatabase } = require('./models');

storageConfig.assertR2ProductionConfig();
storageConfig.warnR2PublicUrlMissing();

initDatabase()
  .then(() => {
    const server = app.listen(config.port, '0.0.0.0', () => {
      console.log(`Servidor en http://localhost:${config.port}`);
      console.log(`Red local: http://0.0.0.0:${config.port}`);
      console.log(`API REST: http://localhost:${config.port}/api`);
    });
    const httpTimeoutMs = Number(process.env.HTTP_SERVER_TIMEOUT_MS || 30 * 60 * 1000);
    server.timeout = httpTimeoutMs;
    server.requestTimeout = httpTimeoutMs;
    server.headersTimeout = httpTimeoutMs + 5000;

    let shuttingDown = false;
    const shutdown = async () => {
      if (shuttingDown) return;
      shuttingDown = true;
      server.close();
      try {
        await (prisma.disconnectPrisma ? prisma.disconnectPrisma() : prisma.$disconnect());
      } catch (_) {
        // ignore
      }
      process.exit(0);
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  })
  .catch((err) => {
    console.error('Error al conectar la base de datos:', err);
    process.exit(1);
  });

const http = require('http');
const https = require('https');
const fs = require('fs');

const config = require('./config');
const logger = require('./config/logger');
const { connectDB } = require('./config/db');
const { createApp } = require('./app');
const { initSockets } = require('./sockets');

async function main() {
  await connectDB(config.mongoUri);

  const app = createApp();
  const server =
    config.https.enabled && fs.existsSync(config.https.keyPath)
      ? https.createServer(
          {
            key: fs.readFileSync(config.https.keyPath),
            cert: fs.readFileSync(config.https.certPath),
          },
          app
        )
      : http.createServer(app);

  const { io, presence } = initSockets(server);
  app.set('io', io);
  app.set('presence', presence);

  server.listen(config.port, () => {
    logger.info(`API listening on ${config.https.enabled ? 'https' : 'http'}://localhost:${config.port} [${config.env}]`);
  });

  const shutdown = async () => {
    logger.info('Shutting down gracefully');
    io.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10000).unref();
    await require('mongoose').disconnect().catch(() => {});
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  process.on('unhandledRejection', (err) => logger.error({ err }, 'Unhandled rejection'));
}

main().catch((err) => {
  logger.error({ err }, 'Fatal startup error');
  process.exit(1);
});

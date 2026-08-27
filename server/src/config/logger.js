const pino = require('pino');
const config = require('./index');

const logger = pino({
  level: process.env.LOG_LEVEL || (config.isProd ? 'info' : 'debug'),
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      '*.password',
      '*.passwordHash',
      '*.token',
      '*.refreshToken',
      '*.accessToken',
    ],
    censor: '[REDACTED]',
  },
});

module.exports = logger;

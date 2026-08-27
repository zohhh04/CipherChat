const ApiError = require('../utils/ApiError');
const logger = require('../config/logger');
const config = require('../config');

function validate(schemas) {
  return (req, _res, next) => {
    try {
      for (const part of ['params', 'query', 'body']) {
        const schema = schemas[part];
        if (!schema) continue;
        const parsed = schema.safeParse(req[part]);
        if (!parsed.success) {
          const details = parsed.error.issues.map((i) => ({
            path: [part, ...i.path].join('.'),
            message: i.message,
          }));
          throw new ApiError(422, 'Validation failed', 'validation_error', details);
        }
        Object.defineProperty(req, part, { value: parsed.data, writable: true, configurable: true });
      }
      next();
    } catch (e) {
      next(e);
    }
  };
}

function notFoundHandler(req, res) {
  res.status(404).json({ ok: false, code: 'not_found', message: 'Route not found' });
}

function errorHandler(err, req, res, _next) {
  let statusCode = err.statusCode || 500;
  let code = err.code || 'internal_error';
  let message = err.message || 'Internal server error';
  let details = err.details;

  if (err.name === 'CastError') {
    statusCode = 400;
    code = 'invalid_id';
    message = 'Invalid identifier';
  } else if (err.name === 'ValidationError' && err.errors) {
    statusCode = 422;
    code = 'validation_error';
  } else if (statusCode === 500) {
    logger.error({ err, url: req.originalUrl }, 'Unhandled error');
    message = config.isProd ? 'Internal server error' : message;
  }

  res.status(statusCode).json({
    ok: false,
    code,
    message,
    ...(details ? { details } : {}),
    ...(config.isProd ? {} : { stack: undefined }),
  });
}

module.exports = { validate, notFoundHandler, errorHandler };

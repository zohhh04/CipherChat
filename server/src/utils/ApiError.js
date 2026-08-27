class ApiError extends Error {
  constructor(statusCode, message, code = 'error', details = undefined) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(msg = 'Bad request', code = 'bad_request', details) {
    return new ApiError(400, msg, code, details);
  }
  static unauthorized(msg = 'Unauthorized', code = 'unauthorized') {
    return new ApiError(401, msg, code);
  }
  static forbidden(msg = 'Forbidden', code = 'forbidden') {
    return new ApiError(403, msg, code);
  }
  static notFound(msg = 'Not found', code = 'not_found') {
    return new ApiError(404, msg, code);
  }
  static conflict(msg = 'Conflict', code = 'conflict') {
    return new ApiError(409, msg, code);
  }
  static tooMany(msg = 'Too many requests', code = 'rate_limited') {
    return new ApiError(429, msg, code);
  }
}

module.exports = ApiError;

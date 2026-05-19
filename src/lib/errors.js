class ApiError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

class ValidationError extends ApiError {
  constructor(msg) {
    super(400, msg);
  }
}

class AuthError extends ApiError {
  constructor(msg = 'Unauthorized') {
    super(401, msg);
  }
}

class NotFoundError extends ApiError {
  constructor(msg = 'Not found') {
    super(404, msg);
  }
}

module.exports = { ApiError, ValidationError, AuthError, NotFoundError };

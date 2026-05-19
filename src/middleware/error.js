const { ApiError } = require('../lib/errors');
const logger = require('../lib/logger');

function errorHandler(err, req, res, next) {
  // Log the error
  logger.error(`Error: ${err.message}`, {
    path: req.path,
    method: req.method,
    statusCode: err.statusCode,
    stack: process.env.NODE_ENV !== 'production' ? err.stack : undefined,
  });

  // Handle known operational errors
  if (err.isOperational && err instanceof ApiError) {
    return res.status(err.statusCode).json({
      error: err.message,
      statusCode: err.statusCode,
    });
  }

  // Handle JWT errors (if not caught by auth middleware)
  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({ error: 'Token expired' });
  }
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({ error: 'Invalid token' });
  }

  // Unexpected errors - don't leak details in production
  const message = process.env.NODE_ENV === 'production'
    ? 'Internal server error'
    : err.message || 'Internal server error';

  res.status(500).json({ error: message });
}

module.exports = { errorHandler };

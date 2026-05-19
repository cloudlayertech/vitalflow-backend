const jwt = require('jsonwebtoken');
const { AuthError } = require('../lib/errors');
const logger = require('../lib/logger');

const JWT_SECRET = process.env.JWT_SECRET;

function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AuthError('Missing or invalid Authorization header');
    }

    const token = authHeader.slice(7);
    const decoded = jwt.verify(token, JWT_SECRET);

    req.user = { userId: decoded.userId, email: decoded.email };
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return next(new AuthError('Token expired'));
    }
    if (err.name === 'JsonWebTokenError') {
      return next(new AuthError('Invalid token'));
    }
    next(err);
  }
}

module.exports = { requireAuth };

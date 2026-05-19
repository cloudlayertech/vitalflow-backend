const jwt = require('jsonwebtoken');
const logger = require('../lib/logger');

const JWT_SECRET = process.env.JWT_SECRET;

function extractToken(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) return authHeader.slice(7);
  if (req.query && req.query.token) return req.query.token;
  if (req.body && req.body.token) return req.body.token;
  return null;
}

function requireAuth(req, res, next) {
  try {
    const token = extractToken(req);
    if (!token) return res.status(401).json({ error: 'Authentication required', statusCode: 401 });
    let decoded;
    try { decoded = jwt.verify(token, JWT_SECRET); }
    catch (jwtErr) {
      if (jwtErr.name === 'TokenExpiredError') return res.status(401).json({ error: 'Token expired', statusCode: 401 });
      return res.status(401).json({ error: 'Invalid token', statusCode: 401 });
    }
    req.user = { userId: decoded.userId, email: decoded.email };
    next();
  } catch (err) {
    logger.error('Auth error:', err.message);
    return res.status(401).json({ error: 'Auth failed', statusCode: 401 });
  }
}

module.exports = { requireAuth, extractToken };

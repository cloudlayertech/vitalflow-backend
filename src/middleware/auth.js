const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;

function requireAuth(req, res, next) {
  try {
    let token = null;

    // Check Authorization header
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    }

    // Fallback: check query parameter
    if (!token && req.query && req.query.token) {
      token = req.query.token;
    }

    if (!token) {
      return res.status(401).json({ error: 'Missing or invalid Authorization header', statusCode: 401 });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = { userId: decoded.userId, email: decoded.email };
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired', statusCode: 401 });
    }
    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token', statusCode: 401 });
    }
    return res.status(401).json({ error: 'Unauthorized', statusCode: 401 });
  }
}

module.exports = { requireAuth };

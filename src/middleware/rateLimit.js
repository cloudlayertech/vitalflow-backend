// Simple in-memory rate limiter - 100 requests per 15 minutes per IP
const logger = require('../lib/logger');

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_REQUESTS = 100;

const ipStore = new Map();

function rateLimiter(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const now = Date.now();

  const data = ipStore.get(ip);

  if (!data) {
    // First request from this IP
    ipStore.set(ip, { count: 1, resetTime: now + WINDOW_MS });
    res.setHeader('X-RateLimit-Limit', MAX_REQUESTS);
    res.setHeader('X-RateLimit-Remaining', MAX_REQUESTS - 1);
    res.setHeader('X-RateLimit-Reset', Math.ceil((now + WINDOW_MS) / 1000));
    return next();
  }

  // Check if window has reset
  if (now > data.resetTime) {
    data.count = 1;
    data.resetTime = now + WINDOW_MS;
    ipStore.set(ip, data);
    res.setHeader('X-RateLimit-Limit', MAX_REQUESTS);
    res.setHeader('X-RateLimit-Remaining', MAX_REQUESTS - 1);
    res.setHeader('X-RateLimit-Reset', Math.ceil(data.resetTime / 1000));
    return next();
  }

  // Check if limit exceeded
  if (data.count >= MAX_REQUESTS) {
    const retryAfter = Math.ceil((data.resetTime - now) / 1000);
    logger.warn(`Rate limit exceeded for IP: ${ip}`);
    res.setHeader('Retry-After', retryAfter);
    return res.status(429).json({
      error: 'Too many requests. Please try again later.',
      retryAfter,
    });
  }

  // Increment count
  data.count += 1;
  ipStore.set(ip, data);
  res.setHeader('X-RateLimit-Limit', MAX_REQUESTS);
  res.setHeader('X-RateLimit-Remaining', Math.max(0, MAX_REQUESTS - data.count));
  res.setHeader('X-RateLimit-Reset', Math.ceil(data.resetTime / 1000));
  next();
}

module.exports = { rateLimiter };

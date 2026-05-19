const logger = require('../lib/logger');

// Simple in-memory Map mock for Render free tier (no Redis dependency)
class InMemoryRedisMock {
  constructor() {
    this.store = new Map();
    this.timers = new Map();
  }

  async get(key) {
    const item = this.store.get(key);
    if (!item) return null;
    if (item.expiry && Date.now() > item.expiry) {
      this.store.delete(key);
      return null;
    }
    return item.value;
  }

  async set(key, value, ttlSeconds) {
    const expiry = ttlSeconds ? Date.now() + ttlSeconds * 1000 : null;
    this.store.set(key, { value, expiry });
  }

  async del(key) {
    this.store.delete(key);
    this.timers.delete(key);
  }

  async exists(key) {
    const val = await this.get(key);
    return val !== null;
  }

  async flushall() {
    this.store.clear();
    this.timers.clear();
  }

  // In-memory rate limiter helpers
  getRateLimitData(key) {
    const data = this.store.get(`ratelimit:${key}`);
    return data ? data.value : null;
  }

  setRateLimitData(key, value, ttlSeconds) {
    const expiry = Date.now() + ttlSeconds * 1000;
    this.store.set(`ratelimit:${key}`, { value, expiry });
  }
}

let redis;

// If REDIS_URL is provided, we could use a real Redis client.
// For the free tier and zero-dependency approach, always use the in-memory mock.
// If you want real Redis later, install `ioredis` and replace this block.
if (process.env.REDIS_URL) {
  try {
    // eslint-disable-next-line global-require
    const Redis = require('ioredis');
    redis = new Redis(process.env.REDIS_URL);
    logger.info('Using real Redis');
  } catch {
    logger.warn('REDIS_URL set but ioredis not installed, using in-memory mock');
    redis = new InMemoryRedisMock();
  }
} else {
  logger.info('REDIS_URL not set, using in-memory Redis mock');
  redis = new InMemoryRedisMock();
}

module.exports = redis;

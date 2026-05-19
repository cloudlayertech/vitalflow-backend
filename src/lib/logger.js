const logger = {
  info: (msg, obj) => console.log(`[INFO] ${msg}`, obj || ''),
  error: (msg, obj) => console.error(`[ERROR] ${msg}`, obj || ''),
  warn: (msg, obj) => console.warn(`[WARN] ${msg}`, obj || ''),
  debug: (msg, obj) => process.env.NODE_ENV !== 'production' && console.log(`[DEBUG] ${msg}`, obj || ''),
};

module.exports = logger;

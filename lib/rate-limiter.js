/**
 * InfinityPay API - Rate Limiting Subsystem
 * Implements sliding-window rate limiting keyed on Merchant API Key (or Client IP for public routes).
 * Returns HTTP 429 and standard rate limit headers when thresholds are exceeded.
 */

const { sendError, ErrorCodes } = require('./responses');
const config = require('./config');

// In-memory window store (sliding window timestamps per key)
// In production across multiple serverless regions, this can be swapped with Redis / Upstash
const requestStore = new Map();

// Periodic cleanup of stale entries every 5 minutes
const CLEANUP_INTERVAL = 5 * 60 * 1000;
let cleanupTimer = null;

function ensureCleanupTimer() {
  if (!cleanupTimer && process.env.NODE_ENV !== 'test') {
    cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [key, timestamps] of requestStore.entries()) {
        const filtered = timestamps.filter((t) => now - t < 60 * 60 * 1000);
        if (filtered.length === 0) {
          requestStore.delete(key);
        } else {
          requestStore.set(key, filtered);
        }
      }
    }, CLEANUP_INTERVAL);
    if (cleanupTimer.unref) cleanupTimer.unref();
  }
}

/**
 * Creates a rate limiter middleware
 * @param {object} options
 * @param {number} [options.windowMs=60000] 1 minute default
 * @param {number} [options.max=60] max requests per window
 * @param {string} [options.prefix=''] namespace prefix
 */
function createRateLimiter(options = {}) {
  const windowMs = options.windowMs || config.rateLimit.windowMs;
  const maxRequests = options.max || config.rateLimit.maxPerMinute;
  const prefix = options.prefix || 'rl';

  ensureCleanupTimer();

  return function rateLimiter(req, res, next) {
    // Determine key: prioritize authenticated API key / merchant, fallback to client IP
    const identifier =
      req.merchant?.id ||
      req.apiKey?.keyId ||
      req.headers['x-infinitypay-key'] ||
      req.ip ||
      req.headers['x-forwarded-for'] ||
      req.socket.remoteAddress ||
      'anonymous';

    const storeKey = `${prefix}:${identifier}`;
    const now = Date.now();
    const windowStart = now - windowMs;

    // Get current timestamps for key
    let timestamps = requestStore.get(storeKey) || [];
    // Filter timestamps within current sliding window
    timestamps = timestamps.filter((t) => t > windowStart);

    const currentCount = timestamps.length;
    const remaining = Math.max(0, maxRequests - currentCount - 1);
    const resetTimeSeconds = Math.ceil((windowStart + windowMs - now) / 1000);

    // Standard rate limit headers
    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', Math.ceil((now + windowMs) / 1000));

    if (currentCount >= maxRequests) {
      res.setHeader('Retry-After', resetTimeSeconds);
      return sendError(
        res,
        `Rate limit exceeded. Maximum ${maxRequests} requests per ${windowMs / 1000}s allowed.`,
        ErrorCodes.RATE_LIMITED,
        429,
        { retry_after_seconds: Math.max(1, resetTimeSeconds) }
      );
    }

    timestamps.push(now);
    requestStore.set(storeKey, timestamps);
    next();
  };
}

/**
 * Reset all rate limiter stores (useful for automated tests)
 */
function resetRateLimitStore() {
  requestStore.clear();
}

module.exports = {
  createRateLimiter,
  resetRateLimitStore,
};

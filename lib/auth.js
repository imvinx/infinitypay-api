/**
 * InfinityPay API - Authentication Subsystem
 * Verifies X-InfinityPay-Key and Authorization Bearer tokens against hashed database records.
 * Attaches authenticated merchant and API key metadata to incoming requests.
 */

const { hashApiKey } = require('./crypto');
const { apiKeyService } = require('./db');
const { sendError, ErrorCodes } = require('./responses');

/**
 * Middleware: Enforces InfinityPay merchant API-key authentication
 */
async function authenticateApiKey(req, res, next) {
  try {
    let rawKey = req.headers['x-infinitypay-key'];

    if (!rawKey) {
      const authHeader = req.headers['authorization'];
      if (authHeader && authHeader.startsWith('Bearer ')) {
        rawKey = authHeader.slice(7).trim();
      }
    }

    if (!rawKey) {
      return sendError(
        res,
        'API key required. Provide via X-InfinityPay-Key header or Authorization: Bearer <KEY>.',
        ErrorCodes.MISSING_API_KEY,
        401
      );
    }

    // Compute SHA-256 hash of provided key to query database
    const keyHash = hashApiKey(rawKey);
    const keyRecord = await apiKeyService.findActiveByHash(keyHash);

    if (!keyRecord || !keyRecord.merchant || keyRecord.status !== 'active') {
      return sendError(
        res,
        'Invalid or revoked InfinityPay API key.',
        ErrorCodes.INVALID_API_KEY,
        401
      );
    }

    if (keyRecord.merchant.status !== 'active') {
      return sendError(
        res,
        'Merchant account is suspended.',
        ErrorCodes.UNAUTHORIZED,
        403
      );
    }

    // Attach merchant and key metadata (no secrets attached)
    req.merchant = {
      id: keyRecord.merchant.id,
      name: keyRecord.merchant.name,
      email: keyRecord.merchant.email,
      status: keyRecord.merchant.status,
    };

    req.apiKey = {
      keyId: keyRecord.id,
      name: keyRecord.name,
      keyPrefix: keyRecord.keyPrefix,
      status: keyRecord.status,
    };

    // Update lastUsed timestamp asynchronously without blocking response
    apiKeyService.touchLastUsed(keyRecord.id).catch(() => {});

    next();
  } catch (error) {
    return sendError(res, 'Authentication internal error.', ErrorCodes.INTERNAL_ERROR, 500);
  }
}

/**
 * Middleware: Protects cron / scheduled worker endpoints
 */
function authenticateCron(req, res, next) {
  const config = require('./config');
  const authHeader = req.headers['authorization'];
  const cronSecret = req.query.secret || (authHeader && authHeader.replace('Bearer ', '').trim());

  if (!cronSecret || cronSecret !== config.cronSecret) {
    return sendError(res, 'Unauthorized cron trigger.', ErrorCodes.UNAUTHORIZED, 401);
  }

  next();
}

module.exports = {
  authenticateApiKey,
  authenticateCron,
};

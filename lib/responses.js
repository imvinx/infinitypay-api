/**
 * InfinityPay API - Standardized JSON Response Formatter
 * Enforces unified API payload contract across all endpoints.
 */

const ErrorCodes = {
  INVALID_API_KEY: 'INVALID_API_KEY',
  MISSING_API_KEY: 'MISSING_API_KEY',
  ACCOUNT_NOT_FOUND: 'ACCOUNT_NOT_FOUND',
  ACCOUNT_NOT_VERIFIED: 'ACCOUNT_NOT_VERIFIED',
  ACCOUNT_LIMIT_REACHED: 'ACCOUNT_LIMIT_REACHED',
  ANOTHER_ACCOUNT_ALREADY_ACTIVE: 'ANOTHER_ACCOUNT_ALREADY_ACTIVE',
  INVALID_AMOUNT: 'INVALID_AMOUNT',
  INVALID_MOBILE: 'INVALID_MOBILE',
  ORDER_NOT_FOUND: 'ORDER_NOT_FOUND',
  TRANSACTION_NOT_FOUND: 'TRANSACTION_NOT_FOUND',
  PAYMENT_PENDING: 'PAYMENT_PENDING',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  RATE_LIMITED: 'RATE_LIMITED',
  GMAIL_CONNECTION_FAILED: 'GMAIL_CONNECTION_FAILED',
  GMAIL_SYNC_FAILED: 'GMAIL_SYNC_FAILED',
  DATABASE_ERROR: 'DATABASE_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
};

/**
 * Send a standardized success JSON response
 * @param {import('express').Response} res
 * @param {string} message
 * @param {object} [data={}]
 * @param {number} [statusCode=200]
 */
function sendSuccess(res, message, data = {}, statusCode = 200) {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
  });
}

/**
 * Send a standardized error JSON response
 * @param {import('express').Response} res
 * @param {string} message
 * @param {string} code
 * @param {number} [statusCode=400]
 * @param {object} [details=null]
 */
function sendError(res, message, code = ErrorCodes.INTERNAL_ERROR, statusCode = 400, details = null) {
  const errorPayload = { code };
  if (details && typeof details === 'object') {
    Object.assign(errorPayload, details);
  }

  return res.status(statusCode).json({
    success: false,
    message,
    error: errorPayload,
  });
}

module.exports = {
  ErrorCodes,
  sendSuccess,
  sendError,
};

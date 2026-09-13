/**
 * InfinityPay API - Developer Endpoints
 * Manages API keys, Payment Order Creation, and Order Status Verifications.
 */

const express = require('express');
const router = express.Router();
const config = require('../config');
const { sendSuccess, sendError, ErrorCodes } = require('../responses');
const { generateApiKey, generateOrderId } = require('../crypto');
const { apiKeyService, orderService, accountService, merchantService } = require('../db');
const { validateAmount, validateMobile, validateUrl, sanitizeString } = require('../validation');
const { authenticateApiKey } = require('../auth');
const { verifyOrderPayment } = require('../payment-matcher');

/**
 * Determine dynamic base URL for payment links (request host or config)
 * Never hardcoded to a fixed hostname.
 */
function getDynamicBaseUrl(req) {
  if (config.isProduction && config.apiBaseUrl && !config.apiBaseUrl.includes('localhost')) {
    return config.apiBaseUrl;
  }
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  if (host) {
    return `${protocol}://${host}`;
  }
  return config.apiBaseUrl;
}

// ==============================================================================
// 1. API KEY MANAGEMENT ENDPOINTS
// ==============================================================================

/**
 * POST /api/developer/keys
 * Generates a new InfinityPay API key.
 * If called with an existing API key, attaches to current merchant.
 * If called during initial merchant onboarding (with merchant_email in body), attaches or creates merchant.
 */
router.post('/keys', async (req, res) => {
  try {
    let merchantId = null;

    // Check if authenticated
    const authHeader = req.headers['x-infinitypay-key'] || req.headers['authorization'];
    if (authHeader) {
      await new Promise((resolve) => {
        authenticateApiKey(req, res, () => {
          merchantId = req.merchant.id;
          resolve();
        });
      });
      if (res.headersSent) return;
    }

    // If no existing key provided, allow onboarding via merchant_email
    if (!merchantId) {
      const email = req.body.merchant_email || req.body.email;
      const name = req.body.merchant_name || req.body.name || 'Merchant';

      if (!email) {
        return sendError(
          res,
          'merchant_email is required when generating an initial API key.',
          ErrorCodes.VALIDATION_ERROR,
          400
        );
      }

      let merchant = await merchantService.findByEmail(email);
      if (!merchant) {
        merchant = await merchantService.create({ name: sanitizeString(name), email });
      }
      merchantId = merchant.id;
    }

    const keyName = sanitizeString(req.body.name || 'Default Key', 50);
    const { apiKey, keyPrefix, keyHash, keyId } = generateApiKey();

    const createdKey = await apiKeyService.create({
      merchantId,
      name: keyName,
      keyHash,
      keyPrefix,
      keyId,
    });

    // CRITICAL: Return plaintext api_key ONLY once upon creation!
    return sendSuccess(
      res,
      'API key created successfully. Store it safely; it will not be shown again.',
      {
        key_id: createdKey.id,
        api_key: apiKey,
        created_at: createdKey.createdAt,
      },
      201
    );
  } catch (error) {
    return sendError(res, error.message || 'Failed to create API key.', ErrorCodes.INTERNAL_ERROR, 500);
  }
});

/**
 * GET /api/developer/keys
 * Lists existing API keys for authenticated merchant.
 * Returns metadata ONLY - NEVER returns plaintext API keys or hashes.
 */
router.get('/keys', authenticateApiKey, async (req, res) => {
  try {
    const keys = await apiKeyService.listByMerchant(req.merchant.id);
    return sendSuccess(res, 'API keys retrieved', { keys });
  } catch (error) {
    return sendError(res, 'Failed to fetch API keys.', ErrorCodes.INTERNAL_ERROR, 500);
  }
});

/**
 * DELETE /api/developer/keys/:keyId
 * Revokes the selected API key.
 */
router.delete('/keys/:keyId', authenticateApiKey, async (req, res) => {
  try {
    const { keyId } = req.params;
    const revoked = await apiKeyService.revoke(keyId, req.merchant.id);

    if (!revoked) {
      return sendError(res, 'API key not found or already revoked.', ErrorCodes.INVALID_API_KEY, 404);
    }

    return sendSuccess(res, 'API key revoked successfully', { key_id: keyId, status: 'revoked' });
  } catch (error) {
    return sendError(res, 'Failed to revoke API key.', ErrorCodes.INTERNAL_ERROR, 500);
  }
});

// ==============================================================================
// 2. PAYMENT ORDER ENDPOINTS
// ==============================================================================

/**
 * POST /api/developer/create-order
 * Authenticated using Merchant API Key.
 *
 * Request Body:
 * {
 *   "amount": 499,
 *   "title": "Order #123",
 *   "customer_mobile": "9999999999",
 *   "redirect_url": "https://merchant.example.com/payment-return"
 * }
 */
router.post('/create-order', authenticateApiKey, async (req, res) => {
  try {
    const { amount, title, customer_mobile, redirect_url } = req.body;

    // 1. Strict Amount Validation
    const amountValidation = validateAmount(amount);
    if (!amountValidation.valid) {
      return sendError(res, amountValidation.error, ErrorCodes.INVALID_AMOUNT, 400);
    }

    // 2. Customer Mobile Validation
    const mobileValidation = validateMobile(customer_mobile);
    if (!mobileValidation.valid) {
      return sendError(res, mobileValidation.error, ErrorCodes.INVALID_MOBILE, 400);
    }

    // 3. Redirect URL Validation
    const urlValidation = validateUrl(redirect_url);
    if (!urlValidation.valid) {
      return sendError(res, urlValidation.error, ErrorCodes.VALIDATION_ERROR, 400);
    }

    // 4. Retrieve Merchant's Active Verified Payment Account
    const activeAccount = await accountService.getActiveAccountForMerchant(req.merchant.id);
    if (!activeAccount) {
      return sendError(
        res,
        'Merchant has no active verified payment account configured. Please connect and activate a verified payment account before creating orders.',
        ErrorCodes.ACCOUNT_NOT_FOUND,
        400
      );
    }

    // 5. Generate internal Order ID & Expiration
    const orderId = generateOrderId();
    const expiresAt = new Date(Date.now() + config.orders.expiryMinutes * 60 * 1000);

    const order = await orderService.create({
      orderId,
      merchantId: req.merchant.id,
      accountId: activeAccount.id,
      amount: amountValidation.amount,
      currency: 'INR',
      title: sanitizeString(title, 100) || null,
      customerMobile: mobileValidation.mobile,
      redirectUrl: urlValidation.url,
      expiresAt,
    });

    // 6. Generate dynamic Payment URL
    const baseUrl = getDynamicBaseUrl(req);
    const paymentUrl = `${baseUrl}/api/checkout/${order.orderId}`;

    return sendSuccess(
      res,
      'Order created',
      {
        order_id: order.orderId,
        payment_url: paymentUrl,
        amount: order.amount,
        status: order.status,
        expires_at: order.expiresAt,
      },
      201
    );
  } catch (error) {
    return sendError(res, error.message || 'Failed to create payment order.', ErrorCodes.INTERNAL_ERROR, 500);
  }
});

/**
 * GET /api/developer/order-status/:orderId
 * Fetches order payment status.
 * Enforces merchant isolation.
 */
router.get('/order-status/:orderId', authenticateApiKey, async (req, res) => {
  try {
    const { orderId } = req.params;

    // Merchant isolation: Merchant can ONLY access their own orders
    const order = await orderService.findByOrderIdAndMerchant(orderId, req.merchant.id);
    if (!order) {
      return sendError(res, 'Order not found.', ErrorCodes.ORDER_NOT_FOUND, 404);
    }

    // Run verification engine to determine live status
    const verifiedStatus = await verifyOrderPayment(order.orderId);

    return sendSuccess(res, 'Status fetched', {
      order_id: verifiedStatus.order_id,
      status: verifiedStatus.status,
      amount: verifiedStatus.amount,
      matched_transaction_id: verifiedStatus.transaction_id || undefined,
    });
  } catch (error) {
    return sendError(res, error.message || 'Failed to fetch order status.', ErrorCodes.INTERNAL_ERROR, 500);
  }
});

module.exports = router;

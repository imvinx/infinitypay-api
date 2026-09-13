/**
 * InfinityPay API - Public Checkout Endpoint
 * Provides safe order and payment account details for the payment URL returned during order creation.
 *
 * CRITICAL SECURITY PRINCIPLES:
 * - Never expose internal database IDs, merchant private keys, or credentials.
 * - This endpoint is read-only and CANNOT transition an order status to success.
 */

const express = require('express');
const router = express.Router();
const { sendSuccess, sendError, ErrorCodes } = require('../responses');
const { orderService, accountService, merchantService } = require('../db');
const { verifyOrderPayment } = require('../payment-matcher');

/**
 * GET /api/checkout/:orderId
 * Public checkout data endpoint.
 */
router.get('/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;

    const order = await orderService.findByOrderId(orderId);
    if (!order) {
      return sendError(res, 'Order not found or invalid payment link.', ErrorCodes.ORDER_NOT_FOUND, 404);
    }

    // Run verification check in case a background transaction has already matched this order
    const verification = await verifyOrderPayment(order.orderId);

    // Retrieve active account & merchant details for safe checkout display
    const account = await accountService.findById(order.accountId);
    const merchant = await merchantService.findById(order.merchantId);

    return sendSuccess(res, 'Order checkout details', {
      order_id: order.orderId,
      amount: order.amount,
      currency: order.currency || 'INR',
      title: order.title || 'Payment Order',
      status: verification.status,
      expires_at: order.expiresAt,
      merchant_name: merchant ? merchant.name : 'Verified Merchant',
      upi_id: account ? account.upiId : null,
      redirect_url: order.redirectUrl || null,
    });
  } catch (error) {
    return sendError(res, error.message || 'Failed to load checkout details.', ErrorCodes.INTERNAL_ERROR, 500);
  }
});

module.exports = router;

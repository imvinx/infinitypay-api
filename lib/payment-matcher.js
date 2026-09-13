/**
 * InfinityPay API - Transaction Matching & Order Verification Engine
 * Implements safe, idempotent matching of incoming bank/UPI transactions to pending payment orders.
 *
 * CRITICAL SECURITY PRINCIPLE:
 * An order is ONLY transitioned to "success" when verified by this server-side matching engine.
 * Browser redirects, query parameters, client callbacks, or frontend JavaScript can NEVER mark an order as successful.
 */

const { orderService, transactionService, accountService } = require('./db');

/**
 * Matches a synchronized transaction to eligible pending payment orders.
 * Safe matching rules:
 * 1. Transaction must not already be linked to an order.
 * 2. Order must belong to same merchant and payment account.
 * 3. Exact monetary amount match.
 * 4. Order must be in 'pending' status and not expired.
 * 5. Transaction date must be >= order creation date (with a 5-minute clock drift tolerance).
 * 6. Ambiguity protection: If multiple pending orders have identical amount and no distinct UTR/reference match,
 *    orders remain 'pending' to prevent false fulfillments.
 *
 * @param {object} transaction
 * @returns {Promise<{ matched: boolean, orderId?: string, reason?: string }>}
 */
async function matchTransactionToOrder(transaction) {
  if (!transaction || !transaction.id) {
    return { matched: false, reason: 'Invalid transaction record' };
  }

  // Idempotency check: Fetch fresh state to ensure transaction is not already linked to an order
  const currentTx = (await transactionService.getById(transaction.id)) || transaction;
  if (currentTx.matchedOrderId || transaction.matchedOrderId) {
    return {
      matched: false,
      reason: 'Transaction is already matched to order ' + (currentTx.matchedOrderId || transaction.matchedOrderId),
    };
  }

  const { accountId, amount, utr, reference, purpose, transactionDate } = currentTx;

  // Find all unexpired pending orders for this account with the exact amount
  const candidateOrders = await orderService.findPendingByAccountAndAmount(accountId, amount);

  if (!candidateOrders || candidateOrders.length === 0) {
    return { matched: false, reason: 'No matching pending order with amount ' + amount };
  }

  // Filter orders by creation timestamp: Order must be created before or around transaction time
  // Allow 5 minutes of clock skew
  const txTime = new Date(transactionDate).getTime();
  const validCandidates = candidateOrders.filter((order) => {
    const orderCreatedAt = new Date(order.createdAt).getTime();
    return orderCreatedAt <= txTime + 5 * 60 * 1000;
  });

  if (validCandidates.length === 0) {
    return { matched: false, reason: 'Pending orders found, but none match transaction timestamp' };
  }

  let matchedOrder = null;

  // Strategy A: Direct reference / UTR / Order ID match in purpose/remark
  const searchStr = `${reference || ''} ${utr || ''} ${purpose || ''}`.toUpperCase();
  for (const candidate of validCandidates) {
    if (searchStr.includes(candidate.orderId.toUpperCase())) {
      matchedOrder = candidate;
      break;
    }
  }

  // Strategy B: Single unambiguous pending order
  if (!matchedOrder) {
    if (validCandidates.length === 1) {
      matchedOrder = validCandidates[0];
    } else {
      // Ambiguous: multiple orders have the same amount and neither has explicit order ID in remark.
      // SAFE POLICY: Keep orders pending rather than guessing!
      return {
        matched: false,
        reason: 'Ambiguous match: Multiple pending orders with amount ' + amount + '. Kept pending.',
      };
    }
  }

  // Execute idempotent atomic transition
  await orderService.markOrderSuccess(matchedOrder.orderId, transaction.id);
  await transactionService.linkToOrder(transaction.id, matchedOrder.orderId);
  transaction.matchedOrderId = matchedOrder.orderId;
  currentTx.matchedOrderId = matchedOrder.orderId;

  return {
    matched: true,
    orderId: matchedOrder.orderId,
    transactionId: transaction.id,
    amount,
  };
}

/**
 * Internal Payment Verification Service
 * Checks whether an order has been successfully fulfilled or can be matched to available transactions.
 *
 * @param {string} orderId
 * @returns {Promise<{ order_id: string, status: string, amount: number, transaction_id: string|null }>}
 */
async function verifyOrderPayment(orderId) {
  const order = await orderService.findByOrderId(orderId);
  if (!order) {
    throw new Error('Order not found');
  }

  // If already marked success
  if (order.status === 'success') {
    return {
      order_id: order.orderId,
      status: 'success',
      amount: order.amount,
      transaction_id: order.matchedTransactionId,
    };
  }

  // Check if expired
  if (order.status === 'pending' && new Date() > new Date(order.expiresAt)) {
    await orderService.markOrderExpired(order.orderId);
    return {
      order_id: order.orderId,
      status: 'expired',
      amount: order.amount,
      transaction_id: null,
    };
  }

  // If pending, inspect available transactions for this account that haven't been matched
  const recentTransactions = await transactionService.listByAccount(
    order.accountId,
    order.merchantId
  );

  const candidateTx = recentTransactions.find(
    (tx) =>
      !tx.matchedOrderId &&
      Math.abs(tx.amount - order.amount) < 0.001 &&
      new Date(tx.transactionDate).getTime() >= new Date(order.createdAt).getTime() - 5 * 60 * 1000
  );

  if (candidateTx) {
    const matchResult = await matchTransactionToOrder(candidateTx);
    if (matchResult.matched && matchResult.orderId === order.orderId) {
      return {
        order_id: order.orderId,
        status: 'success',
        amount: order.amount,
        transaction_id: candidateTx.id,
      };
    }
  }

  return {
    order_id: order.orderId,
    status: order.status,
    amount: order.amount,
    transaction_id: null,
  };
}

module.exports = {
  matchTransactionToOrder,
  verifyOrderPayment,
};

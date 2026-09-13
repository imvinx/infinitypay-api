const request = require('supertest');
const { app, setupTestMerchant, resetMemoryDatabase } = require('./setup');
const { parseTransactionEmail, syncTransactions } = require('../lib/gmail');
const { matchTransactionToOrder, verifyOrderPayment } = require('../lib/payment-matcher');
const { orderService, transactionService } = require('../lib/db');

describe('Payment Matching & Transaction Verification Engine', () => {
  beforeEach(() => {
    resetMemoryDatabase();
  });

  it('Parses raw UPI credit notification emails accurately', () => {
    const mockEmail = {
      id: 'msg_001',
      subject: 'Credit Alert: Your A/C has been credited',
      body: 'Dear Customer, your account *5678 has been credited by Rs. 499.00 on 13-09-2026. Transfer from rahul@okhdfcbank (UPI Ref no 425612345678).',
      date: new Date(),
    };

    const parsed = parseTransactionEmail(mockEmail);

    expect(parsed.valid).toBe(true);
    expect(parsed.amount).toBe(499);
    expect(parsed.utr).toBe('425612345678');
    expect(parsed.sender).toBe('rahul@okhdfcbank');
  });

  it('Rejects non-credit or debit alert emails', () => {
    const debitEmail = {
      id: 'msg_002',
      subject: 'Debit Alert',
      body: 'You have paid Rs. 499.00 to merchant@upi. A/C debited.',
    };

    const parsed = parseTransactionEmail(debitEmail);
    expect(parsed.valid).toBe(false);
  });

  it('Matches synchronized transaction to pending order and transitions status to success', async () => {
    const { merchant, activeAccount } = await setupTestMerchant({ withActiveAccount: true });

    // 1. Create pending order for Rs 650
    const order = await orderService.create({
      orderId: 'IP20260913ORDER1',
      merchantId: merchant.id,
      accountId: activeAccount.id,
      amount: 650,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });

    expect(order.status).toBe('pending');

    // 2. Incoming transaction for Rs 650
    const { transaction } = await transactionService.create({
      accountId: activeAccount.id,
      merchantId: merchant.id,
      amount: 650,
      sender: 'customer@okhdfcbank',
      utr: '425612345678',
      reference: '425612345678',
      sourceMessageId: 'email_msg_101',
      transactionDate: new Date(),
    });

    // 3. Match transaction
    const matchResult = await matchTransactionToOrder(transaction);

    expect(matchResult.matched).toBe(true);
    expect(matchResult.orderId).toBe(order.orderId);

    // 4. Verify order is now marked success
    const updatedOrder = await orderService.findByOrderId(order.orderId);
    expect(updatedOrder.status).toBe('success');
    expect(updatedOrder.matchedTransactionId).toBe(transaction.id);

    // 5. Verify verifyOrderPayment returns success
    const verifyResult = await verifyOrderPayment(order.orderId);
    expect(verifyResult.status).toBe('success');
    expect(verifyResult.transaction_id).toBe(transaction.id);
  });

  it('Guarantees idempotency and prevents a single transaction from fulfilling multiple orders', async () => {
    const { merchant, activeAccount } = await setupTestMerchant({ withActiveAccount: true });

    // Order 1
    const order1 = await orderService.create({
      orderId: 'IP20260913ORDER1',
      merchantId: merchant.id,
      accountId: activeAccount.id,
      amount: 300,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });

    // Order 2 with identical amount
    const order2 = await orderService.create({
      orderId: 'IP20260913ORDER2',
      merchantId: merchant.id,
      accountId: activeAccount.id,
      amount: 300,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });

    // Single transaction for Rs 300 mentioning Order 1
    const { transaction } = await transactionService.create({
      accountId: activeAccount.id,
      merchantId: merchant.id,
      amount: 300,
      purpose: 'Payment for IP20260913ORDER1',
      sourceMessageId: 'email_msg_single',
      transactionDate: new Date(),
    });

    // First match fulfills Order 1
    const match1 = await matchTransactionToOrder(transaction);
    expect(match1.matched).toBe(true);
    expect(match1.orderId).toBe(order1.orderId);

    // Attempt to match the SAME transaction again to Order 2
    const match2 = await matchTransactionToOrder(transaction);
    expect(match2.matched).toBe(false);

    // Verify Order 2 remains pending
    const checkOrder2 = await orderService.findByOrderId(order2.orderId);
    expect(checkOrder2.status).toBe('pending');
  });

  it('Protects against duplicate transaction ingestion with identical sourceMessageId', async () => {
    const { merchant, activeAccount } = await setupTestMerchant({ withActiveAccount: true });

    const txData = {
      accountId: activeAccount.id,
      merchantId: merchant.id,
      amount: 500,
      sourceMessageId: 'unique_source_msg_999',
      transactionDate: new Date(),
    };

    const first = await transactionService.create(txData);
    expect(first.duplicate).toBe(false);

    const second = await transactionService.create(txData);
    expect(second.duplicate).toBe(true);
  });

  it('Safe Policy: Leaves orders pending if match is ambiguous without distinct remark', async () => {
    const { merchant, activeAccount } = await setupTestMerchant({ withActiveAccount: true });

    // Two identical amount orders created at the same time without distinguishing remarks
    await orderService.create({
      orderId: 'IP_AMBIG_1',
      merchantId: merchant.id,
      accountId: activeAccount.id,
      amount: 999,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });

    await orderService.create({
      orderId: 'IP_AMBIG_2',
      merchantId: merchant.id,
      accountId: activeAccount.id,
      amount: 999,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });

    // Incoming transaction without reference to either order
    const { transaction } = await transactionService.create({
      accountId: activeAccount.id,
      merchantId: merchant.id,
      amount: 999,
      sourceMessageId: 'msg_ambiguous',
      transactionDate: new Date(),
    });

    // Matching must reject to prevent guessing
    const matchResult = await matchTransactionToOrder(transaction);
    expect(matchResult.matched).toBe(false);
    expect(matchResult.reason).toContain('Ambiguous match');
  });

  it('POST /api/accounts/:accountId/sync ingests mock emails and automatically matches orders', async () => {
    const { apiKey, activeAccount } = await setupTestMerchant({ withActiveAccount: true });

    // Create order via API
    const orderRes = await request(app)
      .post('/api/developer/create-order')
      .set('X-InfinityPay-Key', apiKey)
      .send({ amount: 1499 });

    const orderId = orderRes.body.data.order_id;

    // Trigger sync with mock email containing order payment
    const syncRes = await request(app)
      .post(`/api/accounts/${activeAccount.id}/sync`)
      .set('X-InfinityPay-Key', apiKey)
      .send({
        mock_emails: [
          {
            id: 'mock_email_777',
            subject: 'Payment Credit Alert',
            body: `Credited Rs. 1499.00 on 13-09-2026 for ${orderId} (UPI Ref no 998877665544)`,
            date: new Date(),
          },
        ],
      });

    expect(syncRes.statusCode).toBe(200);
    expect(syncRes.body.data.synced_transactions).toBe(1);
    expect(syncRes.body.data.matched_orders).toBe(1);

    // Verify order status is now success
    const statusRes = await request(app)
      .get(`/api/developer/order-status/${orderId}`)
      .set('X-InfinityPay-Key', apiKey);

    expect(statusRes.body.data.status).toBe('success');
  });
});

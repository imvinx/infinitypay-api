const request = require('supertest');
const { app, setupTestMerchant, resetMemoryDatabase } = require('./setup');
const { ErrorCodes } = require('../lib/responses');

describe('Payment Orders API', () => {
  beforeEach(() => {
    resetMemoryDatabase();
  });

  it('Fails to create order if merchant has no active verified payment account', async () => {
    // Merchant without active account
    const { apiKey } = await setupTestMerchant({ withActiveAccount: false });

    const res = await request(app)
      .post('/api/developer/create-order')
      .set('X-InfinityPay-Key', apiKey)
      .send({
        amount: 499,
        title: 'Order #101',
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe(ErrorCodes.ACCOUNT_NOT_FOUND);
  });

  it('Successfully creates order when active verified account exists', async () => {
    const { apiKey } = await setupTestMerchant({ withActiveAccount: true });

    const res = await request(app)
      .post('/api/developer/create-order')
      .set('X-InfinityPay-Key', apiKey)
      .send({
        amount: 499,
        title: 'Order #102',
        customer_mobile: '9876543210',
        redirect_url: 'https://myshop.example.com/callback',
      });

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.order_id.startsWith('IP')).toBe(true);
    expect(res.body.data.amount).toBe(499);
    expect(res.body.data.status).toBe('pending');
    expect(res.body.data.payment_url).toContain(`/api/checkout/${res.body.data.order_id}`);
  });

  it('Rejects formatted currency strings (e.g. "₹499", "$50")', async () => {
    const { apiKey } = await setupTestMerchant({ withActiveAccount: true });

    const res1 = await request(app)
      .post('/api/developer/create-order')
      .set('X-InfinityPay-Key', apiKey)
      .send({ amount: '₹499' });

    expect(res1.statusCode).toBe(400);
    expect(res1.body.error.code).toBe(ErrorCodes.INVALID_AMOUNT);

    const res2 = await request(app)
      .post('/api/developer/create-order')
      .set('X-InfinityPay-Key', apiKey)
      .send({ amount: '$100.00' });

    expect(res2.statusCode).toBe(400);
    expect(res2.body.error.code).toBe(ErrorCodes.INVALID_AMOUNT);
  });

  it('Rejects invalid, zero, or negative amounts', async () => {
    const { apiKey } = await setupTestMerchant({ withActiveAccount: true });

    const zeroRes = await request(app)
      .post('/api/developer/create-order')
      .set('X-InfinityPay-Key', apiKey)
      .send({ amount: 0 });

    expect(zeroRes.statusCode).toBe(400);
    expect(zeroRes.body.error.code).toBe(ErrorCodes.INVALID_AMOUNT);

    const negRes = await request(app)
      .post('/api/developer/create-order')
      .set('X-InfinityPay-Key', apiKey)
      .send({ amount: -150 });

    expect(negRes.statusCode).toBe(400);
    expect(negRes.body.error.code).toBe(ErrorCodes.INVALID_AMOUNT);
  });

  it('Rejects invalid customer mobile numbers', async () => {
    const { apiKey } = await setupTestMerchant({ withActiveAccount: true });

    const res = await request(app)
      .post('/api/developer/create-order')
      .set('X-InfinityPay-Key', apiKey)
      .send({
        amount: 500,
        customer_mobile: '123', // invalid short number
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe(ErrorCodes.INVALID_MOBILE);
  });

  it('GET /api/developer/order-status/:orderId fetches status and enforces merchant isolation', async () => {
    const merchantA = await setupTestMerchant({ email: 'sellerA@test.com', withActiveAccount: true });
    const merchantB = await setupTestMerchant({ email: 'sellerB@test.com', withActiveAccount: true });

    // Merchant A creates order
    const createRes = await request(app)
      .post('/api/developer/create-order')
      .set('X-InfinityPay-Key', merchantA.apiKey)
      .send({ amount: 799 });

    const orderId = createRes.body.data.order_id;

    // Merchant A queries own order -> 200
    const aRes = await request(app)
      .get(`/api/developer/order-status/${orderId}`)
      .set('X-InfinityPay-Key', merchantA.apiKey);

    expect(aRes.statusCode).toBe(200);
    expect(aRes.body.data.order_id).toBe(orderId);
    expect(aRes.body.data.status).toBe('pending');
    expect(aRes.body.data.amount).toBe(799);

    // Merchant B queries Merchant A's order -> 404 ORDER_NOT_FOUND
    const bRes = await request(app)
      .get(`/api/developer/order-status/${orderId}`)
      .set('X-InfinityPay-Key', merchantB.apiKey);

    expect(bRes.statusCode).toBe(404);
    expect(bRes.body.error.code).toBe(ErrorCodes.ORDER_NOT_FOUND);
  });

  it('GET /api/checkout/:orderId returns safe public checkout details', async () => {
    const { apiKey } = await setupTestMerchant({ withActiveAccount: true });

    const createRes = await request(app)
      .post('/api/developer/create-order')
      .set('X-InfinityPay-Key', apiKey)
      .send({
        amount: 1250,
        title: 'Premium Subscription',
      });

    const orderId = createRes.body.data.order_id;

    // Public request (no API key required)
    const checkoutRes = await request(app).get(`/api/checkout/${orderId}`);

    expect(checkoutRes.statusCode).toBe(200);
    expect(checkoutRes.body.success).toBe(true);
    expect(checkoutRes.body.data.order_id).toBe(orderId);
    expect(checkoutRes.body.data.amount).toBe(1250);
    expect(checkoutRes.body.data.title).toBe('Premium Subscription');
    expect(checkoutRes.body.data).toHaveProperty('upi_id');
    expect(checkoutRes.body.data).not.toHaveProperty('apiKey');
    expect(checkoutRes.body.data).not.toHaveProperty('databaseUrl');
  });
});

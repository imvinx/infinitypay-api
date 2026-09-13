const request = require('supertest');
const { app, setupTestMerchant, resetMemoryDatabase } = require('./setup');
const { ErrorCodes } = require('../lib/responses');

describe('Connected Payment Accounts API', () => {
  beforeEach(() => {
    resetMemoryDatabase();
  });

  it('POST /api/accounts creates account with pending verification and inactive status', async () => {
    const { apiKey } = await setupTestMerchant();

    const res = await request(app)
      .post('/api/accounts')
      .set('X-InfinityPay-Key', apiKey)
      .send({
        phone_number: '9876543210',
        upi_id: 'merchant@okhdfcbank',
        email: 'billing@merchant.com',
      });

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.verification_status).toBe('pending');
    expect(res.body.data.status).toBe('inactive');
    expect(res.body.data.upi_id).toBe('merchant@okhdfcbank');
  });

  it('Enforces maximum limit of 3 connected accounts per merchant', async () => {
    const { apiKey } = await setupTestMerchant();

    // Create 3 accounts
    for (let i = 1; i <= 3; i++) {
      const res = await request(app)
        .post('/api/accounts')
        .set('X-InfinityPay-Key', apiKey)
        .send({
          phone_number: `987654321${i}`,
          upi_id: `merchant${i}@okhdfcbank`,
          email: `billing${i}@merchant.com`,
        });
      expect(res.statusCode).toBe(201);
    }

    // 4th account attempt must fail with ACCOUNT_LIMIT_REACHED
    const fourthRes = await request(app)
      .post('/api/accounts')
      .set('X-InfinityPay-Key', apiKey)
      .send({
        phone_number: '9876543219',
        upi_id: 'overflow@okhdfcbank',
        email: 'overflow@merchant.com',
      });

    expect(fourthRes.statusCode).toBe(400);
    expect(fourthRes.body.success).toBe(false);
    expect(fourthRes.body.error.code).toBe(ErrorCodes.ACCOUNT_LIMIT_REACHED);
  });

  it('Rejects account activation if account is not yet verified', async () => {
    const { apiKey } = await setupTestMerchant();

    // Create unverified account
    const createRes = await request(app)
      .post('/api/accounts')
      .set('X-InfinityPay-Key', apiKey)
      .send({
        phone_number: '9876543210',
        upi_id: 'test@okhdfcbank',
        email: 'test@merchant.com',
      });

    const accountId = createRes.body.data.account_id;

    // Try activating unverified account
    const actRes = await request(app)
      .post(`/api/accounts/${accountId}/activate`)
      .set('X-InfinityPay-Key', apiKey);

    expect(actRes.statusCode).toBe(400);
    expect(actRes.body.error.code).toBe(ErrorCodes.ACCOUNT_NOT_VERIFIED);
  });

  it('Enforces activation exclusivity: activating one account automatically deactivates previous active account', async () => {
    const { apiKey } = await setupTestMerchant();

    // Create Account 1 & verify
    const acc1Res = await request(app)
      .post('/api/accounts')
      .set('X-InfinityPay-Key', apiKey)
      .send({
        phone_number: '9876543211',
        upi_id: 'account1@okhdfcbank',
        email: 'acc1@merchant.com',
      });
    const acc1Id = acc1Res.body.data.account_id;
    await request(app).post(`/api/accounts/${acc1Id}/verify`).set('X-InfinityPay-Key', apiKey);

    // Create Account 2 & verify
    const acc2Res = await request(app)
      .post('/api/accounts')
      .set('X-InfinityPay-Key', apiKey)
      .send({
        phone_number: '9876543212',
        upi_id: 'account2@okhdfcbank',
        email: 'acc2@merchant.com',
      });
    const acc2Id = acc2Res.body.data.account_id;
    await request(app).post(`/api/accounts/${acc2Id}/verify`).set('X-InfinityPay-Key', apiKey);

    // 1. Activate Account 1
    const act1 = await request(app)
      .post(`/api/accounts/${acc1Id}/activate`)
      .set('X-InfinityPay-Key', apiKey);
    expect(act1.statusCode).toBe(200);
    expect(act1.body.data.status).toBe('active');

    // 2. Activate Account 2
    const act2 = await request(app)
      .post(`/api/accounts/${acc2Id}/activate`)
      .set('X-InfinityPay-Key', apiKey);
    expect(act2.statusCode).toBe(200);
    expect(act2.body.data.status).toBe('active');

    // 3. Verify Account 1 is now inactive
    const check1 = await request(app)
      .get(`/api/accounts/${acc1Id}`)
      .set('X-InfinityPay-Key', apiKey);
    expect(check1.body.data.status).toBe('inactive');

    // 4. Verify Account 2 remains active
    const check2 = await request(app)
      .get(`/api/accounts/${acc2Id}`)
      .set('X-InfinityPay-Key', apiKey);
    expect(check2.body.data.status).toBe('active');
  });

  it('Enforces merchant isolation: Merchant B cannot access Merchant A accounts', async () => {
    const merchantA = await setupTestMerchant({ email: 'merchantA@test.com' });
    const merchantB = await setupTestMerchant({ email: 'merchantB@test.com' });

    // Merchant A creates account
    const accRes = await request(app)
      .post('/api/accounts')
      .set('X-InfinityPay-Key', merchantA.apiKey)
      .send({
        phone_number: '9876543210',
        upi_id: 'merchantA@okhdfcbank',
        email: 'a@merchant.com',
      });
    const accId = accRes.body.data.account_id;

    // Merchant B attempts to fetch Account A
    const bFetchRes = await request(app)
      .get(`/api/accounts/${accId}`)
      .set('X-InfinityPay-Key', merchantB.apiKey);

    expect(bFetchRes.statusCode).toBe(404);
    expect(bFetchRes.body.error.code).toBe(ErrorCodes.ACCOUNT_NOT_FOUND);

    // Merchant B attempts to delete Account A
    const bDelRes = await request(app)
      .delete(`/api/accounts/${accId}`)
      .set('X-InfinityPay-Key', merchantB.apiKey);

    expect(bDelRes.statusCode).toBe(404);
  });
});

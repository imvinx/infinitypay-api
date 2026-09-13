const request = require('supertest');
const { app, setupTestMerchant, resetMemoryDatabase } = require('./setup');
const { ErrorCodes } = require('../lib/responses');

describe('API Key Authentication & Management', () => {
  beforeEach(() => {
    resetMemoryDatabase();
  });

  it('POST /api/developer/keys generates an API key and returns plaintext key only once', async () => {
    const res = await request(app)
      .post('/api/developer/keys')
      .send({
        merchant_name: 'Stripe Competitor',
        merchant_email: 'ceo@stripecompetitor.com',
        name: 'Live Production Key',
      });

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('key_id');
    expect(res.body.data).toHaveProperty('api_key');
    expect(res.body.data).toHaveProperty('created_at');
    expect(res.body.data.api_key.startsWith('ip_live_')).toBe(true);
  });

  it('GET /api/developer/keys returns key metadata only, never revealing raw keys', async () => {
    const { apiKey, keyId } = await setupTestMerchant();

    const res = await request(app)
      .get('/api/developer/keys')
      .set('X-InfinityPay-Key', apiKey);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.keys)).toBe(true);
    expect(res.body.data.keys.length).toBeGreaterThan(0);

    const keyMeta = res.body.data.keys[0];
    expect(keyMeta.id).toBe(keyId);
    expect(keyMeta).toHaveProperty('key_prefix');
    expect(keyMeta).toHaveProperty('status', 'active');
    expect(keyMeta).not.toHaveProperty('api_key');
    expect(keyMeta).not.toHaveProperty('key_hash');
  });

  it('Rejects requests missing API key with MISSING_API_KEY (HTTP 401)', async () => {
    const res = await request(app).get('/api/developer/keys');

    expect(res.statusCode).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe(ErrorCodes.MISSING_API_KEY);
  });

  it('Rejects requests with invalid API key with INVALID_API_KEY (HTTP 401)', async () => {
    const res = await request(app)
      .get('/api/developer/keys')
      .set('X-InfinityPay-Key', 'ip_live_invalid_random_token_12345');

    expect(res.statusCode).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe(ErrorCodes.INVALID_API_KEY);
  });

  it('Authenticates correctly via Authorization: Bearer <API_KEY>', async () => {
    const { apiKey } = await setupTestMerchant();

    const res = await request(app)
      .get('/api/developer/keys')
      .set('Authorization', `Bearer ${apiKey}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('DELETE /api/developer/keys/:keyId revokes key and prevents subsequent access', async () => {
    const { apiKey, keyId } = await setupTestMerchant();

    // Revoke
    const delRes = await request(app)
      .delete(`/api/developer/keys/${keyId}`)
      .set('X-InfinityPay-Key', apiKey);

    expect(delRes.statusCode).toBe(200);
    expect(delRes.body.success).toBe(true);

    // Try using revoked key
    const authRes = await request(app)
      .get('/api/developer/keys')
      .set('X-InfinityPay-Key', apiKey);

    expect(authRes.statusCode).toBe(401);
    expect(authRes.body.error.code).toBe(ErrorCodes.INVALID_API_KEY);
  });
});

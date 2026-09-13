const request = require('supertest');
const express = require('express');
const { createRateLimiter, resetRateLimitStore } = require('../lib/rate-limiter');
const { ErrorCodes } = require('../lib/responses');

describe('API Rate Limiter Subsystem', () => {
  let testApp;

  beforeEach(() => {
    resetRateLimitStore();
    testApp = express();
    // Configure rate limiter with small threshold: 3 requests per 10 seconds for testing
    testApp.use(createRateLimiter({ windowMs: 10000, max: 3, prefix: 'test-rl' }));
    testApp.get('/test-limit', (req, res) => res.json({ ok: true }));
  });

  it('Attaches X-RateLimit headers and allows requests below threshold', async () => {
    const res1 = await request(testApp)
      .get('/test-limit')
      .set('X-InfinityPay-Key', 'key_test_1');

    expect(res1.statusCode).toBe(200);
    expect(res1.headers).toHaveProperty('x-ratelimit-limit', '3');
    expect(res1.headers).toHaveProperty('x-ratelimit-remaining', '2');

    const res2 = await request(testApp)
      .get('/test-limit')
      .set('X-InfinityPay-Key', 'key_test_1');

    expect(res2.statusCode).toBe(200);
    expect(res2.headers).toHaveProperty('x-ratelimit-remaining', '1');
  });

  it('Returns HTTP 429 and RATE_LIMITED error code when threshold is exceeded', async () => {
    const apiKey = 'key_test_overflow';

    // 3 allowed requests
    for (let i = 0; i < 3; i++) {
      const res = await request(testApp)
        .get('/test-limit')
        .set('X-InfinityPay-Key', apiKey);
      expect(res.statusCode).toBe(200);
    }

    // 4th request must be rate limited with HTTP 429
    const limitRes = await request(testApp)
      .get('/test-limit')
      .set('X-InfinityPay-Key', apiKey);

    expect(limitRes.statusCode).toBe(429);
    expect(limitRes.body.success).toBe(false);
    expect(limitRes.body.error.code).toBe(ErrorCodes.RATE_LIMITED);
    expect(limitRes.body.error).toHaveProperty('retry_after_seconds');
    expect(limitRes.headers).toHaveProperty('retry-after');
  });

  it('Isolates rate limiting quotas between different API keys', async () => {
    const keyA = 'key_merchant_A';
    const keyB = 'key_merchant_B';

    // Exhaust Key A
    for (let i = 0; i < 3; i++) {
      await request(testApp).get('/test-limit').set('X-InfinityPay-Key', keyA);
    }

    // Key A is blocked
    const resA = await request(testApp).get('/test-limit').set('X-InfinityPay-Key', keyA);
    expect(resA.statusCode).toBe(429);

    // Key B is unaffected and allowed
    const resB = await request(testApp).get('/test-limit').set('X-InfinityPay-Key', keyB);
    expect(resB.statusCode).toBe(200);
  });
});

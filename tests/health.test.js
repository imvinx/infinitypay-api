const request = require('supertest');
const { app } = require('./setup');

describe('Health Check API', () => {
  it('GET /api/health returns online status and HTTP 200', async () => {
    const res = await request(app).get('/api/health');

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      success: true,
      service: 'InfinityPay API',
      status: 'online',
    });
  });

  it('GET /api returns base service info', async () => {
    const res = await request(app).get('/api');

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.service).toBe('InfinityPay API');
  });
});

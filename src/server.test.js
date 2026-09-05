const request = require('supertest');
const { closePool } = require('./db/pool');
const app = require('./server');

describe('GET /health', () => {
  afterAll(async () => {
    await closePool();
  });

  test('returns ok status with db reachable', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', db: 'ok' });
  });
});

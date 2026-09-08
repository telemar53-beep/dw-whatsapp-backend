const request = require('supertest');
const { closePool } = require('./db/pool');
const app = require('./server');

describe('proxy trust', () => {
  afterAll(async () => {
    await closePool();
  });

  // Render (like any managed platform) terminates TLS at its own load balancer and
  // forwards the caller's address in X-Forwarded-For. Without this setting Express
  // reports the load balancer's address as req.ip, so every attendant in the office
  // shares one rate-limit bucket and express-rate-limit refuses to key requests.
  test('trusts one proxy hop, so req.ip is the caller and not the platform load balancer', () => {
    expect(app.get('trust proxy')).toBe(1);
  });

  test('does not trust a hop the caller supplied, so X-Forwarded-For cannot be spoofed', () => {
    const trust = app.get('trust proxy fn');
    expect(trust('10.0.0.1', 0)).toBe(true);
    expect(trust('10.0.0.1', 1)).toBe(false);
  });
});

describe('GET /health', () => {

  test('returns ok status with db reachable', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', db: 'ok' });
  });
});

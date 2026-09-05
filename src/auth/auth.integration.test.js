const request = require('supertest');
const { getPool, closePool } = require('../db/pool');
const { createAgent } = require('../agents/agent.repository');
const { requireAuth } = require('./auth.middleware');
const app = require('../server');

describe('auth integration (no mocks)', () => {
  beforeEach(async () => {
    await getPool().query('TRUNCATE agents CASCADE');
  });

  afterAll(async () => {
    await closePool();
  });

  test('login with a real agent returns a token that requireAuth accepts', async () => {
    const agent = await createAgent({ email: 'integration@dw.com', password: 'realpassword123', role: 'admin' });

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'integration@dw.com', password: 'realpassword123' });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body.token).toBeDefined();
    expect(loginRes.body.agent.id).toBe(agent.id);

    const testApp = require('express')();
    testApp.get('/whoami', requireAuth, (req, res) => res.json({ agentId: req.agent.agentId, role: req.agent.role }));

    const whoamiRes = await request(testApp)
      .get('/whoami')
      .set('Authorization', `Bearer ${loginRes.body.token}`);

    expect(whoamiRes.status).toBe(200);
    expect(whoamiRes.body.agentId).toBe(agent.id);
    expect(whoamiRes.body.role).toBe('admin');
  });

  test('login with wrong password returns 401', async () => {
    await createAgent({ email: 'integration2@dw.com', password: 'realpassword123', role: 'agent' });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'integration2@dw.com', password: 'wrongpassword' });

    expect(res.status).toBe(401);
  });
});

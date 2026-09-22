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

describe('POST /api/auth/media-token', () => {
  // describe irmao do de cima: precisa do seu proprio truncate.
  beforeEach(async () => {
    await getPool().query('TRUNCATE agents CASCADE');
  });

  async function logar(role = 'agent', email = 'media@dw.com') {
    await createAgent({ name: 'Ana', email, password: 'secret123', role });
    const res = await request(app).post('/api/auth/login').send({ email, password: 'secret123' });
    return res.body.token;
  }

  test('devolve um token de midia e a validade, autenticando pelo header', async () => {
    const sessao = await logar('agent');

    const res = await request(app).post('/api/auth/media-token').set('Authorization', `Bearer ${sessao}`);

    expect(res.status).toBe(200);
    expect(typeof res.body.mediaToken).toBe('string');
    expect(res.body.expiresInSeconds).toBe(1800);
    // O token de midia nao e o de sessao.
    expect(res.body.mediaToken).not.toBe(sessao);
  });

  test('sem token de sessao, 401', async () => {
    const res = await request(app).post('/api/auth/media-token');
    expect(res.status).toBe(401);
  });

  test('o proprio token de midia NAO serve para pedir outro', async () => {
    const sessao = await logar('agent');
    const primeiro = await request(app).post('/api/auth/media-token').set('Authorization', `Bearer ${sessao}`);

    const segundo = await request(app)
      .post('/api/auth/media-token')
      .set('Authorization', `Bearer ${primeiro.body.mediaToken}`);

    expect(segundo.status).toBe(401);
  });

  test('administrador recebe a permissao de silent; atendente nao', async () => {
    const { verifyMediaToken } = require('./media-token.service');

    const sessaoAdmin = await logar('admin', 'admin-media@dw.com');
    const doAdmin = await request(app).post('/api/auth/media-token').set('Authorization', `Bearer ${sessaoAdmin}`);
    expect(verifyMediaToken(doAdmin.body.mediaToken).podeVerSilent).toBe(true);

    const sessaoAgente = await logar('agent', 'agente-media@dw.com');
    const doAgente = await request(app).post('/api/auth/media-token').set('Authorization', `Bearer ${sessaoAgente}`);
    expect(verifyMediaToken(doAgente.body.mediaToken).podeVerSilent).toBe(false);
  });
});

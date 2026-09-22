// Import nao prova montagem.
//
// Ja aconteceu neste projeto de um modulo estar importado, passar no grep e
// nunca ter sido montado — e ir para producao assim. Aqui as rotas de planos
// sao exercitadas atraves do app REAL de src/server.js, e o que se prova e o
// efeito: a rota responde, em vez de cair no 404 de rota inexistente.
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../server');
const { getPool, closePool } = require('../db/pool');

function tokenFor(agentId, role) {
  return jwt.sign({ agentId, role }, process.env.JWT_SECRET);
}

describe('rotas de planos montadas no servidor', () => {
  beforeEach(async () => {
    await getPool().query('TRUNCATE plans CASCADE');
  });

  afterAll(async () => {
    await closePool();
  });

  test('GET /api/plans responde pelo app real', async () => {
    const res = await request(app)
      .get('/api/plans')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('GET /api/admin/plans responde pelo app real', async () => {
    const res = await request(app)
      .get('/api/admin/plans')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('a autorizacao vale no caminho real: atendente comum nao alcanca a administracao', async () => {
    const res = await request(app)
      .get('/api/admin/plans')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);

    expect(res.status).toBe(403);
  });

  test('o fluxo completo atravessa o app real e a observacao interna nao sai na resposta operacional', async () => {
    const criado = await request(app)
      .post('/api/admin/plans')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ name: '500 Mega', speedMbps: 500, monthlyPrice: 100, installCondition: 'Gratis', note: 'interno' });

    expect(criado.status).toBe(201);
    expect(criado.body.note).toBe('interno');

    const operacional = await request(app)
      .get('/api/plans')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);

    expect(operacional.body).toHaveLength(1);
    expect(operacional.body[0].name).toBe('500 Mega');
    expect(operacional.body[0]).not.toHaveProperty('note');
  });
});

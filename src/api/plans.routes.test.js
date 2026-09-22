jest.mock('../plans/plan.repository');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const { listarPlanosDisponiveis } = require('../plans/plan.repository');
const plansRoutes = require('./plans.routes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/plans', plansRoutes);
  return app;
}

function tokenFor(agentId, role) {
  return jwt.sign({ agentId, role }, process.env.JWT_SECRET);
}

describe('GET /api/plans', () => {
  beforeEach(() => jest.clearAllMocks());

  test('devolve o que o repositorio operacional entrega', async () => {
    listarPlanosDisponiveis.mockResolvedValue([
      { id: 'p1', name: '500 Mega', speedMbps: 500, monthlyPrice: 100, installCondition: 'Gratis' },
    ]);

    const res = await request(buildApp())
      .get('/api/plans')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('500 Mega');
  });

  // A garantia de que `note` nao sai e do repositorio (plan.repository.test.js).
  // Aqui provamos que a ROTA usa a consulta operacional, e nunca a
  // administrativa — e por isso que o campo nao tem como aparecer.
  test('usa a consulta operacional, nunca a administrativa', async () => {
    listarPlanosDisponiveis.mockResolvedValue([]);
    const { listPlansForAdmin } = require('../plans/plan.repository');

    await request(buildApp())
      .get('/api/plans')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);

    expect(listarPlanosDisponiveis).toHaveBeenCalled();
    expect(listPlansForAdmin).not.toHaveBeenCalled();
  });

  test('exige autenticacao', async () => {
    const res = await request(buildApp()).get('/api/plans');

    expect(res.status).toBe(401);
    expect(listarPlanosDisponiveis).not.toHaveBeenCalled();
  });
});

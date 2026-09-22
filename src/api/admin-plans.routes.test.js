jest.mock('../plans/plan.repository');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const {
  listPlansForAdmin, createPlan, updatePlan, deletePlan,
} = require('../plans/plan.repository');
const adminPlansRoutes = require('./admin-plans.routes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/plans', adminPlansRoutes);
  return app;
}

function tokenFor(agentId, role) {
  return jwt.sign({ agentId, role }, process.env.JWT_SECRET);
}

const ADMIN = () => `Bearer ${tokenFor('admin-1', 'admin')}`;
const PLANO = {
  id: 'p1', name: '500 Mega', speedMbps: 500, monthlyPrice: 100,
  installCondition: 'Gratis', active: true, sortOrder: 0, note: '', createdAt: new Date(),
};

describe('GET /api/admin/plans', () => {
  beforeEach(() => jest.clearAllMocks());

  test('lista para o administrador', async () => {
    listPlansForAdmin.mockResolvedValue([PLANO]);

    const res = await request(buildApp()).get('/api/admin/plans').set('Authorization', ADMIN());

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  test('atendente comum nao lista', async () => {
    const res = await request(buildApp())
      .get('/api/admin/plans')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);

    expect(res.status).toBe(403);
    expect(listPlansForAdmin).not.toHaveBeenCalled();
  });

  test('gerente lista, como nas demais rotas administrativas', async () => {
    listPlansForAdmin.mockResolvedValue([]);

    const res = await request(buildApp())
      .get('/api/admin/plans')
      .set('Authorization', `Bearer ${tokenFor('manager-1', 'manager')}`);

    expect(res.status).toBe(200);
  });
});

describe('POST /api/admin/plans', () => {
  beforeEach(() => jest.clearAllMocks());

  test('cria e devolve 201', async () => {
    createPlan.mockResolvedValue(PLANO);

    const res = await request(buildApp()).post('/api/admin/plans').set('Authorization', ADMIN())
      .send({ name: '  500 Mega  ', speedMbps: 500, monthlyPrice: 100, installCondition: ' Gratis ' });

    expect(res.status).toBe(201);
    expect(createPlan).toHaveBeenCalledWith({
      name: '500 Mega', speedMbps: 500, monthlyPrice: 100,
      installCondition: 'Gratis', active: true, sortOrder: 0, note: '',
    });
  });

  test('velocidade ausente vira null, nao zero', async () => {
    createPlan.mockResolvedValue(PLANO);

    await request(buildApp()).post('/api/admin/plans').set('Authorization', ADMIN())
      .send({ name: 'TV', monthlyPrice: 50 });

    expect(createPlan).toHaveBeenCalledWith(expect.objectContaining({ speedMbps: null }));
  });

  test('recusa nome vazio ou so espacos', async () => {
    for (const name of [undefined, '', '   ']) {
      const res = await request(buildApp()).post('/api/admin/plans').set('Authorization', ADMIN())
        .send({ name, monthlyPrice: 100 });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('name is required');
    }
    expect(createPlan).not.toHaveBeenCalled();
  });

  test('recusa preco ausente, negativo ou nao numerico', async () => {
    for (const monthlyPrice of [undefined, -1, 'cem', null]) {
      const res = await request(buildApp()).post('/api/admin/plans').set('Authorization', ADMIN())
        .send({ name: 'Teste', monthlyPrice });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('monthlyPrice is invalid');
    }
    expect(createPlan).not.toHaveBeenCalled();
  });

  test('aceita preco zero', async () => {
    createPlan.mockResolvedValue(PLANO);

    const res = await request(buildApp()).post('/api/admin/plans').set('Authorization', ADMIN())
      .send({ name: 'Cortesia', monthlyPrice: 0 });

    expect(res.status).toBe(201);
    expect(createPlan).toHaveBeenCalledWith(expect.objectContaining({ monthlyPrice: 0 }));
  });

  test('recusa velocidade nao inteira ou nao positiva', async () => {
    for (const speedMbps of [0, -5, 1.5, '500']) {
      const res = await request(buildApp()).post('/api/admin/plans').set('Authorization', ADMIN())
        .send({ name: 'Teste', monthlyPrice: 100, speedMbps });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('speedMbps is invalid');
    }
    expect(createPlan).not.toHaveBeenCalled();
  });

  test('atendente comum nao cria', async () => {
    const res = await request(buildApp()).post('/api/admin/plans')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ name: 'Teste', monthlyPrice: 100 });

    expect(res.status).toBe(403);
    expect(createPlan).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/admin/plans/:id', () => {
  beforeEach(() => jest.clearAllMocks());

  test('altera so o que veio no corpo', async () => {
    updatePlan.mockResolvedValue({ ...PLANO, monthlyPrice: 150 });

    const res = await request(buildApp()).patch('/api/admin/plans/p1').set('Authorization', ADMIN())
      .send({ monthlyPrice: 150 });

    expect(res.status).toBe(200);
    expect(updatePlan).toHaveBeenCalledWith('p1', { monthlyPrice: 150 });
  });

  test('desligar o plano e limpar campos sao alteracoes legitimas', async () => {
    updatePlan.mockResolvedValue({ ...PLANO, active: false });

    await request(buildApp()).patch('/api/admin/plans/p1').set('Authorization', ADMIN())
      .send({ active: false, note: '', sortOrder: 0, speedMbps: null });

    expect(updatePlan).toHaveBeenCalledWith('p1', {
      active: false, note: '', sortOrder: 0, speedMbps: null,
    });
  });

  test('recusa tipos errados sem chamar o repositorio', async () => {
    const casos = [
      [{ name: '  ' }, 'name is required'],
      [{ monthlyPrice: 'cem' }, 'monthlyPrice is invalid'],
      [{ speedMbps: 0 }, 'speedMbps is invalid'],
      [{ active: 'sim' }, 'active must be a boolean'],
      [{ sortOrder: 1.5 }, 'sortOrder is invalid'],
    ];
    for (const [corpo, erro] of casos) {
      const res = await request(buildApp()).patch('/api/admin/plans/p1').set('Authorization', ADMIN()).send(corpo);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe(erro);
    }
    expect(updatePlan).not.toHaveBeenCalled();
  });

  test('id inexistente devolve 404', async () => {
    updatePlan.mockResolvedValue(null);

    const res = await request(buildApp()).patch('/api/admin/plans/sumiu').set('Authorization', ADMIN())
      .send({ name: 'x' });

    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/admin/plans/:id', () => {
  beforeEach(() => jest.clearAllMocks());

  test('remove e devolve 204', async () => {
    deletePlan.mockResolvedValue(true);

    const res = await request(buildApp()).delete('/api/admin/plans/p1').set('Authorization', ADMIN());

    expect(res.status).toBe(204);
    expect(deletePlan).toHaveBeenCalledWith('p1');
  });

  test('id inexistente devolve 404', async () => {
    deletePlan.mockResolvedValue(false);

    const res = await request(buildApp()).delete('/api/admin/plans/sumiu').set('Authorization', ADMIN());

    expect(res.status).toBe(404);
  });

  test('atendente comum nao remove', async () => {
    const res = await request(buildApp()).delete('/api/admin/plans/p1')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);

    expect(res.status).toBe(403);
    expect(deletePlan).not.toHaveBeenCalled();
  });
});

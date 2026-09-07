jest.mock('../triage/triage.repository');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const {
  getTriageConfig,
  updateTriageConfig,
  listTriageOptions,
  createTriageOption,
  updateTriageOption,
  deleteTriageOption,
} = require('../triage/triage.repository');
const adminTriageRoutes = require('./admin-triage.routes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/triage', adminTriageRoutes);
  return app;
}

function tokenFor(agentId, role) {
  return jwt.sign({ agentId, role }, process.env.JWT_SECRET);
}

describe('GET /api/admin/triage', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns the config combined with the options list', async () => {
    getTriageConfig.mockResolvedValue({ questionText: 'Pergunta', confirmationText: 'Confirmação', maxAttempts: 2 });
    listTriageOptions.mockResolvedValue([
      { id: 'opt-1', optionNumber: 1, sectorId: 'sector-1', sectorName: 'Financeiro', keywords: ['fatura'] },
    ]);

    const res = await request(buildApp())
      .get('/api/admin/triage')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      questionText: 'Pergunta',
      confirmationText: 'Confirmação',
      maxAttempts: 2,
      options: [{ id: 'opt-1', optionNumber: 1, sectorId: 'sector-1', sectorName: 'Financeiro', keywords: ['fatura'] }],
    });
  });

  test('returns 403 for a non-admin agent', async () => {
    const res = await request(buildApp())
      .get('/api/admin/triage')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(403);
  });

  test('returns 401 without a token', async () => {
    const res = await request(buildApp()).get('/api/admin/triage');
    expect(res.status).toBe(401);
  });
});

describe('PUT /api/admin/triage/config', () => {
  beforeEach(() => jest.clearAllMocks());

  test('updates the config', async () => {
    updateTriageConfig.mockResolvedValue({ questionText: 'Nova', confirmationText: 'Nova conf', maxAttempts: 3 });

    const res = await request(buildApp())
      .put('/api/admin/triage/config')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send({ questionText: 'Nova', confirmationText: 'Nova conf', maxAttempts: 3 });

    expect(res.status).toBe(200);
    expect(updateTriageConfig).toHaveBeenCalledWith({ questionText: 'Nova', confirmationText: 'Nova conf', maxAttempts: 3 });
    expect(res.body).toEqual({ questionText: 'Nova', confirmationText: 'Nova conf', maxAttempts: 3 });
  });

  test('returns 400 when questionText is blank', async () => {
    const res = await request(buildApp())
      .put('/api/admin/triage/config')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send({ questionText: '  ', confirmationText: 'Conf', maxAttempts: 2 });

    expect(res.status).toBe(400);
    expect(updateTriageConfig).not.toHaveBeenCalled();
  });

  test('returns 400 when maxAttempts is not a positive integer', async () => {
    const res = await request(buildApp())
      .put('/api/admin/triage/config')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send({ questionText: 'Pergunta', confirmationText: 'Conf', maxAttempts: 0 });

    expect(res.status).toBe(400);
    expect(updateTriageConfig).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/triage/options', () => {
  beforeEach(() => jest.clearAllMocks());

  test('creates an option', async () => {
    createTriageOption.mockResolvedValue({ id: 'opt-1', optionNumber: 1, sectorId: 'sector-1', sectorName: 'Financeiro', keywords: ['fatura'] });

    const res = await request(buildApp())
      .post('/api/admin/triage/options')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send({ optionNumber: 1, sectorId: 'sector-1', keywords: [' fatura ', '', 'boleto'] });

    expect(res.status).toBe(201);
    expect(createTriageOption).toHaveBeenCalledWith({ optionNumber: 1, sectorId: 'sector-1', keywords: ['fatura', 'boleto'] });
  });

  test('returns 400 when sectorId is missing', async () => {
    const res = await request(buildApp())
      .post('/api/admin/triage/options')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send({ optionNumber: 1, keywords: [] });

    expect(res.status).toBe(400);
    expect(createTriageOption).not.toHaveBeenCalled();
  });

  test('returns 409 when the option number already exists', async () => {
    createTriageOption.mockRejectedValue(Object.assign(new Error('duplicate key'), { code: '23505' }));

    const res = await request(buildApp())
      .post('/api/admin/triage/options')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send({ optionNumber: 1, sectorId: 'sector-1', keywords: [] });

    expect(res.status).toBe(409);
  });
});

describe('PATCH /api/admin/triage/options/:id', () => {
  beforeEach(() => jest.clearAllMocks());

  test('updates an option', async () => {
    updateTriageOption.mockResolvedValue({ id: 'opt-1', optionNumber: 2, sectorId: 'sector-2', sectorName: 'Suporte', keywords: ['internet'] });

    const res = await request(buildApp())
      .patch('/api/admin/triage/options/opt-1')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send({ optionNumber: 2, sectorId: 'sector-2', keywords: ['internet'] });

    expect(res.status).toBe(200);
    expect(updateTriageOption).toHaveBeenCalledWith('opt-1', { optionNumber: 2, sectorId: 'sector-2', keywords: ['internet'] });
  });

  test('returns 404 when the option does not exist', async () => {
    updateTriageOption.mockResolvedValue(null);

    const res = await request(buildApp())
      .patch('/api/admin/triage/options/does-not-exist')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send({ optionNumber: 1, sectorId: 'sector-1', keywords: [] });

    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/admin/triage/options/:id', () => {
  beforeEach(() => jest.clearAllMocks());

  test('deletes an option', async () => {
    deleteTriageOption.mockResolvedValue(true);

    const res = await request(buildApp())
      .delete('/api/admin/triage/options/opt-1')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`);

    expect(res.status).toBe(204);
  });

  test('returns 404 when the option does not exist', async () => {
    deleteTriageOption.mockResolvedValue(false);

    const res = await request(buildApp())
      .delete('/api/admin/triage/options/does-not-exist')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`);

    expect(res.status).toBe(404);
  });
});

jest.mock('../integrations/sgp-client');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const {
  lookupClientByCpf,
  getDuplicateInvoice,
  SgpNotConfiguredError,
  SgpDisabledError,
  SgpClientNotFoundError,
  SgpRequestError,
} = require('../integrations/sgp-client');
const sgpQueryRoutes = require('./sgp-query.routes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sgp', sgpQueryRoutes);
  app.use((err, req, res, next) => res.status(500).json({ error: 'Internal server error' }));
  return app;
}

function tokenFor(agentId, role) {
  return jwt.sign({ agentId, role }, process.env.JWT_SECRET);
}

describe('GET /api/sgp/clientes', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns 401 without a token', async () => {
    const res = await request(buildApp()).get('/api/sgp/clientes?cpf=03666811337');
    expect(res.status).toBe(401);
  });

  test('returns 400 when cpf is missing', async () => {
    const res = await request(buildApp())
      .get('/api/sgp/clientes')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(400);
    expect(lookupClientByCpf).not.toHaveBeenCalled();
  });

  test('strips non-digit characters from cpf before calling the client', async () => {
    lookupClientByCpf.mockResolvedValue({ client: { id: 1, name: 'X', document: 'X' }, contracts: [] });
    await request(buildApp())
      .get('/api/sgp/clientes?cpf=036.668.113-37')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(lookupClientByCpf).toHaveBeenCalledWith('03666811337');
  });

  test('returns 200 with the normalized result', async () => {
    lookupClientByCpf.mockResolvedValue({ client: { id: 1, name: 'X', document: 'X' }, contracts: [] });
    const res = await request(buildApp())
      .get('/api/sgp/clientes?cpf=03666811337')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ client: { id: 1, name: 'X', document: 'X' }, contracts: [] });
  });

  test('returns 400 when SGP is not configured', async () => {
    lookupClientByCpf.mockRejectedValue(new SgpNotConfiguredError());
    const res = await request(buildApp())
      .get('/api/sgp/clientes?cpf=03666811337')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'SGP integration is not configured' });
  });

  test('returns 400 when SGP is disabled', async () => {
    lookupClientByCpf.mockRejectedValue(new SgpDisabledError());
    const res = await request(buildApp())
      .get('/api/sgp/clientes?cpf=03666811337')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'SGP integration is not enabled' });
  });

  test('returns 404 when the client is not found', async () => {
    lookupClientByCpf.mockRejectedValue(new SgpClientNotFoundError());
    const res = await request(buildApp())
      .get('/api/sgp/clientes?cpf=00000000000')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Client not found' });
  });

  test('returns 502 when SGP cannot be reached', async () => {
    lookupClientByCpf.mockRejectedValue(new SgpRequestError());
    const res = await request(buildApp())
      .get('/api/sgp/clientes?cpf=03666811337')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: 'Failed to reach SGP' });
  });

  test('forwards an unexpected error to the error middleware', async () => {
    lookupClientByCpf.mockRejectedValue(new Error('boom'));
    const res = await request(buildApp())
      .get('/api/sgp/clientes?cpf=03666811337')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(500);
  });
});

describe('POST /api/sgp/contratos/:contratoId/boleto', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns 200 with the normalized duplicate invoice result', async () => {
    getDuplicateInvoice.mockResolvedValue({ hasOpenInvoice: true, duplicates: [{ id: '999', dueDate: '2026-09-20', value: 89.9, barCode: '836...', pixCode: '000201...', boletoLink: 'https://x' }] });
    const res = await request(buildApp())
      .post('/api/sgp/contratos/17402/boleto')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(getDuplicateInvoice).toHaveBeenCalledWith('17402');
    expect(res.status).toBe(200);
    expect(res.body.hasOpenInvoice).toBe(true);
  });

  test('returns 502 when SGP cannot be reached', async () => {
    getDuplicateInvoice.mockRejectedValue(new SgpRequestError());
    const res = await request(buildApp())
      .post('/api/sgp/contratos/17402/boleto')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(502);
  });

  test('returns 401 without a token', async () => {
    const res = await request(buildApp()).post('/api/sgp/contratos/17402/boleto');
    expect(res.status).toBe(401);
    expect(getDuplicateInvoice).not.toHaveBeenCalled();
  });
});

jest.mock('../company/company-config.repository');

const request = require('supertest');
const express = require('express');
const { getCompanyConfig } = require('../company/company-config.repository');
const publicCompanyRoutes = require('./public-company.routes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/public/company', publicCompanyRoutes);
  return app;
}

describe('GET /api/public/company', () => {
  beforeEach(() => jest.clearAllMocks());

  // A tela de login precisa do nome da empresa ANTES de existir token: é a
  // única rota do sistema que devolve configuração sem autenticação, e por
  // isso devolve só o nome — nada dos nomes aceitos no comprovante.
  test('devolve só o nome, sem token', async () => {
    getCompanyConfig.mockResolvedValue({ id: 'cfg-1', name: 'Provedor X', acceptedPayeeNames: ['Provedor X Ltda'] });
    const res = await request(buildApp()).get('/api/public/company');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ name: 'Provedor X' });
  });

  test('sem configuração devolve o nome vazio', async () => {
    getCompanyConfig.mockResolvedValue({ id: null, name: '', acceptedPayeeNames: [] });
    const res = await request(buildApp()).get('/api/public/company');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ name: '' });
  });
});

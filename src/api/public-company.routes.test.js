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

const CONFIG_COMPLETA = {
  id: 'cfg-1',
  name: 'Provedor X',
  acceptedPayeeNames: ['Provedor X Ltda'],
  logoUrl: 'https://cdn.exemplo/logo.png',
  symbolUrl: 'https://cdn.exemplo/simbolo.png',
  brandColor: '#1a73e8',
};

describe('GET /api/public/company', () => {
  beforeEach(() => jest.clearAllMocks());

  // A tela de login precisa da identidade da empresa ANTES de existir token: é
  // a única rota do sistema que devolve configuração sem autenticação. Por
  // isso o que ela devolve é uma lista fechada — nome e os três campos
  // visuais —, e o toEqual abaixo é a trava: campo novo no repositório não
  // passa a vazar por esta rota sem alguém decidir.
  test('devolve o nome e a identidade visual, sem token', async () => {
    getCompanyConfig.mockResolvedValue(CONFIG_COMPLETA);

    const res = await request(buildApp()).get('/api/public/company');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      name: 'Provedor X',
      logoUrl: 'https://cdn.exemplo/logo.png',
      symbolUrl: 'https://cdn.exemplo/simbolo.png',
      brandColor: '#1a73e8',
    });
  });

  test('não devolve os nomes do comprovante nem o id da linha', async () => {
    getCompanyConfig.mockResolvedValue(CONFIG_COMPLETA);

    const res = await request(buildApp()).get('/api/public/company');

    expect(res.body.acceptedPayeeNames).toBeUndefined();
    expect(res.body.id).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain('Provedor X Ltda');
  });

  test('sem configuração devolve tudo vazio', async () => {
    getCompanyConfig.mockResolvedValue({ id: null, name: '', acceptedPayeeNames: [], logoUrl: '', symbolUrl: '', brandColor: '' });

    const res = await request(buildApp()).get('/api/public/company');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ name: '', logoUrl: '', symbolUrl: '', brandColor: '' });
  });
});

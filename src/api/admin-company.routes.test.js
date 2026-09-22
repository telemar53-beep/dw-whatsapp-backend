jest.mock('../company/company-config.repository');

const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const { getCompanyConfig, upsertCompanyConfig } = require('../company/company-config.repository');
const adminCompanyRoutes = require('./admin-company.routes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/company', adminCompanyRoutes);
  return app;
}

function tokenFor(agentId, role) {
  return jwt.sign({ agentId, role }, process.env.JWT_SECRET);
}

const NOME_LONGO = 'x'.repeat(81);

describe('GET /api/admin/company', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns the current config', async () => {
    getCompanyConfig.mockResolvedValue({ id: 'cfg-1', name: 'Provedor X', acceptedPayeeNames: ['Provedor X Ltda'] });
    const res = await request(buildApp())
      .get('/api/admin/company')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 'cfg-1', name: 'Provedor X', acceptedPayeeNames: ['Provedor X Ltda'] });
  });

  test('returns 403 for a non-admin agent', async () => {
    const res = await request(buildApp())
      .get('/api/admin/company')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(403);
  });
});

describe('PUT /api/admin/company', () => {
  beforeEach(() => jest.clearAllMocks());

  test('saves the config and returns it', async () => {
    upsertCompanyConfig.mockResolvedValue({ id: 'cfg-1', name: 'Provedor X', acceptedPayeeNames: ['Provedor X Ltda', 'Fulano'] });
    const res = await request(buildApp())
      .put('/api/admin/company')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ name: 'Provedor X', acceptedPayeeNames: ['Provedor X Ltda', 'Fulano'] });
    expect(res.status).toBe(200);
    expect(upsertCompanyConfig).toHaveBeenCalledWith({ name: 'Provedor X', acceptedPayeeNames: ['Provedor X Ltda', 'Fulano'] });
    expect(res.body.acceptedPayeeNames).toEqual(['Provedor X Ltda', 'Fulano']);
  });

  test('accepts an empty name and an empty list', async () => {
    upsertCompanyConfig.mockResolvedValue({ id: 'cfg-1', name: '', acceptedPayeeNames: [] });
    const res = await request(buildApp())
      .put('/api/admin/company')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ name: '', acceptedPayeeNames: [] });
    expect(res.status).toBe(200);
    expect(upsertCompanyConfig).toHaveBeenCalledWith({ name: '', acceptedPayeeNames: [] });
  });

  test('returns 400 when name is not a string', async () => {
    const res = await request(buildApp())
      .put('/api/admin/company')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ name: 42, acceptedPayeeNames: [] });
    expect(res.status).toBe(400);
    expect(upsertCompanyConfig).not.toHaveBeenCalled();
  });

  test('returns 400 when name is longer than 80 chars', async () => {
    const res = await request(buildApp())
      .put('/api/admin/company')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ name: NOME_LONGO, acceptedPayeeNames: [] });
    expect(res.status).toBe(400);
    expect(upsertCompanyConfig).not.toHaveBeenCalled();
  });

  test('returns 400 when acceptedPayeeNames is not an array', async () => {
    const res = await request(buildApp())
      .put('/api/admin/company')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ name: 'Provedor X', acceptedPayeeNames: 'Provedor X Ltda' });
    expect(res.status).toBe(400);
    expect(upsertCompanyConfig).not.toHaveBeenCalled();
  });

  test('returns 400 when the list has more than 20 names', async () => {
    const res = await request(buildApp())
      .put('/api/admin/company')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ name: 'Provedor X', acceptedPayeeNames: Array.from({ length: 21 }, (_, i) => `Nome ${i}`) });
    expect(res.status).toBe(400);
    expect(upsertCompanyConfig).not.toHaveBeenCalled();
  });

  test('returns 400 when one of the names is not a string or is too long', async () => {
    const app = buildApp();
    const naoTexto = await request(app)
      .put('/api/admin/company')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ name: 'Provedor X', acceptedPayeeNames: ['ok', 7] });
    expect(naoTexto.status).toBe(400);

    const longo = await request(app)
      .put('/api/admin/company')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ name: 'Provedor X', acceptedPayeeNames: ['ok', NOME_LONGO] });
    expect(longo.status).toBe(400);
    expect(upsertCompanyConfig).not.toHaveBeenCalled();
  });

  test('returns 403 for a non-admin agent', async () => {
    const res = await request(buildApp())
      .put('/api/admin/company')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ name: 'Provedor X', acceptedPayeeNames: [] });
    expect(res.status).toBe(403);
  });
});

// Identidade visual da instalação. São os únicos campos do sistema que saem
// numa rota pública e viram atributo de imagem e valor de CSS numa página sem
// autenticação — por isso a validação é por formato, não só por tipo.
describe('identidade visual (logo, símbolo e cor)', () => {
  beforeEach(() => jest.clearAllMocks());

  function salvar(corpo) {
    return request(buildApp())
      .put('/api/admin/company')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send({ name: 'Provedor X', acceptedPayeeNames: [], ...corpo });
  }

  test('salva e devolve os três campos', async () => {
    upsertCompanyConfig.mockResolvedValue({
      id: 'cfg-1', name: 'Provedor X', acceptedPayeeNames: [],
      logoUrl: 'https://cdn.exemplo/logo.png', symbolUrl: 'https://cdn.exemplo/s.png', brandColor: '#1a73e8',
    });

    const res = await salvar({ logoUrl: 'https://cdn.exemplo/logo.png', symbolUrl: 'https://cdn.exemplo/s.png', brandColor: '#1a73e8' });

    expect(res.status).toBe(200);
    expect(res.body.logoUrl).toBe('https://cdn.exemplo/logo.png');
    expect(res.body.symbolUrl).toBe('https://cdn.exemplo/s.png');
    expect(res.body.brandColor).toBe('#1a73e8');
    expect(upsertCompanyConfig).toHaveBeenCalledWith(expect.objectContaining({
      logoUrl: 'https://cdn.exemplo/logo.png', symbolUrl: 'https://cdn.exemplo/s.png', brandColor: '#1a73e8',
    }));
  });

  // O que impede a URL de virar vetor: ela vai para o `src` de uma imagem
  // numa página pública.
  test('recusa URL que não é http(s)', async () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,<script>', 'file:///etc/passwd', 'vbscript:x', '  javascript:alert(1)  ']) {
      const res = await salvar({ logoUrl: url });
      expect(res.status).toBe(400);
      expect(upsertCompanyConfig).not.toHaveBeenCalled();
    }
  });

  test('recusa cor que não é hex, para não virar pedaço de CSS', async () => {
    for (const cor of ['red; background: url(http://x)', 'expression(alert(1))', '#12345', 'rgb(1,2,3)', 42]) {
      const res = await salvar({ brandColor: cor });
      expect(res.status).toBe(400);
      expect(upsertCompanyConfig).not.toHaveBeenCalled();
    }
  });

  test('aceita hex de 3 e de 6 dígitos', async () => {
    upsertCompanyConfig.mockResolvedValue({ id: 'cfg-1', name: 'X', acceptedPayeeNames: [], logoUrl: '', symbolUrl: '', brandColor: '#abc' });
    expect((await salvar({ brandColor: '#abc' })).status).toBe(200);
    expect((await salvar({ brandColor: '#AABBCC' })).status).toBe(200);
  });

  // Vazio é como se TIRA a marca — diferente de omitir, que é não mexer.
  test('string vazia é valor válido: apaga a marca', async () => {
    upsertCompanyConfig.mockResolvedValue({ id: 'cfg-1', name: 'X', acceptedPayeeNames: [], logoUrl: '', symbolUrl: '', brandColor: '' });

    const res = await salvar({ logoUrl: '', symbolUrl: '', brandColor: '' });

    expect(res.status).toBe(200);
    expect(upsertCompanyConfig).toHaveBeenCalledWith(expect.objectContaining({ logoUrl: '', symbolUrl: '', brandColor: '' }));
  });

  // ADR-011: salvar só o nome não pode apagar a marca da instalação.
  test('campo omitido chega como undefined, e o repositório entende "não mexe"', async () => {
    upsertCompanyConfig.mockResolvedValue({ id: 'cfg-1', name: 'Provedor X', acceptedPayeeNames: [], logoUrl: 'https://cdn.exemplo/logo.png', symbolUrl: '', brandColor: '' });

    await request(buildApp())
      .put('/api/admin/company')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send({ name: 'Provedor X', acceptedPayeeNames: [] });

    const argumentos = upsertCompanyConfig.mock.calls[0][0];
    expect(argumentos.logoUrl).toBeUndefined();
    expect(argumentos.symbolUrl).toBeUndefined();
    expect(argumentos.brandColor).toBeUndefined();
  });

  test('URL longa demais é recusada', async () => {
    const res = await salvar({ logoUrl: `https://cdn.exemplo/${'a'.repeat(600)}.png` });
    expect(res.status).toBe(400);
  });
});

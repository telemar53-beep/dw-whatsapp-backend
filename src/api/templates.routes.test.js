jest.mock('../templates/template.service');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const { listApprovedTemplatesForChannel } = require('../templates/template.service');
const templatesRoutes = require('./templates.routes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/templates', templatesRoutes);
  return app;
}

function tokenFor(agentId, role) {
  return jwt.sign({ agentId, role }, process.env.JWT_SECRET);
}

describe('GET /api/templates', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns approved templates for the given channelId', async () => {
    listApprovedTemplatesForChannel.mockResolvedValue([{ id: 'tpl-1', name: 'fatura_vencida' }]);
    const res = await request(buildApp())
      .get('/api/templates?channelId=ch-1')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 'tpl-1', name: 'fatura_vencida' }]);
    expect(listApprovedTemplatesForChannel).toHaveBeenCalledWith('ch-1', undefined);
  });

  test('returns 400 when channelId is missing', async () => {
    const res = await request(buildApp()).get('/api/templates').set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(400);
  });

  test('returns 401 without a token', async () => {
    const res = await request(buildApp()).get('/api/templates?channelId=ch-1');
    expect(res.status).toBe(401);
  });

  test('works for a non-admin agent (open route)', async () => {
    listApprovedTemplatesForChannel.mockResolvedValue([]);
    const res = await request(buildApp())
      .get('/api/templates?channelId=ch-1')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(200);
  });
});

// Template de disparo (o que o SGP usa) nao pode aparecer para o atendente ao
// iniciar uma conversa; template de atendimento nao deve virar campanha. Quem
// chama diz qual lista quer.
describe('GET /api/templates — finalidade', () => {
  beforeEach(() => jest.clearAllMocks());

  function pedir(query, role = 'agent') {
    listApprovedTemplatesForChannel.mockResolvedValue([]);
    return request(buildApp())
      .get(`/api/templates?${query}`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', role)}`);
  }

  test('repassa a finalidade pedida', async () => {
    await pedir('channelId=ch-1&purpose=atendimento');
    expect(listApprovedTemplatesForChannel).toHaveBeenCalledWith('ch-1', 'atendimento');
  });

  test('repassa disparo quando a tela de campanha pede', async () => {
    await pedir('channelId=ch-1&purpose=disparo');
    expect(listApprovedTemplatesForChannel).toHaveBeenCalledWith('ch-1', 'disparo');
  });

  test('recusa uma finalidade desconhecida em vez de devolver tudo', async () => {
    const res = await pedir('channelId=ch-1&purpose=qualquer');
    expect(res.status).toBe(400);
    expect(listApprovedTemplatesForChannel).not.toHaveBeenCalled();
  });
});

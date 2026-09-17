jest.mock('../templates/template.repository');
// Full automock of template.service would also automock TemplateValidationError.
// Jest's automock rewrites class constructors, so an automocked Error subclass
// loses its message and its `instanceof Error` chain (confirmed empirically:
// message becomes '' and `instanceof Error` becomes false, even though
// `instanceof TemplateValidationError` still holds). That would break the
// route's `err.message` passthrough being asserted below, even though the
// route code itself is correct. Keep the real error class via requireActual
// and only stub the three functions this suite needs to control.
jest.mock('../templates/template.service', () => {
  const actual = jest.requireActual('../templates/template.service');
  return {
    ...actual,
    createTemplate: jest.fn(),
    deleteTemplate: jest.fn(),
    syncTemplatesForWaba: jest.fn(),
    registerExistingTemplate: jest.fn(),
  };
});
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const { listTemplates, updateTemplatePurpose } = require('../templates/template.repository');
const { createTemplate, deleteTemplate, syncTemplatesForWaba, registerExistingTemplate, TemplateValidationError } = require('../templates/template.service');
const adminTemplatesRoutes = require('./admin-templates.routes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/templates', adminTemplatesRoutes);
  return app;
}

function tokenFor(agentId, role) {
  return jwt.sign({ agentId, role }, process.env.JWT_SECRET);
}

beforeEach(() => jest.clearAllMocks());

describe('GET /api/admin/templates', () => {
  test('returns every template', async () => {
    listTemplates.mockResolvedValue([{ id: 'tpl-1' }]);
    const res = await request(buildApp()).get('/api/admin/templates').set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 'tpl-1' }]);
  });

  test('returns 403 for a non-admin', async () => {
    const res = await request(buildApp()).get('/api/admin/templates').set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(403);
  });
});

describe('POST /api/admin/templates', () => {
  test('returns 400 when a required field is missing', async () => {
    const res = await request(buildApp())
      .post('/api/admin/templates')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send({ channelId: 'ch-1', name: 'x' });
    expect(res.status).toBe(400);
    expect(createTemplate).not.toHaveBeenCalled();
  });

  test('creates the template and returns 201', async () => {
    createTemplate.mockResolvedValue({ id: 'tpl-1', name: 'fatura_vencida', status: 'PENDING' });
    const res = await request(buildApp())
      .post('/api/admin/templates')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send({ channelId: 'ch-1', name: 'fatura_vencida', category: 'UTILITY', language: 'pt_BR', bodyText: 'Olá {{1}}.' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: 'tpl-1', name: 'fatura_vencida', status: 'PENDING' });
  });

  test('returns 400 for a TemplateValidationError', async () => {
    createTemplate.mockRejectedValue(new TemplateValidationError('bad name'));
    const res = await request(buildApp())
      .post('/api/admin/templates')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send({ channelId: 'ch-1', name: 'x', category: 'UTILITY', language: 'pt_BR', bodyText: 'Y' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('bad name');
  });

  test('returns 409 for a duplicate (wabaId, name, language)', async () => {
    createTemplate.mockRejectedValue(Object.assign(new Error('duplicate'), { code: '23505' }));
    const res = await request(buildApp())
      .post('/api/admin/templates')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send({ channelId: 'ch-1', name: 'x', category: 'UTILITY', language: 'pt_BR', bodyText: 'Y' });
    expect(res.status).toBe(409);
  });

  test('returns 502 with Meta\'s own error message when Meta rejects the request', async () => {
    createTemplate.mockRejectedValue({ response: { data: { error: { message: 'Invalid parameter' } } } });
    const res = await request(buildApp())
      .post('/api/admin/templates')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send({ channelId: 'ch-1', name: 'x', category: 'UTILITY', language: 'pt_BR', bodyText: 'Y' });
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('A Meta recusou: Invalid parameter');
  });

  test('returns 502 with error_user_title and error_user_msg combined when both are present', async () => {
    createTemplate.mockRejectedValue({
      response: {
        data: {
          error: {
            message: 'Invalid parameter',
            error_user_title: 'Idioma inválido',
            error_user_msg: 'Use o código do idioma, como pt_BR.',
          },
        },
      },
    });
    const res = await request(buildApp())
      .post('/api/admin/templates')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send({ channelId: 'ch-1', name: 'x', category: 'UTILITY', language: 'pt_BR', bodyText: 'Y' });
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('A Meta recusou: Idioma inválido: Use o código do idioma, como pt_BR.');
  });

  test('returns 502 with error_data.details when error_user_msg is absent', async () => {
    createTemplate.mockRejectedValue({
      response: {
        data: {
          error: {
            message: 'Invalid parameter',
            error_data: { details: 'Param language must be a valid language code' },
          },
        },
      },
    });
    const res = await request(buildApp())
      .post('/api/admin/templates')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send({ channelId: 'ch-1', name: 'x', category: 'UTILITY', language: 'pt_BR', bodyText: 'Y' });
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('A Meta recusou: Param language must be a valid language code');
  });

  test('propagates a non-Meta error instead of masking it as a 502', async () => {
    createTemplate.mockRejectedValue(new Error('database connection lost'));
    const res = await request(buildApp())
      .post('/api/admin/templates')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send({ channelId: 'ch-1', name: 'x', category: 'UTILITY', language: 'pt_BR', bodyText: 'Y' });
    expect(res.status).toBe(500);
  });
});

describe('DELETE /api/admin/templates/:id', () => {
  test('returns 204 when deleted', async () => {
    deleteTemplate.mockResolvedValue(true);
    const res = await request(buildApp()).delete('/api/admin/templates/tpl-1').set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`);
    expect(res.status).toBe(204);
  });

  test('returns 404 when not found', async () => {
    deleteTemplate.mockResolvedValue(false);
    const res = await request(buildApp()).delete('/api/admin/templates/tpl-1').set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`);
    expect(res.status).toBe(404);
  });
});

describe('POST /api/admin/templates/sync', () => {
  test('returns 400 when wabaId is missing', async () => {
    const res = await request(buildApp()).post('/api/admin/templates/sync').set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`).send({});
    expect(res.status).toBe(400);
  });

  test('returns the refreshed template list', async () => {
    syncTemplatesForWaba.mockResolvedValue([{ id: 'tpl-1', status: 'APPROVED' }]);
    const res = await request(buildApp())
      .post('/api/admin/templates/sync')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send({ wabaId: 'waba-1' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 'tpl-1', status: 'APPROVED' }]);
  });

  test('returns 400 for a TemplateValidationError', async () => {
    syncTemplatesForWaba.mockRejectedValue(new TemplateValidationError('No channel found for this WABA'));
    const res = await request(buildApp())
      .post('/api/admin/templates/sync')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send({ wabaId: 'waba-1' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/admin/templates/register-existing', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns 400 when channelId, name or language is missing', async () => {
    const res = await request(buildApp())
      .post('/api/admin/templates/register-existing')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ channelId: 'ch-1', name: 'aviso_cobranca' });
    expect(res.status).toBe(400);
    expect(registerExistingTemplate).not.toHaveBeenCalled();
  });

  test('registers the template and returns 201', async () => {
    registerExistingTemplate.mockResolvedValue({ id: 'tpl-1', name: 'aviso_cobranca', headerType: 'document' });

    const res = await request(buildApp())
      .post('/api/admin/templates/register-existing')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ channelId: 'ch-1', name: 'aviso_cobranca', language: 'pt_BR', headerType: 'document' });

    expect(registerExistingTemplate).toHaveBeenCalledWith({ channelId: 'ch-1', name: 'aviso_cobranca', language: 'pt_BR', headerType: 'document' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: 'tpl-1', name: 'aviso_cobranca', headerType: 'document' });
  });

  test('returns 400 for a TemplateValidationError', async () => {
    registerExistingTemplate.mockRejectedValue(new TemplateValidationError('No template found'));

    const res = await request(buildApp())
      .post('/api/admin/templates/register-existing')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ channelId: 'ch-1', name: 'aviso_cobranca', language: 'pt_BR' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('No template found');
  });

  test('returns 409 on a duplicate (wabaId, name, language) unique violation', async () => {
    registerExistingTemplate.mockRejectedValue(Object.assign(new Error('duplicate'), { code: '23505' }));

    const res = await request(buildApp())
      .post('/api/admin/templates/register-existing')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ channelId: 'ch-1', name: 'aviso_cobranca', language: 'pt_BR' });

    expect(res.status).toBe(409);
  });

  test('returns 403 for a non-admin agent', async () => {
    const res = await request(buildApp())
      .post('/api/admin/templates/register-existing')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ channelId: 'ch-1', name: 'aviso_cobranca', language: 'pt_BR' });
    expect(res.status).toBe(403);
    expect(registerExistingTemplate).not.toHaveBeenCalled();
  });
});

// A finalidade separa o que o atendente ve do que e usado em disparo pelo SGP.
// Ela e escolhida na criacao e pode ser trocada depois: os templates ja
// existentes nasceram todos como atendimento na migracao.
describe('finalidade do template', () => {
  beforeEach(() => jest.clearAllMocks());

  function comoAdmin(req) {
    return req.set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`);
  }

  test('cria um template ja marcado como disparo', async () => {
    createTemplate.mockResolvedValue({ id: 'tpl-1', purpose: 'disparo' });

    const res = await comoAdmin(request(buildApp()).post('/api/admin/templates')).send({
      channelId: 'ch-1', name: 'cobranca_sgp', category: 'UTILITY', language: 'pt_BR', bodyText: 'Oi {{1}}', purpose: 'disparo',
    });

    expect(res.status).toBe(201);
    expect(createTemplate).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'disparo' }));
  });

  test('sem finalidade, cria como atendimento', async () => {
    createTemplate.mockResolvedValue({ id: 'tpl-1', purpose: 'atendimento' });

    await comoAdmin(request(buildApp()).post('/api/admin/templates')).send({
      channelId: 'ch-1', name: 'saudacao', category: 'UTILITY', language: 'pt_BR', bodyText: 'Oi',
    });

    expect(createTemplate).toHaveBeenCalledWith(expect.objectContaining({ purpose: undefined }));
  });

  test('recusa uma finalidade desconhecida na criacao', async () => {
    const res = await comoAdmin(request(buildApp()).post('/api/admin/templates')).send({
      channelId: 'ch-1', name: 'x', category: 'UTILITY', language: 'pt_BR', bodyText: 'Oi', purpose: 'qualquer',
    });

    expect(res.status).toBe(400);
    expect(createTemplate).not.toHaveBeenCalled();
  });

  test('troca a finalidade de um template que ja existe', async () => {
    updateTemplatePurpose.mockResolvedValue({ id: 'tpl-1', purpose: 'disparo' });

    const res = await comoAdmin(request(buildApp()).patch('/api/admin/templates/tpl-1')).send({ purpose: 'disparo' });

    expect(res.status).toBe(200);
    expect(updateTemplatePurpose).toHaveBeenCalledWith('tpl-1', 'disparo');
    expect(res.body.purpose).toBe('disparo');
  });

  test('404 ao trocar a finalidade de um template que nao existe', async () => {
    updateTemplatePurpose.mockResolvedValue(null);

    const res = await comoAdmin(request(buildApp()).patch('/api/admin/templates/sumido')).send({ purpose: 'disparo' });

    expect(res.status).toBe(404);
  });

  test('recusa trocar para uma finalidade desconhecida', async () => {
    const res = await comoAdmin(request(buildApp()).patch('/api/admin/templates/tpl-1')).send({ purpose: 'qualquer' });

    expect(res.status).toBe(400);
    expect(updateTemplatePurpose).not.toHaveBeenCalled();
  });

  test('403 para quem nao e admin', async () => {
    const res = await request(buildApp())
      .patch('/api/admin/templates/tpl-1')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ purpose: 'disparo' });

    expect(res.status).toBe(403);
    expect(updateTemplatePurpose).not.toHaveBeenCalled();
  });
});

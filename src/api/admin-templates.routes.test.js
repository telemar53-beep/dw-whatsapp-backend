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
const { listTemplates } = require('../templates/template.repository');
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
    expect(res.body.error).toBe('Invalid parameter');
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

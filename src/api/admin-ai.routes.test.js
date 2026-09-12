jest.mock('../ai/ai-config.repository');
jest.mock('../ai/openai-client');

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { getAiConfig, updateAiConfig, listToolPermissions, setToolPermission } = require('../ai/ai-config.repository');
const { listModels, OpenAiAuthError } = require('../ai/openai-client');
const adminAiRoutes = require('./admin-ai.routes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/ai', adminAiRoutes);
  return app;
}
function tokenFor(role) {
  return jwt.sign({ agentId: 'a-1', role }, process.env.JWT_SECRET);
}

beforeEach(() => {
  jest.clearAllMocks();
  getAiConfig.mockResolvedValue({
    id: 1, apiKey: 'sk-1234567890abcd', model: 'gpt-x', mode: 'assistant',
    systemPrompt: 'p', maxToolsPerInteraction: 8,
  });
  listToolPermissions.mockResolvedValue([{ toolName: 'consultar_plano', enabled: true }]);
});

describe('admin ai routes', () => {
  test('GET /config requires a token', async () => {
    await request(buildApp()).get('/api/admin/ai/config').expect(401);
  });

  test('GET /config requires the admin role', async () => {
    await request(buildApp()).get('/api/admin/ai/config')
      .set('Authorization', `Bearer ${tokenFor('agent')}`).expect(403);
  });

  test('GET /config never returns the full key', async () => {
    const res = await request(buildApp()).get('/api/admin/ai/config')
      .set('Authorization', `Bearer ${tokenFor('admin')}`).expect(200);
    expect(res.body.apiKeyLast4).toBe('abcd');
    expect(JSON.stringify(res.body)).not.toContain('sk-1234567890abcd');
    expect(res.body.configured).toBe(true);
  });

  test('GET /config reports not configured when there is no key', async () => {
    getAiConfig.mockResolvedValue({ id: 1, apiKey: null, model: '', mode: 'disabled', systemPrompt: 'p', maxToolsPerInteraction: 8 });
    const res = await request(buildApp()).get('/api/admin/ai/config')
      .set('Authorization', `Bearer ${tokenFor('admin')}`).expect(200);
    expect(res.body.configured).toBe(false);
    expect(res.body.apiKeyLast4).toBeNull();
  });

  test('PUT /config rejects an unknown mode', async () => {
    await request(buildApp()).put('/api/admin/ai/config')
      .set('Authorization', `Bearer ${tokenFor('admin')}`)
      .send({ model: 'gpt-x', mode: 'turbo' })
      .expect(400);
  });

  test('PUT /config saves and keeps the key when apiKey is omitted', async () => {
    updateAiConfig.mockResolvedValue({ id: 1, apiKey: 'sk-1234567890abcd', model: 'gpt-y', mode: 'automatic', systemPrompt: 'p', maxToolsPerInteraction: 8 });
    const res = await request(buildApp()).put('/api/admin/ai/config')
      .set('Authorization', `Bearer ${tokenFor('admin')}`)
      .send({ model: 'gpt-y', mode: 'automatic' })
      .expect(200);
    expect(updateAiConfig).toHaveBeenCalledWith(expect.objectContaining({ apiKey: null, model: 'gpt-y', mode: 'automatic' }));
    expect(res.body.apiKeyLast4).toBe('abcd');
    expect(JSON.stringify(res.body)).not.toContain('sk-1234567890abcd');
  });

  test('PUT /config requires apiKey on first save when mode is not disabled', async () => {
    getAiConfig.mockResolvedValue({ id: 1, apiKey: null, model: '', mode: 'disabled', systemPrompt: 'p', maxToolsPerInteraction: 8 });
    const res = await request(buildApp()).put('/api/admin/ai/config')
      .set('Authorization', `Bearer ${tokenFor('admin')}`)
      .send({ model: 'gpt-x', mode: 'assistant' })
      .expect(400);
    expect(res.body.error).toBe('apiKey is required');
    expect(updateAiConfig).not.toHaveBeenCalled();
  });

  test('PUT /config allows saving disabled mode without a key', async () => {
    getAiConfig.mockResolvedValue({ id: 1, apiKey: null, model: '', mode: 'disabled', systemPrompt: 'p', maxToolsPerInteraction: 8 });
    updateAiConfig.mockResolvedValue({ id: 1, apiKey: null, model: 'gpt-x', mode: 'disabled', systemPrompt: 'p', maxToolsPerInteraction: 8 });
    const res = await request(buildApp()).put('/api/admin/ai/config')
      .set('Authorization', `Bearer ${tokenFor('admin')}`)
      .send({ model: 'gpt-x', mode: 'disabled' })
      .expect(200);
    expect(updateAiConfig).toHaveBeenCalled();
    expect(res.body.configured).toBe(false);
  });

  test('PUT /config allows saving with apiKey on first configuration', async () => {
    getAiConfig.mockResolvedValue({ id: 1, apiKey: null, model: '', mode: 'disabled', systemPrompt: 'p', maxToolsPerInteraction: 8 });
    updateAiConfig.mockResolvedValue({ id: 1, apiKey: 'sk-newapikey1234', model: 'gpt-x', mode: 'assistant', systemPrompt: 'p', maxToolsPerInteraction: 8 });
    const res = await request(buildApp()).put('/api/admin/ai/config')
      .set('Authorization', `Bearer ${tokenFor('admin')}`)
      .send({ apiKey: 'sk-newapikey1234', model: 'gpt-x', mode: 'assistant' })
      .expect(200);
    expect(updateAiConfig).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'sk-newapikey1234', model: 'gpt-x', mode: 'assistant' }));
    expect(res.body.configured).toBe(true);
    expect(res.body.apiKeyLast4).toBe('1234');
    expect(JSON.stringify(res.body)).not.toContain('sk-newapikey1234');
  });

  test('POST /test-connection returns the available models', async () => {
    listModels.mockResolvedValue(['gpt-a', 'gpt-b']);
    const res = await request(buildApp()).post('/api/admin/ai/test-connection')
      .set('Authorization', `Bearer ${tokenFor('admin')}`).send({}).expect(200);
    expect(res.body).toEqual({ ok: true, models: ['gpt-a', 'gpt-b'] });
  });

  test('POST /test-connection reports a bad key without throwing', async () => {
    listModels.mockRejectedValue(new OpenAiAuthError('bad key'));
    const res = await request(buildApp()).post('/api/admin/ai/test-connection')
      .set('Authorization', `Bearer ${tokenFor('admin')}`).send({}).expect(200);
    expect(res.body.ok).toBe(false);
  });

  test('GET /tools merges the registry with the stored permissions', async () => {
    const res = await request(buildApp()).get('/api/admin/ai/tools')
      .set('Authorization', `Bearer ${tokenFor('admin')}`).expect(200);
    const plano = res.body.find((t) => t.nome === 'consultar_plano');
    expect(plano.enabled).toBe(true);
    expect(plano.categoria).toBe('CONSULTA');
    const pix = res.body.find((t) => t.nome === 'gerar_pix');
    expect(pix.enabled).toBe(false);
  });

  test('PUT /tools/:nome rejects a tool that is not in the registry', async () => {
    await request(buildApp()).put('/api/admin/ai/tools/consultar_ip')
      .set('Authorization', `Bearer ${tokenFor('admin')}`)
      .send({ enabled: true }).expect(404);
  });

  test('PUT /tools/:nome saves a known tool', async () => {
    setToolPermission.mockResolvedValue({ toolName: 'consultar_plano', enabled: false });
    await request(buildApp()).put('/api/admin/ai/tools/consultar_plano')
      .set('Authorization', `Bearer ${tokenFor('admin')}`)
      .send({ enabled: false }).expect(200);
    expect(setToolPermission).toHaveBeenCalledWith('consultar_plano', false);
  });
});

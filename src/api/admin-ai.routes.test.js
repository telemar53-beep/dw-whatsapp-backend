jest.mock('../ai/ai-config.repository');
jest.mock('../ai/openai-client');
jest.mock('../reasons/reason.repository');

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { getAiConfig, updateAiConfig, updateTranscriptionConfig, updateTriageConfig, listToolPermissions, setToolPermission } = require('../ai/ai-config.repository');
const { listModels, OpenAiAuthError } = require('../ai/openai-client');
const { findReasonById } = require('../reasons/reason.repository');
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
  findReasonById.mockResolvedValue({ id: MOTIVO_ID, name: 'Resolvido pela IA', active: true });
});

const MOTIVO_ID = '11111111-2222-3333-4444-555555555555';

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
    updateAiConfig.mockResolvedValue({ id: 1, apiKey: 'sk-1234567890abcd', model: 'gpt-y', mode: 'assistant', systemPrompt: 'p', maxToolsPerInteraction: 8 });
    const res = await request(buildApp()).put('/api/admin/ai/config')
      .set('Authorization', `Bearer ${tokenFor('admin')}`)
      .send({ model: 'gpt-y', mode: 'assistant' })
      .expect(200);
    expect(updateAiConfig).toHaveBeenCalledWith(expect.objectContaining({ apiKey: null, model: 'gpt-y', mode: 'assistant' }));
    expect(res.body.apiKeyLast4).toBe('abcd');
    expect(JSON.stringify(res.body)).not.toContain('sk-1234567890abcd');
  });

  // Phase 1 does not include automatic mode: the worker runs the whole turn (OpenAI
  // tokens, SGP calls, side-effecting tools) and then discards the text, sending
  // nothing and creating no suggestion — the customer gets nothing, the admin sees
  // no error, and the bill grows. Blocked here at the API boundary; the CHECK
  // constraint and the worker's automatic branch are left alone for Phase 2.
  test('PUT /config rejects automatic mode with a clear, not-yet-available message', async () => {
    updateAiConfig.mockResolvedValue({ id: 1, apiKey: 'sk-1234567890abcd', model: 'gpt-x', mode: 'automatic', systemPrompt: 'p', maxToolsPerInteraction: 8 });
    const res = await request(buildApp()).put('/api/admin/ai/config')
      .set('Authorization', `Bearer ${tokenFor('admin')}`)
      .send({ model: 'gpt-x', mode: 'automatic' })
      .expect(400);
    expect(res.body.error).toMatch(/not available/i);
    expect(updateAiConfig).not.toHaveBeenCalled();
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

  test('GET /config devolve os campos de transcrição', async () => {
    getAiConfig.mockResolvedValue({
      id: 1, apiKey: 'sk-1234567890abcd', model: 'gpt-x', mode: 'assistant',
      systemPrompt: 'p', maxToolsPerInteraction: 8,
      transcriptionEnabled: true, transcriptionModel: 'modelo-t',
      transcriptionMaxSeconds: 300, transcriptionMaxBytes: 26214400,
      transcriptionPrompt: 'PPPoE', transcriptionFeedAi: true,
    });
    const res = await request(buildApp()).get('/api/admin/ai/config')
      .set('Authorization', `Bearer ${tokenFor('admin')}`).expect(200);
    expect(res.body.transcriptionEnabled).toBe(true);
    expect(res.body.transcriptionModel).toBe('modelo-t');
    expect(JSON.stringify(res.body)).not.toContain('sk-1234567890abcd');
  });

  test('PUT /transcription exige admin', async () => {
    await request(buildApp()).put('/api/admin/ai/transcription')
      .set('Authorization', `Bearer ${tokenFor('agent')}`)
      .send({ transcriptionEnabled: false }).expect(403);
  });

  test('PUT /transcription rejeita tipos errados', async () => {
    await request(buildApp()).put('/api/admin/ai/transcription')
      .set('Authorization', `Bearer ${tokenFor('admin')}`)
      .send({ transcriptionEnabled: 'sim', transcriptionModel: 'm', transcriptionMaxSeconds: 60,
              transcriptionMaxBytes: 1000, transcriptionPrompt: '', transcriptionFeedAi: true })
      .expect(400);
    expect(updateTranscriptionConfig).not.toHaveBeenCalled();
  });

  test('PUT /transcription exige modelo quando está sendo ligada', async () => {
    await request(buildApp()).put('/api/admin/ai/transcription')
      .set('Authorization', `Bearer ${tokenFor('admin')}`)
      .send({ transcriptionEnabled: true, transcriptionModel: '', transcriptionMaxSeconds: 60,
              transcriptionMaxBytes: 1000, transcriptionPrompt: '', transcriptionFeedAi: true })
      .expect(400);
  });

  test('PUT /transcription salva', async () => {
    updateTranscriptionConfig.mockResolvedValue({
      transcriptionEnabled: true, transcriptionModel: 'm', transcriptionMaxSeconds: 60,
      transcriptionMaxBytes: 1000, transcriptionPrompt: 'PPPoE', transcriptionFeedAi: true,
    });
    const res = await request(buildApp()).put('/api/admin/ai/transcription')
      .set('Authorization', `Bearer ${tokenFor('admin')}`)
      .send({ transcriptionEnabled: true, transcriptionModel: 'm', transcriptionMaxSeconds: 60,
              transcriptionMaxBytes: 1000, transcriptionPrompt: 'PPPoE', transcriptionFeedAi: true })
      .expect(200);
    expect(res.body.transcriptionModel).toBe('m');
  });

  test('PUT /triage valida e salva', async () => {
    updateTriageConfig.mockResolvedValue({ triageConfidenceThreshold: 0.9, triageMaxQuestions: 3, triageTimeoutMinutes: 5, triageExtraInstructions: 'x' });
    const res = await request(buildApp()).put('/api/admin/ai/triage').set('Authorization', `Bearer ${tokenFor('admin')}`)
      .send({ triageConfidenceThreshold: 0.9, triageMaxQuestions: 3, triageTimeoutMinutes: 5, triageExtraInstructions: 'x' }).expect(200);
    expect(res.body.triageMaxQuestions).toBe(3);
    await request(buildApp()).put('/api/admin/ai/triage').set('Authorization', `Bearer ${tokenFor('admin')}`)
      .send({ triageConfidenceThreshold: 1.5, triageMaxQuestions: 3, triageTimeoutMinutes: 5, triageExtraInstructions: '' }).expect(400);
    await request(buildApp()).put('/api/admin/ai/triage').set('Authorization', `Bearer ${tokenFor('agent')}`).send({}).expect(403);
  });

  // I2 (revisão final do branch inteiro): Number(null)/Number('')/Number(false)
  // são todos 0 — sem checar o tipo antes, os três passavam a validação de
  // faixa como se fosse 0% de confiança mínima escolhido de propósito.
  test.each([null, '', false])('PUT /triage rejeita triageConfidenceThreshold = %p', async (valorInvalido) => {
    const res = await request(buildApp()).put('/api/admin/ai/triage').set('Authorization', `Bearer ${tokenFor('admin')}`)
      .send({ triageConfidenceThreshold: valorInvalido, triageMaxQuestions: 3, triageTimeoutMinutes: 5, triageExtraInstructions: '' })
      .expect(400);
    expect(res.body.error).toBe('triageConfidenceThreshold must be a number between 0 and 1');
    expect(updateTriageConfig).not.toHaveBeenCalled();
  });

  test('GET /config devolve o motivo de encerramento pela IA', async () => {
    getAiConfig.mockResolvedValue({
      id: 1, apiKey: 'sk-1234567890abcd', model: 'gpt-x', mode: 'assistant',
      systemPrompt: 'p', maxToolsPerInteraction: 8, triageResolvedReasonId: MOTIVO_ID,
    });
    const res = await request(buildApp()).get('/api/admin/ai/config')
      .set('Authorization', `Bearer ${tokenFor('admin')}`).expect(200);
    expect(res.body.triageResolvedReasonId).toBe(MOTIVO_ID);
  });

  test('PUT /triage aceita null e um motivo ativo em triageResolvedReasonId', async () => {
    updateTriageConfig.mockResolvedValue({ triageConfidenceThreshold: 0.9, triageMaxQuestions: 3, triageTimeoutMinutes: 5, triageExtraInstructions: 'x', triageResolvedReasonId: null });
    await request(buildApp()).put('/api/admin/ai/triage').set('Authorization', `Bearer ${tokenFor('admin')}`)
      .send({ triageConfidenceThreshold: 0.9, triageMaxQuestions: 3, triageTimeoutMinutes: 5, triageExtraInstructions: 'x' }).expect(200);
    expect(updateTriageConfig).toHaveBeenCalledWith(expect.objectContaining({ triageResolvedReasonId: null }));

    updateTriageConfig.mockResolvedValue({ triageConfidenceThreshold: 0.9, triageMaxQuestions: 3, triageTimeoutMinutes: 5, triageExtraInstructions: 'x', triageResolvedReasonId: MOTIVO_ID });
    const res = await request(buildApp()).put('/api/admin/ai/triage').set('Authorization', `Bearer ${tokenFor('admin')}`)
      .send({ triageConfidenceThreshold: 0.9, triageMaxQuestions: 3, triageTimeoutMinutes: 5, triageExtraInstructions: 'x', triageResolvedReasonId: MOTIVO_ID }).expect(200);
    expect(updateTriageConfig).toHaveBeenCalledWith(expect.objectContaining({ triageResolvedReasonId: MOTIVO_ID }));
    expect(res.body.triageResolvedReasonId).toBe(MOTIVO_ID);
  });

  test('PUT /triage recusa motivo inexistente, inativo ou que não é UUID', async () => {
    const corpo = (triageResolvedReasonId) => ({
      triageConfidenceThreshold: 0.9, triageMaxQuestions: 3, triageTimeoutMinutes: 5,
      triageExtraInstructions: 'x', triageResolvedReasonId,
    });

    const r1 = await request(buildApp()).put('/api/admin/ai/triage')
      .set('Authorization', `Bearer ${tokenFor('admin')}`).send(corpo('nao-e-uuid')).expect(400);
    expect(r1.body.error).toBe('triageResolvedReasonId must be null or an active reason id');

    findReasonById.mockResolvedValue(null);
    await request(buildApp()).put('/api/admin/ai/triage')
      .set('Authorization', `Bearer ${tokenFor('admin')}`).send(corpo(MOTIVO_ID)).expect(400);

    findReasonById.mockResolvedValue({ id: MOTIVO_ID, name: 'Antigo', active: false });
    await request(buildApp()).put('/api/admin/ai/triage')
      .set('Authorization', `Bearer ${tokenFor('admin')}`).send(corpo(MOTIVO_ID)).expect(400);

    expect(updateTriageConfig).not.toHaveBeenCalled();
  });

  describe('janela do atendimento noturno', () => {
    const corpo = (extra) => ({
      triageConfidenceThreshold: 0.9, triageMaxQuestions: 3, triageTimeoutMinutes: 5,
      triageExtraInstructions: 'x', ...extra,
    });

    test('salva a janela e devolve os dois campos', async () => {
      updateTriageConfig.mockResolvedValue({
        triageConfidenceThreshold: 0.9, triageMaxQuestions: 3, triageTimeoutMinutes: 5,
        triageExtraInstructions: 'x', nightStartTime: '20:00', nightEndTime: '08:00',
      });

      const res = await request(buildApp()).put('/api/admin/ai/triage')
        .set('Authorization', `Bearer ${tokenFor('admin')}`)
        .send(corpo({ nightStartTime: '20:00', nightEndTime: '08:00' })).expect(200);

      expect(updateTriageConfig).toHaveBeenCalledWith(
        expect.objectContaining({ nightStartTime: '20:00', nightEndTime: '08:00' })
      );
      expect(res.body.nightStartTime).toBe('20:00');
      expect(res.body.nightEndTime).toBe('08:00');
    });

    test('sem a janela grava nulos nos dois', async () => {
      updateTriageConfig.mockResolvedValue({
        triageConfidenceThreshold: 0.9, triageMaxQuestions: 3, triageTimeoutMinutes: 5,
        triageExtraInstructions: 'x', nightStartTime: null, nightEndTime: null,
      });

      const res = await request(buildApp()).put('/api/admin/ai/triage')
        .set('Authorization', `Bearer ${tokenFor('admin')}`).send(corpo({})).expect(200);

      expect(updateTriageConfig).toHaveBeenCalledWith(
        expect.objectContaining({ nightStartTime: null, nightEndTime: null })
      );
      expect(res.body.nightStartTime).toBeNull();
      expect(res.body.nightEndTime).toBeNull();
    });

    test('recusa hora fora do formato HH:MM', async () => {
      const res = await request(buildApp()).put('/api/admin/ai/triage')
        .set('Authorization', `Bearer ${tokenFor('admin')}`)
        .send(corpo({ nightStartTime: '8h', nightEndTime: '08:00' })).expect(400);
      expect(res.body.error).toBe('nightStartTime and nightEndTime must be HH:MM or empty');
      expect(updateTriageConfig).not.toHaveBeenCalled();
    });

    test('recusa meia janela: só o início ou só o fim', async () => {
      const r1 = await request(buildApp()).put('/api/admin/ai/triage')
        .set('Authorization', `Bearer ${tokenFor('admin')}`)
        .send(corpo({ nightStartTime: '20:00' })).expect(400);
      expect(r1.body.error).toBe('nightStartTime and nightEndTime must be provided together');

      await request(buildApp()).put('/api/admin/ai/triage')
        .set('Authorization', `Bearer ${tokenFor('admin')}`)
        .send(corpo({ nightEndTime: '08:00' })).expect(400);

      expect(updateTriageConfig).not.toHaveBeenCalled();
    });
  });
});

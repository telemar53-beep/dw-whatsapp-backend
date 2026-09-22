jest.mock('../ai/ai-config.repository');
jest.mock('../ai/openai-client');
jest.mock('../reasons/reason.repository');

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { getAiConfig, updateAiConfig, updateTranscriptionConfig, updateTriageConfig, patchTriageConfig, updateAssistantSuggestionsEnabled, listToolPermissions, setToolPermission } = require('../ai/ai-config.repository');
const { listModels, OpenAiAuthError } = require('../ai/openai-client');
const { findReasonById } = require('../reasons/reason.repository');
const adminAiRoutes = require('./admin-ai.routes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/ai', adminAiRoutes);
  return app;
}
function tokenFor(role, canManageIntegrations = false) {
  return jwt.sign({ agentId: 'a-1', role, canManageIntegrations }, process.env.JWT_SECRET);
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

  test('GET /config returns 200 for a manager without canManageIntegrations', async () => {
    await request(buildApp()).get('/api/admin/ai/config')
      .set('Authorization', `Bearer ${tokenFor('manager')}`).expect(200);
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

  test('PUT /config returns 403 for a manager without canManageIntegrations', async () => {
    await request(buildApp()).put('/api/admin/ai/config')
      .set('Authorization', `Bearer ${tokenFor('manager')}`)
      .send({ apiKey: 'sk-newapikey1234', model: 'gpt-x', mode: 'assistant' })
      .expect(403);
    expect(updateAiConfig).not.toHaveBeenCalled();
  });

  test('PUT /config succeeds for a manager with canManageIntegrations', async () => {
    updateAiConfig.mockResolvedValue({ id: 1, apiKey: 'sk-newapikey1234', model: 'gpt-x', mode: 'assistant', systemPrompt: 'p', maxToolsPerInteraction: 8 });
    await request(buildApp()).put('/api/admin/ai/config')
      .set('Authorization', `Bearer ${tokenFor('manager', true)}`)
      .send({ apiKey: 'sk-newapikey1234', model: 'gpt-x', mode: 'assistant' })
      .expect(200);
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

  test('POST /test-connection returns 403 for a manager without canManageIntegrations', async () => {
    await request(buildApp()).post('/api/admin/ai/test-connection')
      .set('Authorization', `Bearer ${tokenFor('manager')}`).send({}).expect(403);
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

  test('GET /tools returns 200 for a manager without canManageIntegrations', async () => {
    await request(buildApp()).get('/api/admin/ai/tools')
      .set('Authorization', `Bearer ${tokenFor('manager')}`).expect(200);
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

  test('PUT /tools/:nome returns 200 for a manager without canManageIntegrations', async () => {
    setToolPermission.mockResolvedValue({ toolName: 'consultar_plano', enabled: false });
    await request(buildApp()).put('/api/admin/ai/tools/consultar_plano')
      .set('Authorization', `Bearer ${tokenFor('manager')}`)
      .send({ enabled: false }).expect(200);
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

  test('PUT /transcription returns 200 for a manager without canManageIntegrations', async () => {
    updateTranscriptionConfig.mockResolvedValue({
      transcriptionEnabled: true, transcriptionModel: 'm', transcriptionMaxSeconds: 60,
      transcriptionMaxBytes: 1000, transcriptionPrompt: 'PPPoE', transcriptionFeedAi: true,
    });
    await request(buildApp()).put('/api/admin/ai/transcription')
      .set('Authorization', `Bearer ${tokenFor('manager')}`)
      .send({ transcriptionEnabled: true, transcriptionModel: 'm', transcriptionMaxSeconds: 60,
              transcriptionMaxBytes: 1000, transcriptionPrompt: 'PPPoE', transcriptionFeedAi: true })
      .expect(200);
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

  test('PUT /triage returns 200 for a manager without canManageIntegrations', async () => {
    updateTriageConfig.mockResolvedValue({ triageConfidenceThreshold: 0.9, triageMaxQuestions: 3, triageTimeoutMinutes: 5, triageExtraInstructions: 'x' });
    await request(buildApp()).put('/api/admin/ai/triage').set('Authorization', `Bearer ${tokenFor('manager')}`)
      .send({ triageConfidenceThreshold: 0.9, triageMaxQuestions: 3, triageTimeoutMinutes: 5, triageExtraInstructions: 'x' }).expect(200);
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

  test('PUT /triage grava triageReadReceiptsDaytime e trata ausente como desligado', async () => {
    updateTriageConfig.mockResolvedValue({
      triageConfidenceThreshold: 0.9, triageMaxQuestions: 3, triageTimeoutMinutes: 5,
      triageExtraInstructions: 'x', triageReadReceiptsDaytime: true,
    });
    const res = await request(buildApp()).put('/api/admin/ai/triage').set('Authorization', `Bearer ${tokenFor('admin')}`)
      .send({
        triageConfidenceThreshold: 0.9, triageMaxQuestions: 3, triageTimeoutMinutes: 5,
        triageExtraInstructions: 'x', triageReadReceiptsDaytime: true,
      }).expect(200);
    expect(updateTriageConfig).toHaveBeenCalledWith(expect.objectContaining({ triageReadReceiptsDaytime: true }));
    expect(res.body.triageReadReceiptsDaytime).toBe(true);

    // Ausente e' desligado: um payload sem o campo nao pode ligar a leitura
    // de dia sem querer — cada leitura e' uma chamada de visao paga.
    updateTriageConfig.mockResolvedValue({
      triageConfidenceThreshold: 0.9, triageMaxQuestions: 3, triageTimeoutMinutes: 5,
      triageExtraInstructions: 'x', triageReadReceiptsDaytime: false,
    });
    const semCampo = await request(buildApp()).put('/api/admin/ai/triage').set('Authorization', `Bearer ${tokenFor('admin')}`)
      .send({ triageConfidenceThreshold: 0.9, triageMaxQuestions: 3, triageTimeoutMinutes: 5, triageExtraInstructions: 'x' }).expect(200);
    expect(updateTriageConfig).toHaveBeenLastCalledWith(expect.objectContaining({ triageReadReceiptsDaytime: false }));
    expect(semCampo.body.triageReadReceiptsDaytime).toBe(false);
  });

  test('PUT /triage recusa triageReadReceiptsDaytime que nao e booleano', async () => {
    const res = await request(buildApp()).put('/api/admin/ai/triage').set('Authorization', `Bearer ${tokenFor('admin')}`)
      .send({
        triageConfidenceThreshold: 0.9, triageMaxQuestions: 3, triageTimeoutMinutes: 5,
        triageExtraInstructions: 'x', triageReadReceiptsDaytime: 'sim',
      }).expect(400);
    expect(res.body.error).toBe('triageReadReceiptsDaytime must be a boolean');
    expect(updateTriageConfig).not.toHaveBeenCalled();
  });

  test('GET /config devolve triageReadReceiptsDaytime', async () => {
    getAiConfig.mockResolvedValue({
      id: 1, apiKey: 'sk-1234567890abcd', model: 'gpt-x', mode: 'assistant',
      systemPrompt: 'p', maxToolsPerInteraction: 8, triageReadReceiptsDaytime: true,
    });
    const res = await request(buildApp()).get('/api/admin/ai/config')
      .set('Authorization', `Bearer ${tokenFor('admin')}`).expect(200);
    expect(res.body.triageReadReceiptsDaytime).toBe(true);
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

// A chave e separada do `mode`: desligar a IA pelo modo levaria junto a triagem
// e a transcricao de audio, que continuam desejadas.
describe('PUT /api/admin/ai/assistant-suggestions', () => {
  beforeEach(() => jest.clearAllMocks());

  function chamar(body, role = 'admin') {
    return request(buildApp())
      .put('/api/admin/ai/assistant-suggestions')
      .set('Authorization', `Bearer ${tokenFor(role, true)}`)
      .send(body);
  }

  test('liga a sugestao para o atendente', async () => {
    updateAssistantSuggestionsEnabled.mockResolvedValue({ mode: 'assistant', assistantSuggestionsEnabled: true });

    const res = await chamar({ enabled: true });

    expect(res.status).toBe(200);
    expect(updateAssistantSuggestionsEnabled).toHaveBeenCalledWith(true);
    expect(res.body.assistantSuggestionsEnabled).toBe(true);
  });

  test('desliga a sugestao', async () => {
    updateAssistantSuggestionsEnabled.mockResolvedValue({ mode: 'assistant', assistantSuggestionsEnabled: false });

    await chamar({ enabled: false });

    expect(updateAssistantSuggestionsEnabled).toHaveBeenCalledWith(false);
  });

  test('recusa um valor que nao e booleano', async () => {
    const res = await chamar({ enabled: 'sim' });

    expect(res.status).toBe(400);
    expect(updateAssistantSuggestionsEnabled).not.toHaveBeenCalled();
  });

  test('403 para quem nao gerencia integracoes', async () => {
    const res = await request(buildApp())
      .put('/api/admin/ai/assistant-suggestions')
      .set('Authorization', `Bearer ${tokenFor('agent')}`)
      .send({ enabled: true });

    expect(res.status).toBe(403);
    expect(updateAssistantSuggestionsEnabled).not.toHaveBeenCalled();
  });
});

// PATCH /triage — update parcial (ADR-011). O PUT continua existindo e com o
// mesmo contrato: o painel de hoje manda as oito colunas por decisão
// explícita, e três telas compartilham essa linha.
describe('PATCH /api/admin/ai/triage', () => {
  const CONFIG_GRAVADA = {
    id: 1, apiKey: 'sk-1234567890abcd', model: 'gpt-x', mode: 'assistant', systemPrompt: 'PROMPT ORIGINAL',
    triageConfidenceThreshold: 0.8, triageMaxQuestions: 2, triageTimeoutMinutes: 3,
    triageExtraInstructions: 'instrucoes originais', triageResolvedReasonId: null,
    nightStartTime: '20:00', nightEndTime: '08:00', triageReadReceiptsDaytime: true,
  };

  beforeEach(() => {
    getAiConfig.mockResolvedValue(CONFIG_GRAVADA);
    patchTriageConfig.mockImplementation(async (mudancas) => ({ ...CONFIG_GRAVADA, ...mudancas }));
  });

  function enviar(corpo, role) {
    return request(buildApp())
      .patch('/api/admin/ai/triage')
      .set('Authorization', 'Bearer ' + tokenFor(role || 'admin'))
      .send(corpo);
  }

  test('altera somente um campo, e so ele chega ao repositorio', async () => {
    const res = await enviar({ triageMaxQuestions: 5 });

    expect(res.status).toBe(200);
    expect(patchTriageConfig).toHaveBeenCalledWith({ triageMaxQuestions: 5 });
  });

  // Se `false`, `0` e `''` fossem confundidos com ausente, seria impossivel
  // desligar, zerar ou limpar qualquer um desses campos.
  test('false chega como false', async () => {
    await enviar({ triageReadReceiptsDaytime: false });
    expect(patchTriageConfig).toHaveBeenCalledWith({ triageReadReceiptsDaytime: false });
  });

  test('0 chega como zero', async () => {
    await enviar({ triageMaxQuestions: 0 });
    expect(patchTriageConfig).toHaveBeenCalledWith({ triageMaxQuestions: 0 });
  });

  test('string vazia chega como string vazia', async () => {
    await enviar({ triageExtraInstructions: '' });
    expect(patchTriageConfig).toHaveBeenCalledWith({ triageExtraInstructions: '' });
  });

  test('campo omitido nao aparece no objeto entregue ao repositorio', async () => {
    await enviar({ triageMaxQuestions: 4 });

    const mudancas = patchTriageConfig.mock.calls[0][0];
    expect(Object.keys(mudancas)).toEqual(['triageMaxQuestions']);
    expect('nightStartTime' in mudancas).toBe(false);
    expect('triageExtraInstructions' in mudancas).toBe(false);
    expect('triageResolvedReasonId' in mudancas).toBe(false);
  });

  // A whitelist recusa em vez de ignorar em silencio: quem mandar systemPrompt
  // por aqui precisa saber que nao foi gravado.
  test('recusa campo fora da whitelist', async () => {
    for (const corpo of [
      { systemPrompt: 'invadido' },
      { model: 'outro' },
      { mode: 'automatic' },
      { apiKey: 'sk-invadida' },
      { transcriptionEnabled: false },
      { maxToolsPerInteraction: 99 },
      { triageMaxQuestions: 3, systemPrompt: 'junto com um valido' },
    ]) {
      const res = await enviar(corpo);
      expect(res.status).toBe(400);
      expect(patchTriageConfig).not.toHaveBeenCalled();
    }
  });

  test('valida com as mesmas regras do PUT', async () => {
    expect((await enviar({ triageMaxQuestions: 9 })).status).toBe(400);
    expect((await enviar({ triageMaxQuestions: 1.5 })).status).toBe(400);
    expect((await enviar({ triageTimeoutMinutes: 0 })).status).toBe(400);
    expect((await enviar({ triageConfidenceThreshold: 2 })).status).toBe(400);
    expect((await enviar({ triageConfidenceThreshold: null })).status).toBe(400);
    expect((await enviar({ triageExtraInstructions: 42 })).status).toBe(400);
    expect((await enviar({ triageReadReceiptsDaytime: 'sim' })).status).toBe(400);
    expect((await enviar({ nightStartTime: '25:00' })).status).toBe(400);
    expect(patchTriageConfig).not.toHaveBeenCalled();
  });

  // Risco que so o PATCH cria: mandar meia janela deixaria a outra metade
  // como esta. A regra e conferida contra o estado final, nao contra o corpo.
  test('meia janela e recusada olhando o que ja esta gravado', async () => {
    getAiConfig.mockResolvedValue({ ...CONFIG_GRAVADA, nightStartTime: null, nightEndTime: null });

    const res = await enviar({ nightStartTime: '22:00' });

    expect(res.status).toBe(400);
    expect(patchTriageConfig).not.toHaveBeenCalled();
  });

  test('completar a janela que falta e aceito', async () => {
    getAiConfig.mockResolvedValue({ ...CONFIG_GRAVADA, nightStartTime: '20:00', nightEndTime: null });

    const res = await enviar({ nightEndTime: '06:00' });

    expect(res.status).toBe(200);
    expect(patchTriageConfig).toHaveBeenCalledWith({ nightEndTime: '06:00' });
  });

  test('desligar so o comeco da janela, com o fim ja gravado, e recusado', async () => {
    const res = await enviar({ nightStartTime: null });

    expect(res.status).toBe(400);
    expect(patchTriageConfig).not.toHaveBeenCalled();
  });

  test('desligar a janela inteira e aceito', async () => {
    const res = await enviar({ nightStartTime: '', nightEndTime: '' });

    expect(res.status).toBe(200);
    expect(patchTriageConfig).toHaveBeenCalledWith({ nightStartTime: null, nightEndTime: null });
  });

  test('motivo inexistente ou inativo e recusado, como no PUT', async () => {
    findReasonById.mockResolvedValue(null);
    expect((await enviar({ triageResolvedReasonId: MOTIVO_ID })).status).toBe(400);

    findReasonById.mockResolvedValue({ id: MOTIVO_ID, name: 'x', active: false });
    expect((await enviar({ triageResolvedReasonId: MOTIVO_ID })).status).toBe(400);

    expect((await enviar({ triageResolvedReasonId: 'nao-e-uuid' })).status).toBe(400);
    expect(patchTriageConfig).not.toHaveBeenCalled();
  });

  test('desligar o encerramento pela IA sem mexer no resto', async () => {
    const res = await enviar({ triageResolvedReasonId: null });

    expect(res.status).toBe(200);
    expect(patchTriageConfig).toHaveBeenCalledWith({ triageResolvedReasonId: null });
  });

  test('corpo vazio e aceito e nao muda nada', async () => {
    const res = await enviar({});

    expect(res.status).toBe(200);
    expect(patchTriageConfig).toHaveBeenCalledWith({});
  });

  test('exige admin, como o PUT', async () => {
    expect((await enviar({ triageMaxQuestions: 1 }, 'agent')).status).toBe(403);
    expect((await request(buildApp()).patch('/api/admin/ai/triage').send({})).status).toBe(401);
    expect(patchTriageConfig).not.toHaveBeenCalled();
  });

  // O PUT nao pode ter sido tocado: e o que as tres telas usam hoje.
  test('o PUT continua com o contrato de sempre', async () => {
    updateTriageConfig.mockResolvedValue(CONFIG_GRAVADA);

    const res = await request(buildApp())
      .put('/api/admin/ai/triage')
      .set('Authorization', 'Bearer ' + tokenFor('admin'))
      .send({
        triageConfidenceThreshold: 0.9, triageMaxQuestions: 3, triageTimeoutMinutes: 5,
        triageExtraInstructions: 'x', nightStartTime: '21:00', nightEndTime: '07:00',
        triageReadReceiptsDaytime: true,
      });

    expect(res.status).toBe(200);
    expect(updateTriageConfig).toHaveBeenCalledWith(expect.objectContaining({
      triageConfidenceThreshold: 0.9, triageMaxQuestions: 3, triageTimeoutMinutes: 5,
    }));
    expect(patchTriageConfig).not.toHaveBeenCalled();
  });
});

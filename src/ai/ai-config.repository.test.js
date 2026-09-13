const { getPool, closePool } = require('../db/pool');
const {
  getAiConfig, updateAiConfig, updateTranscriptionConfig, updateTriageConfig, listToolPermissions, setToolPermission, isToolEnabled,
} = require('./ai-config.repository');

describe('ai config repository', () => {
  beforeEach(async () => {
    await getPool().query('TRUNCATE ai_tool_permissions');
    await getPool().query("UPDATE ai_config SET api_key = NULL, model = '', mode = 'disabled' WHERE id = 1");
    await getPool().query(
      "UPDATE ai_config SET transcription_enabled = false, transcription_model = '', " +
      'transcription_max_seconds = 300, transcription_max_bytes = 26214400, ' +
      'transcription_feed_ai = true WHERE id = 1'
    );
    await getPool().query(
      "UPDATE ai_config SET triage_confidence_threshold = 0.800, triage_max_questions = 2, " +
      "triage_timeout_minutes = 3, triage_extra_instructions = '', triage_resolved_reason_id = NULL, " +
      'night_start_time = NULL, night_end_time = NULL WHERE id = 1'
    );
  });

  afterAll(async () => { await closePool(); });

  test('getAiConfig returns the seeded singleton row', async () => {
    const config = await getAiConfig();
    expect(config.id).toBe(1);
    expect(config.mode).toBe('disabled');
    expect(config.apiKey).toBeNull();
    expect(config.systemPrompt).toContain('DW Telecom');
    expect(config.maxToolsPerInteraction).toBe(8);
  });

  test('updateAiConfig stores the key and the mode', async () => {
    const updated = await updateAiConfig({ apiKey: 'sk-abc', model: 'gpt-x', mode: 'assistant' });
    expect(updated.apiKey).toBe('sk-abc');
    expect(updated.model).toBe('gpt-x');
    expect(updated.mode).toBe('assistant');
  });

  test('updateAiConfig keeps the stored key when apiKey is omitted', async () => {
    await updateAiConfig({ apiKey: 'sk-original', model: 'gpt-x', mode: 'assistant' });
    const updated = await updateAiConfig({ apiKey: null, model: 'gpt-y', mode: 'automatic' });
    expect(updated.apiKey).toBe('sk-original');
    expect(updated.model).toBe('gpt-y');
  });

  test('setToolPermission inserts then updates the same row', async () => {
    await setToolPermission('buscar_cliente', true);
    await setToolPermission('buscar_cliente', false);
    const all = await listToolPermissions();
    expect(all).toEqual([{ toolName: 'buscar_cliente', enabled: false }]);
  });

  test('isToolEnabled defaults to false for an unknown tool', async () => {
    expect(await isToolEnabled('nunca_cadastrada')).toBe(false);
    await setToolPermission('consultar_plano', true);
    expect(await isToolEnabled('consultar_plano')).toBe(true);
  });

  test('getAiConfig devolve os campos de transcrição com os defaults', async () => {
    const config = await getAiConfig();
    expect(config.transcriptionEnabled).toBe(false);
    expect(config.transcriptionMaxSeconds).toBe(300);
    expect(config.transcriptionMaxBytes).toBe(26214400);
    expect(config.transcriptionFeedAi).toBe(true);
    expect(typeof config.transcriptionPrompt).toBe('string');
  });

  test('updateTranscriptionConfig grava e relê', async () => {
    const updated = await updateTranscriptionConfig({
      transcriptionEnabled: true,
      transcriptionModel: 'modelo-transcricao',
      transcriptionMaxSeconds: 120,
      transcriptionMaxBytes: 1048576,
      transcriptionPrompt: 'PPPoE, ONU',
      transcriptionFeedAi: false,
    });
    expect(updated.transcriptionEnabled).toBe(true);
    expect(updated.transcriptionModel).toBe('modelo-transcricao');
    expect(updated.transcriptionFeedAi).toBe(false);

    const relido = await getAiConfig();
    expect(relido.transcriptionMaxSeconds).toBe(120);
    expect(relido.transcriptionPrompt).toBe('PPPoE, ONU');
  });

  test('updateTranscriptionConfig não mexe na configuração de chat', async () => {
    await updateAiConfig({ apiKey: 'sk-chat', model: 'gpt-chat', mode: 'assistant' });
    await updateTranscriptionConfig({
      transcriptionEnabled: true, transcriptionModel: 'm', transcriptionMaxSeconds: 60,
      transcriptionMaxBytes: 1000, transcriptionPrompt: '', transcriptionFeedAi: true,
    });
    const config = await getAiConfig();
    expect(config.apiKey).toBe('sk-chat');
    expect(config.model).toBe('gpt-chat');
    expect(config.mode).toBe('assistant');
  });

  test('getAiConfig devolve os defaults da triagem e updateTriageConfig grava sem tocar o resto', async () => {
    const c = await getAiConfig();
    expect(c.triageConfidenceThreshold).toBeCloseTo(0.8, 3);
    expect(c.triageMaxQuestions).toBe(2);
    expect(c.triageTimeoutMinutes).toBe(3);
    expect(c.triageExtraInstructions).toBe('');
    await updateAiConfig({ apiKey: 'sk-x', model: 'gpt-x', mode: 'assistant' });
    const up = await updateTriageConfig({ triageConfidenceThreshold: 0.9, triageMaxQuestions: 3, triageTimeoutMinutes: 5, triageExtraInstructions: 'Seja breve.' });
    expect(up.triageConfidenceThreshold).toBeCloseTo(0.9, 3);
    expect(up.triageMaxQuestions).toBe(3);
    expect((await getAiConfig()).apiKey).toBe('sk-x');
  });

  test('updateTriageConfig grava e apaga a janela do atendimento noturno', async () => {
    const inicial = await getAiConfig();
    expect(inicial.nightStartTime).toBeNull();
    expect(inicial.nightEndTime).toBeNull();

    const comJanela = await updateTriageConfig({
      triageConfidenceThreshold: 0.8, triageMaxQuestions: 2, triageTimeoutMinutes: 3,
      triageExtraInstructions: '', nightStartTime: '20:00', nightEndTime: '08:00',
    });
    // TIME volta do banco como 'HH:MM:SS'; a janela só entende HH:MM.
    expect(comJanela.nightStartTime).toBe('20:00');
    expect(comJanela.nightEndTime).toBe('08:00');
    const relido = await getAiConfig();
    expect(relido.nightStartTime).toBe('20:00');
    expect(relido.nightEndTime).toBe('08:00');

    const semJanela = await updateTriageConfig({
      triageConfidenceThreshold: 0.8, triageMaxQuestions: 2, triageTimeoutMinutes: 3,
      triageExtraInstructions: '', nightStartTime: null, nightEndTime: null,
    });
    expect(semJanela.nightStartTime).toBeNull();
    expect(semJanela.nightEndTime).toBeNull();
    expect((await getAiConfig()).nightStartTime).toBeNull();
  });

  test('updateTriageConfig grava e apaga o motivo de encerramento pela IA', async () => {
    expect((await getAiConfig()).triageResolvedReasonId).toBeNull();
    const motivo = await getPool().query(
      "INSERT INTO contact_reasons (name) VALUES ('Resolvido pela IA') RETURNING id"
    );
    const motivoId = motivo.rows[0].id;

    const comMotivo = await updateTriageConfig({
      triageConfidenceThreshold: 0.8, triageMaxQuestions: 2, triageTimeoutMinutes: 3,
      triageExtraInstructions: '', triageResolvedReasonId: motivoId,
    });
    expect(comMotivo.triageResolvedReasonId).toBe(motivoId);
    expect((await getAiConfig()).triageResolvedReasonId).toBe(motivoId);

    // null é um valor legítimo (o admin desliga o encerramento pela IA), não
    // um "não mexa": tem de apagar o que estava gravado.
    const semMotivo = await updateTriageConfig({
      triageConfidenceThreshold: 0.8, triageMaxQuestions: 2, triageTimeoutMinutes: 3,
      triageExtraInstructions: '', triageResolvedReasonId: null,
    });
    expect(semMotivo.triageResolvedReasonId).toBeNull();
  });
});

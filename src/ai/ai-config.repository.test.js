const { getPool, closePool } = require('../db/pool');
const {
  getAiConfig, updateAiConfig, updateTranscriptionConfig, listToolPermissions, setToolPermission, isToolEnabled,
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
});

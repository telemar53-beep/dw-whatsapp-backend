const { getPool, closePool } = require('../db/pool');
const {
  getAiConfig, updateAiConfig, updateTranscriptionConfig, updateTriageConfig, patchTriageConfig, listToolPermissions, setToolPermission, isToolEnabled,
  updateAssistantSuggestionsEnabled,
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
      'night_start_time = NULL, night_end_time = NULL, triage_read_receipts_daytime = false WHERE id = 1'
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

  test('triageReadReceiptsDaytime sai desligado e updateTriageConfig liga e desliga', async () => {
    expect((await getAiConfig()).triageReadReceiptsDaytime).toBe(false);

    const lendo = await updateTriageConfig({
      triageConfidenceThreshold: 0.8, triageMaxQuestions: 2, triageTimeoutMinutes: 3,
      triageExtraInstructions: '', triageReadReceiptsDaytime: true,
    });
    expect(lendo.triageReadReceiptsDaytime).toBe(true);
    expect((await getAiConfig()).triageReadReceiptsDaytime).toBe(true);

    const semLer = await updateTriageConfig({
      triageConfidenceThreshold: 0.8, triageMaxQuestions: 2, triageTimeoutMinutes: 3,
      triageExtraInstructions: '', triageReadReceiptsDaytime: false,
    });
    expect(semLer.triageReadReceiptsDaytime).toBe(false);
    expect((await getAiConfig()).triageReadReceiptsDaytime).toBe(false);
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

// A IA sugerindo resposta ao atendente e um comportamento separado da triagem
// e da transcricao. Desligar pelo `mode` levava os tres juntos, entao a chave e
// propria — e nasce desligada, que e o estado pedido.
describe('assistantSuggestionsEnabled', () => {
  // ai_config e uma linha unica (id = 1) compartilhada pela suite inteira, e o
  // jest roda os arquivos em paralelo: sem devolver a coluna ao DEFAULT aqui,
  // este teste lia o valor que outro arquivo tinha acabado de ligar.
  beforeEach(async () => {
    await getPool().query('UPDATE ai_config SET assistant_suggestions_enabled = DEFAULT WHERE id = 1');
  });

  test('o padrao da coluna e desligada', async () => {
    const config = await getAiConfig();
    expect(config.assistantSuggestionsEnabled).toBe(false);
  });

  test('pode ser ligada e desligada', async () => {
    const ligada = await updateAssistantSuggestionsEnabled(true);
    expect(ligada.assistantSuggestionsEnabled).toBe(true);
    expect((await getAiConfig()).assistantSuggestionsEnabled).toBe(true);

    const desligada = await updateAssistantSuggestionsEnabled(false);
    expect(desligada.assistantSuggestionsEnabled).toBe(false);
  });

  test('ligar a sugestao nao mexe no modo nem na transcricao', async () => {
    const antes = await getAiConfig();

    const depois = await updateAssistantSuggestionsEnabled(true);

    expect(depois.mode).toBe(antes.mode);
    expect(depois.transcriptionEnabled).toBe(antes.transcriptionEnabled);
    expect(depois.triageMaxQuestions).toBe(antes.triageMaxQuestions);
  });
});

// ADR-011: campo não enviado permanece inalterado. `updateTriageConfig` grava
// as oito colunas sempre — é o que faz três telas que editam pedaços da mesma
// linha reverterem umas às outras. `patchTriageConfig` só toca no que veio.
describe('patchTriageConfig: update parcial sem reset lateral', () => {
  // ai_config e uma linha singleton que a migration semeia e NINGUEM trunca
  // entre os testes. Sobrescrever o system_prompt aqui sem devolver o valor
  // original deixaria o banco de teste corrompido para as proximas execucoes
  // -- e o teste do seed, que roda antes, passaria a falhar sozinho.
  let linhaOriginal;

  beforeAll(async () => {
    const { rows } = await getPool().query('SELECT * FROM ai_config WHERE id = 1');
    linhaOriginal = rows[0];
  });

  afterAll(async () => {
    await getPool().query(
      `UPDATE ai_config SET
         model = $1, mode = $2, system_prompt = $3, api_key = $4,
         triage_confidence_threshold = $5, triage_max_questions = $6, triage_timeout_minutes = $7,
         triage_extra_instructions = $8, triage_resolved_reason_id = $9,
         night_start_time = $10, night_end_time = $11, triage_read_receipts_daytime = $12,
         transcription_enabled = $13, transcription_model = $14, transcription_prompt = $15
       WHERE id = 1`,
      [
        linhaOriginal.model, linhaOriginal.mode, linhaOriginal.system_prompt, linhaOriginal.api_key,
        linhaOriginal.triage_confidence_threshold, linhaOriginal.triage_max_questions,
        linhaOriginal.triage_timeout_minutes, linhaOriginal.triage_extra_instructions,
        linhaOriginal.triage_resolved_reason_id, linhaOriginal.night_start_time,
        linhaOriginal.night_end_time, linhaOriginal.triage_read_receipts_daytime,
        linhaOriginal.transcription_enabled, linhaOriginal.transcription_model,
        linhaOriginal.transcription_prompt,
      ]
    );
    await closePool();
  });

  beforeEach(async () => {
    await getPool().query(`
      UPDATE ai_config SET
        model = 'gpt-5.4-mini', mode = 'assistant', system_prompt = 'PROMPT ORIGINAL', api_key = 'sk-guardada',
        triage_confidence_threshold = 0.800, triage_max_questions = 2, triage_timeout_minutes = 3,
        triage_extra_instructions = 'instrucoes originais',
        night_start_time = '20:00', night_end_time = '08:00',
        triage_read_receipts_daytime = true,
        transcription_enabled = true, transcription_model = 'whisper-1', transcription_prompt = 'vocabulario'
      WHERE id = 1`);
  });

  test('altera somente um campo e os outros sete ficam intactos', async () => {
    const depois = await patchTriageConfig({ triageMaxQuestions: 5 });

    expect(depois.triageMaxQuestions).toBe(5);
    expect(Number(depois.triageConfidenceThreshold)).toBeCloseTo(0.8, 3);
    expect(depois.triageTimeoutMinutes).toBe(3);
    expect(depois.triageExtraInstructions).toBe('instrucoes originais');
    expect(depois.nightStartTime).toBe('20:00');
    expect(depois.nightEndTime).toBe('08:00');
    expect(depois.triageReadReceiptsDaytime).toBe(true);
  });

  // O ponto exato da ADR-011: false, 0 e "" são VALORES, não ausência.
  test('false grava false', async () => {
    const depois = await patchTriageConfig({ triageReadReceiptsDaytime: false });

    expect(depois.triageReadReceiptsDaytime).toBe(false);
    expect(depois.triageExtraInstructions).toBe('instrucoes originais');
  });

  test('0 grava zero, não vira o default', async () => {
    const depois = await patchTriageConfig({ triageMaxQuestions: 0 });

    expect(depois.triageMaxQuestions).toBe(0);
    expect(Number(depois.triageConfidenceThreshold)).toBeCloseTo(0.8, 3);
  });

  test('string vazia grava vazio, não mantém o texto antigo', async () => {
    const depois = await patchTriageConfig({ triageExtraInstructions: '' });

    expect(depois.triageExtraInstructions).toBe('');
    expect(depois.triageMaxQuestions).toBe(2);
  });

  test('campo omitido não muda: mexer na janela não zera a triagem', async () => {
    const depois = await patchTriageConfig({ nightStartTime: '22:00', nightEndTime: '06:00' });

    expect(depois.nightStartTime).toBe('22:00');
    expect(depois.nightEndTime).toBe('06:00');
    expect(depois.triageMaxQuestions).toBe(2);
    expect(depois.triageTimeoutMinutes).toBe(3);
    expect(depois.triageExtraInstructions).toBe('instrucoes originais');
    expect(depois.triageReadReceiptsDaytime).toBe(true);
  });

  // O inverso, que era o vetor real: salvar a Triagem apagava a janela.
  test('mexer na triagem NÃO apaga a janela noturna', async () => {
    const depois = await patchTriageConfig({ triageMaxQuestions: 4, triageExtraInstructions: 'novas' });

    expect(depois.nightStartTime).toBe('20:00');
    expect(depois.nightEndTime).toBe('08:00');
  });

  test('null desliga a janela, e só ela', async () => {
    const depois = await patchTriageConfig({ nightStartTime: null, nightEndTime: null });

    expect(depois.nightStartTime).toBeNull();
    expect(depois.nightEndTime).toBeNull();
    expect(depois.triageReadReceiptsDaytime).toBe(true);
    expect(depois.triageExtraInstructions).toBe('instrucoes originais');
  });

  test('objeto vazio não muda nada', async () => {
    const antes = await getAiConfig();
    const depois = await patchTriageConfig({});

    expect(depois.triageMaxQuestions).toBe(antes.triageMaxQuestions);
    expect(depois.triageExtraInstructions).toBe(antes.triageExtraInstructions);
    expect(depois.nightStartTime).toBe(antes.nightStartTime);
  });

  // A whitelist é o que impede o caminho novo de virar porta dos fundos para
  // as colunas que têm regra própria em outra rota.
  test('não grava campo fora da whitelist, mesmo se pedirem', async () => {
    await patchTriageConfig({
      triageMaxQuestions: 1,
      systemPrompt: 'PROMPT INVADIDO',
      model: 'modelo-invadido',
      mode: 'automatic',
      apiKey: 'sk-invadida',
      transcriptionEnabled: false,
    });

    const depois = await getAiConfig();
    expect(depois.triageMaxQuestions).toBe(1);
    expect(depois.systemPrompt).toBe('PROMPT ORIGINAL');
    expect(depois.model).toBe('gpt-5.4-mini');
    expect(depois.mode).toBe('assistant');
    expect(depois.apiKey).toBe('sk-guardada');
    expect(depois.transcriptionEnabled).toBe(true);
  });

  test('nenhum reset de system_prompt, modelo, chave ou transcrição em patch nenhum', async () => {
    for (const mudanca of [
      { triageMaxQuestions: 5 },
      { triageReadReceiptsDaytime: false },
      { triageExtraInstructions: '' },
      { nightStartTime: null, nightEndTime: null },
      { triageConfidenceThreshold: 0.5 },
    ]) {
      await patchTriageConfig(mudanca);
      const depois = await getAiConfig();
      expect(depois.systemPrompt).toBe('PROMPT ORIGINAL');
      expect(depois.model).toBe('gpt-5.4-mini');
      expect(depois.mode).toBe('assistant');
      expect(depois.apiKey).toBe('sk-guardada');
      expect(depois.transcriptionEnabled).toBe(true);
      expect(depois.transcriptionModel).toBe('whisper-1');
      expect(depois.transcriptionPrompt).toBe('vocabulario');
    }
  });

  test('as permissões de ferramenta não são tocadas', async () => {
    await setToolPermission('gerar_pix', true);

    await patchTriageConfig({ triageMaxQuestions: 3 });

    expect(await isToolEnabled('gerar_pix')).toBe(true);
  });
});

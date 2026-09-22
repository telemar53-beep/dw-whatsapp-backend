const { getPool } = require('../db/pool');
const { COLUNAS_ATUALIZAVEIS, CAMPOS_ATUALIZAVEIS } = require('./ai-config.campos');

function toConfig(row) {
  return {
    id: row.id,
    apiKey: row.api_key,
    model: row.model,
    mode: row.mode,
    systemPrompt: row.system_prompt,
    maxToolsPerInteraction: row.max_tools_per_interaction,
    transcriptionEnabled: row.transcription_enabled,
    transcriptionModel: row.transcription_model,
    transcriptionMaxSeconds: row.transcription_max_seconds,
    transcriptionMaxBytes: row.transcription_max_bytes,
    transcriptionPrompt: row.transcription_prompt,
    transcriptionFeedAi: row.transcription_feed_ai,
    triageConfidenceThreshold: Number(row.triage_confidence_threshold),
    triageMaxQuestions: row.triage_max_questions,
    triageTimeoutMinutes: row.triage_timeout_minutes,
    triageExtraInstructions: row.triage_extra_instructions,
    triageResolvedReasonId: row.triage_resolved_reason_id || null,
    // Desligada (padrao): a IA sugerindo resposta ao atendente e separado da
    // triagem e da transcricao — desligar pelo `mode` levava os tres juntos.
    assistantSuggestionsEnabled: Boolean(row.assistant_suggestions_enabled),
    // Desligada (padrao): de dia a triagem nem abre a imagem. Ligada, ela le
    // o comprovante so para conferir e avisar a atendente — nunca libera nada.
    triageReadReceiptsDaytime: Boolean(row.triage_read_receipts_daytime),
    // O driver devolve TIME como 'HH:MM:SS'; a janela só trabalha com HH:MM.
    nightStartTime: row.night_start_time ? String(row.night_start_time).slice(0, 5) : null,
    nightEndTime: row.night_end_time ? String(row.night_end_time).slice(0, 5) : null,
  };
}

function toPermission(row) {
  return { toolName: row.tool_name, enabled: row.enabled };
}

async function getAiConfig() {
  const result = await getPool().query('SELECT * FROM ai_config WHERE id = 1');
  if (result.rowCount === 0) return null;
  return toConfig(result.rows[0]);
}

async function updateAiConfig({ apiKey, model, mode, systemPrompt }) {
  // apiKey falsy mantém a chave já salva — a tela nunca reenvia a chave inteira.
  const result = await getPool().query(
    `UPDATE ai_config
        SET api_key = COALESCE($1, api_key),
            model = $2,
            mode = $3,
            system_prompt = COALESCE($4, system_prompt),
            updated_at = now()
      WHERE id = 1 RETURNING *`,
    [apiKey || null, model, mode, systemPrompt || null]
  );
  return toConfig(result.rows[0]);
}

async function updateTranscriptionConfig({
  transcriptionEnabled, transcriptionModel, transcriptionMaxSeconds,
  transcriptionMaxBytes, transcriptionPrompt, transcriptionFeedAi,
}) {
  const result = await getPool().query(
    `UPDATE ai_config
        SET transcription_enabled = $1, transcription_model = $2,
            transcription_max_seconds = $3, transcription_max_bytes = $4,
            transcription_prompt = $5, transcription_feed_ai = $6, updated_at = now()
      WHERE id = 1 RETURNING *`,
    [transcriptionEnabled, transcriptionModel, transcriptionMaxSeconds,
     transcriptionMaxBytes, transcriptionPrompt, transcriptionFeedAi]
  );
  return toConfig(result.rows[0]);
}

// triageResolvedReasonId não usa COALESCE de propósito: null aqui é o admin
// DESLIGANDO o encerramento pela IA, não "mantenha o que estava".
async function updateAssistantSuggestionsEnabled(enabled) {
  const result = await getPool().query(
    'UPDATE ai_config SET assistant_suggestions_enabled = $1, updated_at = now() WHERE id = 1 RETURNING *',
    [Boolean(enabled)]
  );
  return toConfig(result.rows[0]);
}

async function updateTriageConfig({ triageConfidenceThreshold, triageMaxQuestions, triageTimeoutMinutes, triageExtraInstructions, triageResolvedReasonId, nightStartTime, nightEndTime, triageReadReceiptsDaytime }) {
  const result = await getPool().query(
    `UPDATE ai_config SET triage_confidence_threshold = $1, triage_max_questions = $2,
            triage_timeout_minutes = $3, triage_extra_instructions = $4,
            triage_resolved_reason_id = $5, night_start_time = $6, night_end_time = $7,
            triage_read_receipts_daytime = $8, updated_at = now()
      WHERE id = 1 RETURNING *`,
    [triageConfidenceThreshold, triageMaxQuestions, triageTimeoutMinutes, triageExtraInstructions,
     triageResolvedReasonId || null, nightStartTime || null, nightEndTime || null,
     Boolean(triageReadReceiptsDaytime)]
  );
  return toConfig(result.rows[0]);
}

async function listToolPermissions() {
  const result = await getPool().query(
    'SELECT tool_name, enabled FROM ai_tool_permissions ORDER BY tool_name ASC'
  );
  return result.rows.map(toPermission);
}

async function setToolPermission(toolName, enabled) {
  const result = await getPool().query(
    `INSERT INTO ai_tool_permissions (tool_name, enabled) VALUES ($1, $2)
     ON CONFLICT (tool_name) DO UPDATE SET enabled = $2, updated_at = now()
     RETURNING tool_name, enabled`,
    [toolName, enabled]
  );
  return toPermission(result.rows[0]);
}

async function isToolEnabled(toolName) {
  const result = await getPool().query(
    'SELECT enabled FROM ai_tool_permissions WHERE tool_name = $1',
    [toolName]
  );
  // Ferramenta sem linha é ferramenta desligada: o padrão é negar.
  if (result.rowCount === 0) return false;
  return result.rows[0].enabled;
}

// Update PARCIAL da configuração de triagem (ADR-011).
//
// `updateTriageConfig` grava as oito colunas sempre, então quem quisesse mudar
// só a janela noturna tinha de reenviar as outras sete — e reenviar significa
// reenviar o que estava em cache, revertendo em silêncio o que outra pessoa
// mudou no meio. Três telas editam pedaços dessa mesma linha.
//
// Aqui só entra no SET a coluna cuja chave veio no objeto. Ausente não é
// `null`, não é `false` e não é o default: a coluna nem aparece no UPDATE.
// É por isso que a checagem é `hasOwnProperty` e não `!== undefined` — um
// `{ nightStartTime: undefined }` explícito também é tratado como ausente,
// que é o que o JSON de uma requisição jamais produz mas um objeto montado em
// código pode.
//
// A whitelist mora em ai-config.campos.js — ver o porquê lá.

async function patchTriageConfig(campos) {
  const enviados = CAMPOS_ATUALIZAVEIS.filter(
    (campo) => campos && Object.prototype.hasOwnProperty.call(campos, campo) && campos[campo] !== undefined
  );

  // Nada para mudar: devolve o que está gravado, sem tocar em updated_at.
  if (enviados.length === 0) return getAiConfig();

  const atribuicoes = enviados.map((campo, i) => `${COLUNAS_ATUALIZAVEIS[campo]} = $${i + 1}`);
  const valores = enviados.map((campo) => campos[campo]);

  const result = await getPool().query(
    `UPDATE ai_config SET ${atribuicoes.join(', ')}, updated_at = now() WHERE id = 1 RETURNING *`,
    valores
  );
  return toConfig(result.rows[0]);
}

module.exports = { getAiConfig, updateAiConfig, updateTranscriptionConfig, updateTriageConfig, patchTriageConfig, updateAssistantSuggestionsEnabled, listToolPermissions, setToolPermission, isToolEnabled };

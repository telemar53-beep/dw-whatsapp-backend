const { getPool } = require('../db/pool');

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
async function updateTriageConfig({ triageConfidenceThreshold, triageMaxQuestions, triageTimeoutMinutes, triageExtraInstructions, triageResolvedReasonId, nightStartTime, nightEndTime }) {
  const result = await getPool().query(
    `UPDATE ai_config SET triage_confidence_threshold = $1, triage_max_questions = $2,
            triage_timeout_minutes = $3, triage_extra_instructions = $4,
            triage_resolved_reason_id = $5, night_start_time = $6, night_end_time = $7,
            updated_at = now()
      WHERE id = 1 RETURNING *`,
    [triageConfidenceThreshold, triageMaxQuestions, triageTimeoutMinutes, triageExtraInstructions,
     triageResolvedReasonId || null, nightStartTime || null, nightEndTime || null]
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

module.exports = { getAiConfig, updateAiConfig, updateTranscriptionConfig, updateTriageConfig, listToolPermissions, setToolPermission, isToolEnabled };

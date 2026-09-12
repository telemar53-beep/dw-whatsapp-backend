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

module.exports = { getAiConfig, updateAiConfig, updateTranscriptionConfig, listToolPermissions, setToolPermission, isToolEnabled };

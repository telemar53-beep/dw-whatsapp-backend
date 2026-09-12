const { getPool } = require('../db/pool');

function toInteraction(row) {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    contactId: row.contact_id,
    mode: row.mode,
    model: row.model,
    toolsRequested: row.tools_requested,
    toolsExecuted: row.tools_executed,
    toolsRefused: row.tools_refused,
    finalResponse: row.final_response,
    error: row.error,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    durationMs: row.duration_ms,
    createdAt: row.created_at,
  };
}

async function recordAiInteraction({
  conversationId, contactId, mode, model,
  toolsRequested, toolsExecuted, toolsRefused,
  finalResponse, error, promptTokens, completionTokens, durationMs,
}) {
  const result = await getPool().query(
    `INSERT INTO ai_interactions
       (conversation_id, contact_id, mode, model, tools_requested, tools_executed,
        tools_refused, final_response, error, prompt_tokens, completion_tokens, duration_ms)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING *`,
    [
      conversationId, contactId || null, mode, model,
      JSON.stringify(toolsRequested || []), JSON.stringify(toolsExecuted || []),
      JSON.stringify(toolsRefused || []), finalResponse || null, error || null,
      promptTokens || null, completionTokens || null, durationMs || null,
    ]
  );
  return toInteraction(result.rows[0]);
}

async function listAiInteractionsByConversation(conversationId) {
  const result = await getPool().query(
    'SELECT * FROM ai_interactions WHERE conversation_id = $1 ORDER BY created_at ASC',
    [conversationId]
  );
  return result.rows.map(toInteraction);
}

module.exports = { recordAiInteraction, listAiInteractionsByConversation };

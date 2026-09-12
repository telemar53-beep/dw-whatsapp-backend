const { getPool } = require('../db/pool');

function toSuggestion(row) {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    messageId: row.message_id,
    content: row.content,
    status: row.status,
    createdAt: row.created_at,
  };
}

async function createSuggestion({ conversationId, messageId, content }) {
  const result = await getPool().query(
    `INSERT INTO ai_suggestions (conversation_id, message_id, content)
     VALUES ($1, $2, $3) RETURNING *`,
    [conversationId, messageId || null, content]
  );
  return toSuggestion(result.rows[0]);
}

async function findPendingSuggestion(conversationId) {
  const result = await getPool().query(
    `SELECT * FROM ai_suggestions
      WHERE conversation_id = $1 AND status = 'pending'
      ORDER BY created_at DESC LIMIT 1`,
    [conversationId]
  );
  if (result.rowCount === 0) return null;
  return toSuggestion(result.rows[0]);
}

async function markSuggestion(id, status) {
  const result = await getPool().query(
    'UPDATE ai_suggestions SET status = $2 WHERE id = $1 RETURNING *',
    [id, status]
  );
  if (result.rowCount === 0) return null;
  return toSuggestion(result.rows[0]);
}

module.exports = { createSuggestion, findPendingSuggestion, markSuggestion };

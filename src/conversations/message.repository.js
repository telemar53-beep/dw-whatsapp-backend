const { getPool } = require('../db/pool');

function toMessage(row) {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    direction: row.direction,
    content: row.content,
    whatsappMessageId: row.whatsapp_message_id,
    status: row.status,
    createdAt: row.created_at,
  };
}

async function createMessage({ conversationId, direction, content, whatsappMessageId, status }) {
  const result = await getPool().query(
    `INSERT INTO messages (conversation_id, direction, content, whatsapp_message_id, status)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, conversation_id, direction, content, whatsapp_message_id, status, created_at`,
    [conversationId, direction, content, whatsappMessageId || null, status]
  );
  return toMessage(result.rows[0]);
}

async function updateMessageStatus(messageId, status) {
  const result = await getPool().query(
    `UPDATE messages SET status = $2 WHERE id = $1
     RETURNING id, conversation_id, direction, content, whatsapp_message_id, status, created_at`,
    [messageId, status]
  );
  if (result.rowCount === 0) return null;
  return toMessage(result.rows[0]);
}

async function recordMessageSent(messageId, whatsappMessageId) {
  const result = await getPool().query(
    `UPDATE messages SET whatsapp_message_id = $2 WHERE id = $1
     RETURNING id, conversation_id, direction, content, whatsapp_message_id, status, created_at`,
    [messageId, whatsappMessageId]
  );
  if (result.rowCount === 0) return null;
  return toMessage(result.rows[0]);
}

async function listMessagesByConversation(conversationId) {
  const result = await getPool().query(
    `SELECT id, conversation_id, direction, content, whatsapp_message_id, status, created_at
     FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC`,
    [conversationId]
  );
  return result.rows.map(toMessage);
}

module.exports = { createMessage, updateMessageStatus, recordMessageSent, listMessagesByConversation };

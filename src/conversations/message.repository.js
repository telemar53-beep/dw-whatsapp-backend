const { getPool } = require('../db/pool');

function toMessage(row) {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    direction: row.direction,
    content: row.content,
    messageType: row.message_type,
    mediaPath: row.media_path,
    mediaMimeType: row.media_mime_type,
    mediaFilename: row.media_filename,
    locationLatitude: row.location_latitude !== null ? Number(row.location_latitude) : null,
    locationLongitude: row.location_longitude !== null ? Number(row.location_longitude) : null,
    whatsappMessageId: row.whatsapp_message_id,
    status: row.status,
    createdAt: row.created_at,
  };
}

const MESSAGE_COLUMNS = `id, conversation_id, direction, content, whatsapp_message_id, status,
       message_type, media_path, media_mime_type, media_filename,
       location_latitude, location_longitude, created_at`;

async function createMessage({
  conversationId,
  direction,
  content,
  whatsappMessageId,
  status,
  messageType,
  mediaPath,
  mediaMimeType,
  mediaFilename,
  locationLatitude,
  locationLongitude,
}) {
  const result = await getPool().query(
    `INSERT INTO messages (
       conversation_id, direction, content, whatsapp_message_id, status,
       message_type, media_path, media_mime_type, media_filename,
       location_latitude, location_longitude
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING ${MESSAGE_COLUMNS}`,
    [
      conversationId,
      direction,
      content || null,
      whatsappMessageId || null,
      status,
      messageType || 'text',
      mediaPath || null,
      mediaMimeType || null,
      mediaFilename || null,
      locationLatitude != null ? locationLatitude : null,
      locationLongitude != null ? locationLongitude : null,
    ]
  );
  return toMessage(result.rows[0]);
}

async function updateMessageStatus(messageId, status) {
  const result = await getPool().query(
    `UPDATE messages SET status = $2 WHERE id = $1 RETURNING ${MESSAGE_COLUMNS}`,
    [messageId, status]
  );
  if (result.rowCount === 0) return null;
  return toMessage(result.rows[0]);
}

const STATUS_RANK_SQL = `CASE status WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 WHEN 'failed' THEN 4 ELSE 0 END`;

async function advanceMessageStatus(whatsappMessageId, status) {
  const result = await getPool().query(
    `UPDATE messages SET status = $2
     WHERE whatsapp_message_id = $1
       AND ${STATUS_RANK_SQL} < (CASE $2 WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 WHEN 'failed' THEN 4 ELSE 0 END)
     RETURNING ${MESSAGE_COLUMNS}`,
    [whatsappMessageId, status]
  );
  if (result.rowCount === 0) return null;
  return toMessage(result.rows[0]);
}

async function recordMessageSent(messageId, whatsappMessageId) {
  const result = await getPool().query(
    `UPDATE messages SET whatsapp_message_id = $2 WHERE id = $1 RETURNING ${MESSAGE_COLUMNS}`,
    [messageId, whatsappMessageId]
  );
  if (result.rowCount === 0) return null;
  return toMessage(result.rows[0]);
}

async function listMessagesByConversation(conversationId) {
  const result = await getPool().query(
    `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC`,
    [conversationId]
  );
  return result.rows.map(toMessage);
}

async function findMessageById(id) {
  const result = await getPool().query(`SELECT ${MESSAGE_COLUMNS} FROM messages WHERE id = $1`, [id]);
  if (result.rowCount === 0) return null;
  return toMessage(result.rows[0]);
}

module.exports = {
  createMessage,
  updateMessageStatus,
  advanceMessageStatus,
  recordMessageSent,
  listMessagesByConversation,
  findMessageById,
};

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
    repliedToMessageId: row.replied_to_message_id,
    sentBy: row.sent_by,
    createdAt: row.created_at,
  };
}

function toMessageWithReplyPreview(row) {
  return {
    ...toMessage(row),
    repliedToPreview: row.replied_to_message_id
      ? { content: row.replied_to_content, direction: row.replied_to_direction }
      : null,
  };
}

const MESSAGE_COLUMNS = `id, conversation_id, direction, content, whatsapp_message_id, status,
       message_type, media_path, media_mime_type, media_filename,
       location_latitude, location_longitude, replied_to_message_id, sent_by, created_at`;

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
  repliedToMessageId,
  sentBy,
}) {
  const result = await getPool().query(
    `INSERT INTO messages (
       conversation_id, direction, content, whatsapp_message_id, status,
       message_type, media_path, media_mime_type, media_filename,
       location_latitude, location_longitude, replied_to_message_id, sent_by
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
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
      repliedToMessageId || null,
      sentBy || 'human',
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
    `SELECT m.id, m.conversation_id, m.direction, m.content, m.whatsapp_message_id, m.status,
            m.message_type, m.media_path, m.media_mime_type, m.media_filename,
            m.location_latitude, m.location_longitude, m.replied_to_message_id, m.sent_by, m.created_at,
            rm.content AS replied_to_content, rm.direction AS replied_to_direction
     FROM messages m
     LEFT JOIN messages rm ON rm.id = m.replied_to_message_id
     WHERE m.conversation_id = $1
     ORDER BY m.created_at ASC`,
    [conversationId]
  );
  return result.rows.map(toMessageWithReplyPreview);
}

/**
 * As últimas `limit` mensagens da conversa, em ordem cronológica (mais antiga
 * primeiro). Diferente de listMessagesByConversation (que não pagina e serve
 * a tela de atendimento inteira), esta função existe para alimentar o
 * histórico enviado à IA: pega as mais NOVAS via ORDER BY created_at DESC
 * LIMIT, e só então inverte para a ordem de leitura. Um LIMIT aplicado direto
 * num ORDER BY ASC devolveria as mensagens mais antigas da conversa, fazendo
 * a IA nunca ver o que o cliente acabou de escrever.
 */
async function listRecentMessagesByConversation(conversationId, limit) {
  const result = await getPool().query(
    `SELECT m.id, m.conversation_id, m.direction, m.content, m.whatsapp_message_id, m.status,
            m.message_type, m.media_path, m.media_mime_type, m.media_filename,
            m.location_latitude, m.location_longitude, m.replied_to_message_id, m.sent_by, m.created_at,
            rm.content AS replied_to_content, rm.direction AS replied_to_direction
     FROM messages m
     LEFT JOIN messages rm ON rm.id = m.replied_to_message_id
     WHERE m.conversation_id = $1
     ORDER BY m.created_at DESC
     LIMIT $2`,
    [conversationId, limit]
  );
  return result.rows.map(toMessageWithReplyPreview).reverse();
}

async function findMessageById(id) {
  const result = await getPool().query(`SELECT ${MESSAGE_COLUMNS} FROM messages WHERE id = $1`, [id]);
  if (result.rowCount === 0) return null;
  return toMessage(result.rows[0]);
}

/**
 * O id da mensagem inbound mais recente da conversa (ou null, se não houver
 * nenhuma). Usada pela fila da IA para saber se um job ainda representa a
 * última coisa que o cliente escreveu — filtra por direction porque a
 * mensagem cronologicamente mais nova pode muito bem ser uma resposta da
 * própria IA, o que faria todo job se achar "ultrapassado".
 */
async function findLatestInboundMessageId(conversationId) {
  const result = await getPool().query(
    `SELECT id FROM messages WHERE conversation_id = $1 AND direction = 'inbound'
     ORDER BY created_at DESC LIMIT 1`,
    [conversationId]
  );
  if (result.rowCount === 0) return null;
  return result.rows[0].id;
}

module.exports = {
  createMessage,
  updateMessageStatus,
  advanceMessageStatus,
  recordMessageSent,
  listMessagesByConversation,
  listRecentMessagesByConversation,
  findMessageById,
  findLatestInboundMessageId,
};

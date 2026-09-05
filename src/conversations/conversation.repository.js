const { getPool, withTransaction } = require('../db/pool');

function toConversation(row) {
  return {
    id: row.id,
    contactId: row.contact_id,
    channelId: row.channel_id,
    status: row.status,
    assignedAgentId: row.assigned_agent_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function findOpenConversation(contactId, channelId) {
  const result = await getPool().query(
    `SELECT id, contact_id, channel_id, status, assigned_agent_id, created_at, updated_at
     FROM conversations WHERE contact_id = $1 AND channel_id = $2 AND status <> 'closed'`,
    [contactId, channelId]
  );
  if (result.rowCount === 0) return null;
  return toConversation(result.rows[0]);
}

async function createConversation(contactId, channelId) {
  const result = await getPool().query(
    `INSERT INTO conversations (contact_id, channel_id) VALUES ($1, $2)
     RETURNING id, contact_id, channel_id, status, assigned_agent_id, created_at, updated_at`,
    [contactId, channelId]
  );
  return toConversation(result.rows[0]);
}

async function claimConversation(conversationId, agentId) {
  return withTransaction(async (client) => {
    const result = await client.query(
      `UPDATE conversations SET status = 'assigned', assigned_agent_id = $2, updated_at = now()
       WHERE id = $1 AND assigned_agent_id IS NULL AND status <> 'closed'
       RETURNING id, contact_id, channel_id, status, assigned_agent_id, created_at, updated_at`,
      [conversationId, agentId]
    );
    if (result.rowCount === 0) return null;
    await client.query(
      `INSERT INTO conversation_events (conversation_id, event_type, to_agent_id) VALUES ($1, 'assigned', $2)`,
      [conversationId, agentId]
    );
    return toConversation(result.rows[0]);
  });
}

async function transferConversation(conversationId, fromAgentId, toAgentId) {
  return withTransaction(async (client) => {
    const result = await client.query(
      `UPDATE conversations SET assigned_agent_id = $2, updated_at = now()
       WHERE id = $1 AND assigned_agent_id = $3 AND status <> 'closed'
       RETURNING id, contact_id, channel_id, status, assigned_agent_id, created_at, updated_at`,
      [conversationId, toAgentId, fromAgentId]
    );
    if (result.rowCount === 0) return null;
    await client.query(
      `INSERT INTO conversation_events (conversation_id, event_type, from_agent_id, to_agent_id) VALUES ($1, 'transferred', $2, $3)`,
      [conversationId, fromAgentId, toAgentId]
    );
    return toConversation(result.rows[0]);
  });
}

async function closeConversation(conversationId) {
  return withTransaction(async (client) => {
    const result = await client.query(
      `UPDATE conversations SET status = 'closed', updated_at = now()
       WHERE id = $1 AND status <> 'closed'
       RETURNING id, contact_id, channel_id, status, assigned_agent_id, created_at, updated_at`,
      [conversationId]
    );
    if (result.rowCount === 0) return null;
    await client.query(`INSERT INTO conversation_events (conversation_id, event_type) VALUES ($1, 'closed')`, [
      conversationId,
    ]);
    return toConversation(result.rows[0]);
  });
}

async function getConversationWithContact(conversationId) {
  const result = await getPool().query(
    `SELECT c.id, c.contact_id, c.channel_id, c.status, c.assigned_agent_id, c.created_at, c.updated_at,
            ct.phone_number AS contact_phone_number
     FROM conversations c
     JOIN contacts ct ON ct.id = c.contact_id
     WHERE c.id = $1`,
    [conversationId]
  );
  if (result.rowCount === 0) return null;
  const row = result.rows[0];
  return { ...toConversation(row), contactPhoneNumber: row.contact_phone_number };
}

module.exports = {
  findOpenConversation,
  createConversation,
  claimConversation,
  transferConversation,
  closeConversation,
  getConversationWithContact,
};

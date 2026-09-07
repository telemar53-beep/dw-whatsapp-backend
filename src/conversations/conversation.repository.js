const { getPool, withTransaction } = require('../db/pool');

function toConversation(row) {
  return {
    id: row.id,
    contactId: row.contact_id,
    channelId: row.channel_id,
    status: row.status,
    assignedAgentId: row.assigned_agent_id,
    sectorId: row.sector_id,
    triageState: row.triage_state,
    triageAttempts: row.triage_attempts,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toConversationSummary(row) {
  return {
    ...toConversation(row),
    contactPhoneNumber: row.contact_phone_number,
    contactDisplayName: row.contact_display_name,
    contactAvatarPath: row.contact_avatar_path,
    contactCityId: row.contact_city_id,
    contactCityName: row.contact_city_name,
    sectorName: row.sector_name,
    lastMessageContent: row.last_message_content,
    lastMessageType: row.last_message_type,
    lastMessageAt: row.last_message_at,
  };
}

async function findOpenConversation(contactId, channelId) {
  const result = await getPool().query(
    `SELECT id, contact_id, channel_id, status, assigned_agent_id, sector_id, triage_state, triage_attempts, created_at, updated_at
     FROM conversations WHERE contact_id = $1 AND channel_id = $2 AND status <> 'closed'`,
    [contactId, channelId]
  );
  if (result.rowCount === 0) return null;
  return toConversation(result.rows[0]);
}

async function createConversation(contactId, channelId, triageState = null, status = 'waiting') {
  const result = await getPool().query(
    `INSERT INTO conversations (contact_id, channel_id, triage_state, status) VALUES ($1, $2, $3, $4)
     RETURNING id, contact_id, channel_id, status, assigned_agent_id, sector_id, triage_state, triage_attempts, created_at, updated_at`,
    [contactId, channelId, triageState, status]
  );
  return toConversation(result.rows[0]);
}

async function claimConversation(conversationId, agentId) {
  return withTransaction(async (client) => {
    const result = await client.query(
      `UPDATE conversations SET status = 'assigned', assigned_agent_id = $2, triage_state = 'completed', updated_at = now()
       WHERE id = $1 AND assigned_agent_id IS NULL AND status <> 'closed'
       RETURNING id, contact_id, channel_id, status, assigned_agent_id, sector_id, triage_state, triage_attempts, created_at, updated_at`,
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
       RETURNING id, contact_id, channel_id, status, assigned_agent_id, sector_id, triage_state, triage_attempts, created_at, updated_at`,
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

async function closeConversation(conversationId, agentId) {
  return withTransaction(async (client) => {
    const result = await client.query(
      `UPDATE conversations SET status = 'closed', updated_at = now()
       WHERE id = $1 AND assigned_agent_id = $2 AND status <> 'closed'
       RETURNING id, contact_id, channel_id, status, assigned_agent_id, sector_id, triage_state, triage_attempts, created_at, updated_at`,
      [conversationId, agentId]
    );
    if (result.rowCount === 0) return null;
    await client.query(
      `INSERT INTO conversation_events (conversation_id, event_type, from_agent_id) VALUES ($1, 'closed', $2)`,
      [conversationId, agentId]
    );
    return toConversation(result.rows[0]);
  });
}

async function completeTriage(conversationId, sectorId) {
  const result = await getPool().query(
    `UPDATE conversations SET sector_id = $2, triage_state = 'completed', updated_at = now()
     WHERE id = $1 AND triage_state = 'pending'
     RETURNING id, contact_id, channel_id, status, assigned_agent_id, sector_id, triage_state, triage_attempts, created_at, updated_at`,
    [conversationId, sectorId]
  );
  if (result.rowCount === 0) return null;
  return toConversation(result.rows[0]);
}

async function incrementTriageAttempts(conversationId) {
  const result = await getPool().query(
    `UPDATE conversations SET triage_attempts = triage_attempts + 1, updated_at = now()
     WHERE id = $1 AND triage_state = 'pending'
     RETURNING triage_attempts`,
    [conversationId]
  );
  if (result.rowCount === 0) return 0;
  return result.rows[0].triage_attempts;
}

async function activateConversation(conversationId) {
  const result = await getPool().query(
    `UPDATE conversations SET status = 'waiting', updated_at = now()
     WHERE id = $1 AND status = 'silent'
     RETURNING id, contact_id, channel_id, status, assigned_agent_id, sector_id, triage_state, triage_attempts, created_at, updated_at`,
    [conversationId]
  );
  if (result.rowCount === 0) return null;
  return toConversation(result.rows[0]);
}

async function getConversationWithContact(conversationId) {
  const result = await getPool().query(
    `SELECT c.id, c.contact_id, c.channel_id, c.status, c.assigned_agent_id, c.sector_id, c.triage_state, c.triage_attempts, c.created_at, c.updated_at,
            ct.phone_number AS contact_phone_number, ct.display_name AS contact_display_name,
            ct.avatar_path AS contact_avatar_path,
            ct.city_id AS contact_city_id, ci.name AS contact_city_name,
            s.name AS sector_name,
            lm.content AS last_message_content, lm.message_type AS last_message_type, lm.created_at AS last_message_at
     FROM conversations c
     JOIN contacts ct ON ct.id = c.contact_id
     LEFT JOIN sectors s ON s.id = c.sector_id
     LEFT JOIN cities ci ON ci.id = ct.city_id
     LEFT JOIN LATERAL (
       SELECT content, message_type, created_at
       FROM messages m
       WHERE m.conversation_id = c.id
       ORDER BY m.created_at DESC
       LIMIT 1
     ) lm ON true
     WHERE c.id = $1`,
    [conversationId]
  );
  if (result.rowCount === 0) return null;
  return toConversationSummary(result.rows[0]);
}

async function listWaitingConversations() {
  const result = await getPool().query(
    `SELECT c.id, c.contact_id, c.channel_id, c.status, c.assigned_agent_id, c.sector_id, c.triage_state, c.triage_attempts, c.created_at, c.updated_at,
            ct.phone_number AS contact_phone_number, ct.display_name AS contact_display_name,
            ct.avatar_path AS contact_avatar_path,
            ct.city_id AS contact_city_id, ci.name AS contact_city_name,
            s.name AS sector_name,
            lm.content AS last_message_content, lm.message_type AS last_message_type, lm.created_at AS last_message_at
     FROM conversations c
     JOIN contacts ct ON ct.id = c.contact_id
     LEFT JOIN sectors s ON s.id = c.sector_id
     LEFT JOIN cities ci ON ci.id = ct.city_id
     LEFT JOIN LATERAL (
       SELECT content, message_type, created_at
       FROM messages m
       WHERE m.conversation_id = c.id
       ORDER BY m.created_at DESC
       LIMIT 1
     ) lm ON true
     WHERE c.status = 'waiting'
     ORDER BY c.created_at ASC`
  );
  return result.rows.map(toConversationSummary);
}

async function listConversationsByAgent(agentId) {
  const result = await getPool().query(
    `SELECT c.id, c.contact_id, c.channel_id, c.status, c.assigned_agent_id, c.sector_id, c.triage_state, c.triage_attempts, c.created_at, c.updated_at,
            ct.phone_number AS contact_phone_number, ct.display_name AS contact_display_name,
            ct.avatar_path AS contact_avatar_path,
            ct.city_id AS contact_city_id, ci.name AS contact_city_name,
            s.name AS sector_name,
            lm.content AS last_message_content, lm.message_type AS last_message_type, lm.created_at AS last_message_at
     FROM conversations c
     JOIN contacts ct ON ct.id = c.contact_id
     LEFT JOIN sectors s ON s.id = c.sector_id
     LEFT JOIN cities ci ON ci.id = ct.city_id
     LEFT JOIN LATERAL (
       SELECT content, message_type, created_at
       FROM messages m
       WHERE m.conversation_id = c.id
       ORDER BY m.created_at DESC
       LIMIT 1
     ) lm ON true
     WHERE c.assigned_agent_id = $1 AND c.status <> 'closed'
     ORDER BY c.updated_at DESC`,
    [agentId]
  );
  return result.rows.map(toConversationSummary);
}

async function listClosedConversationsByContact(contactId) {
  const result = await getPool().query(
    `SELECT c.id, c.contact_id, c.channel_id, c.status, c.assigned_agent_id, c.created_at, c.updated_at,
            ch.name AS channel_name, ch.type AS channel_type
     FROM conversations c
     JOIN channels ch ON ch.id = c.channel_id
     WHERE c.contact_id = $1 AND c.status = 'closed'
     ORDER BY c.updated_at DESC
     LIMIT 50`,
    [contactId]
  );
  return result.rows.map((row) => ({
    ...toConversation(row),
    channelName: row.channel_name,
    channelType: row.channel_type,
  }));
}

module.exports = {
  findOpenConversation,
  createConversation,
  claimConversation,
  transferConversation,
  closeConversation,
  completeTriage,
  incrementTriageAttempts,
  activateConversation,
  getConversationWithContact,
  listWaitingConversations,
  listConversationsByAgent,
  listClosedConversationsByContact,
};

const { getPool, withTransaction } = require('../db/pool');

function toConfig(row, agentIds, channelIds) {
  return {
    id: row.id,
    enabled: row.enabled,
    openingMessage: row.opening_message,
    closingMessage: row.closing_message,
    agentIds,
    channelIds,
  };
}

async function fetchAgentIds(client) {
  const result = await client.query('SELECT agent_id FROM assignment_message_agents ORDER BY agent_id');
  return result.rows.map((row) => row.agent_id);
}

async function fetchChannelIds(client) {
  const result = await client.query('SELECT channel_id FROM assignment_message_channels ORDER BY channel_id');
  return result.rows.map((row) => row.channel_id);
}

async function getAssignmentMessageConfig() {
  const pool = getPool();
  const result = await pool.query('SELECT * FROM assignment_message_config ORDER BY created_at ASC LIMIT 1');
  if (result.rowCount === 0) {
    return { id: null, enabled: false, openingMessage: '', closingMessage: '', agentIds: [], channelIds: [] };
  }
  const agentIds = await fetchAgentIds(pool);
  const channelIds = await fetchChannelIds(pool);
  return toConfig(result.rows[0], agentIds, channelIds);
}

async function upsertAssignmentMessageConfig({ enabled, openingMessage, closingMessage, agentIds, channelIds }) {
  return withTransaction(async (client) => {
    const existing = await client.query('SELECT id FROM assignment_message_config ORDER BY created_at ASC LIMIT 1');
    let row;
    if (existing.rowCount === 0) {
      const inserted = await client.query(
        `INSERT INTO assignment_message_config (enabled, opening_message, closing_message)
         VALUES ($1, $2, $3) RETURNING *`,
        [enabled, openingMessage, closingMessage]
      );
      row = inserted.rows[0];
    } else {
      const updated = await client.query(
        `UPDATE assignment_message_config SET enabled = $2, opening_message = $3, closing_message = $4, updated_at = now()
         WHERE id = $1 RETURNING *`,
        [existing.rows[0].id, enabled, openingMessage, closingMessage]
      );
      row = updated.rows[0];
    }

    await client.query('DELETE FROM assignment_message_agents');
    for (const agentId of agentIds) {
      await client.query('INSERT INTO assignment_message_agents (agent_id) VALUES ($1)', [agentId]);
    }

    await client.query('DELETE FROM assignment_message_channels');
    for (const channelId of channelIds) {
      await client.query('INSERT INTO assignment_message_channels (channel_id) VALUES ($1)', [channelId]);
    }

    return toConfig(row, agentIds, channelIds);
  });
}

const PROTOCOL_TIMEZONE = 'America/Sao_Paulo';

function todaySaoPauloDateString(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: PROTOCOL_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get('year')}${get('month')}${get('day')}`;
}

async function nextProtocolSequenceForToday() {
  const day = todaySaoPauloDateString();
  const result = await getPool().query(
    `INSERT INTO protocol_counters (day, last_seq) VALUES ($1, 1)
     ON CONFLICT (day) DO UPDATE SET last_seq = protocol_counters.last_seq + 1
     RETURNING last_seq`,
    [day]
  );
  return `${day}-${String(result.rows[0].last_seq).padStart(4, '0')}`;
}

async function claimProtocolNumber(conversationId) {
  const candidate = await nextProtocolSequenceForToday();
  const result = await getPool().query(
    `UPDATE conversations
     SET protocol_number = COALESCE(protocol_number, $2)
     WHERE id = $1
     RETURNING protocol_number`,
    [conversationId, candidate]
  );
  return result.rows[0].protocol_number;
}

async function clearProtocolNumber(conversationId) {
  await getPool().query('UPDATE conversations SET protocol_number = NULL WHERE id = $1', [conversationId]);
}

module.exports = {
  getAssignmentMessageConfig,
  upsertAssignmentMessageConfig,
  claimProtocolNumber,
  clearProtocolNumber,
  todaySaoPauloDateString,
};

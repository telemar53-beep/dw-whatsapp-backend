const { getPool } = require('../db/pool');

function toChannel(row) {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    phoneNumber: row.phone_number,
    config: row.config,
    status: row.status,
    triageEnabled: row.triage_enabled,
    hidden: row.hidden,
    welcomeMessage: row.welcome_message,
    createdAt: row.created_at,
  };
}

async function createChannel({ type, name, phoneNumber, config }) {
  const result = await getPool().query(
    `INSERT INTO channels (type, name, phone_number, config)
     VALUES ($1, $2, $3, $4)
     RETURNING id, type, name, phone_number, config, status, triage_enabled, hidden, welcome_message, created_at`,
    [type, name, phoneNumber, JSON.stringify(config)]
  );
  return toChannel(result.rows[0]);
}

async function findChannelById(id) {
  const result = await getPool().query(
    'SELECT id, type, name, phone_number, config, status, triage_enabled, hidden, welcome_message, created_at FROM channels WHERE id = $1',
    [id]
  );
  if (result.rowCount === 0) return null;
  return toChannel(result.rows[0]);
}

async function findChannelByMetaPhoneNumberId(phoneNumberId) {
  const result = await getPool().query(
    `SELECT id, type, name, phone_number, config, status, triage_enabled, hidden, welcome_message, created_at FROM channels
     WHERE type = 'meta_cloud' AND config->>'phoneNumberId' = $1`,
    [phoneNumberId]
  );
  if (result.rowCount === 0) return null;
  return toChannel(result.rows[0]);
}

async function findChannelByWabaId(wabaId) {
  const result = await getPool().query(
    `SELECT id, type, name, phone_number, config, status, triage_enabled, hidden, welcome_message, created_at FROM channels
     WHERE config->>'wabaId' = $1
     LIMIT 1`,
    [wabaId]
  );
  if (result.rowCount === 0) return null;
  return toChannel(result.rows[0]);
}

async function findChannelByWebhookToken(webhookToken) {
  const result = await getPool().query(
    `SELECT id, type, name, phone_number, config, status, triage_enabled, hidden, welcome_message, created_at FROM channels
     WHERE type = '360dialog' AND config->>'webhookToken' = $1`,
    [webhookToken]
  );
  if (result.rowCount === 0) return null;
  return toChannel(result.rows[0]);
}

async function listChannels({ includeHidden = false } = {}) {
  const result = await getPool().query(
    `SELECT id, type, name, phone_number, config, status, triage_enabled, hidden, welcome_message, created_at FROM channels
     ${includeHidden ? '' : 'WHERE hidden = false'}
     ORDER BY created_at ASC`
  );
  return result.rows.map(toChannel);
}

async function updateChannelStatus(id, status) {
  const result = await getPool().query(
    `UPDATE channels SET status = $2 WHERE id = $1
     RETURNING id, type, name, phone_number, config, status, triage_enabled, hidden, welcome_message, created_at`,
    [id, status]
  );
  if (result.rowCount === 0) return null;
  return toChannel(result.rows[0]);
}

async function updateChannelTriageEnabled(id, triageEnabled) {
  const result = await getPool().query(
    `UPDATE channels SET triage_enabled = $2 WHERE id = $1
     RETURNING id, type, name, phone_number, config, status, triage_enabled, hidden, welcome_message, created_at`,
    [id, triageEnabled]
  );
  if (result.rowCount === 0) return null;
  return toChannel(result.rows[0]);
}

async function updateChannelWabaId(id, wabaId) {
  const result = await getPool().query(
    `UPDATE channels SET config = jsonb_set(config, '{wabaId}', to_jsonb($2::text)) WHERE id = $1 AND type IN ('meta_cloud', '360dialog')
     RETURNING id, type, name, phone_number, config, status, triage_enabled, hidden, welcome_message, created_at`,
    [id, wabaId]
  );
  if (result.rowCount === 0) return null;
  return toChannel(result.rows[0]);
}

async function updateChannelHidden(id, hidden) {
  const result = await getPool().query(
    `UPDATE channels SET hidden = $2 WHERE id = $1
     RETURNING id, type, name, phone_number, config, status, triage_enabled, hidden, welcome_message, created_at`,
    [id, hidden]
  );
  if (result.rowCount === 0) return null;
  return toChannel(result.rows[0]);
}

async function updateChannelWelcomeMessage(id, welcomeMessage) {
  const result = await getPool().query(
    `UPDATE channels SET welcome_message = $2 WHERE id = $1
     RETURNING id, type, name, phone_number, config, status, triage_enabled, hidden, welcome_message, created_at`,
    [id, welcomeMessage]
  );
  if (result.rowCount === 0) return null;
  return toChannel(result.rows[0]);
}

async function countChannelDependents(id) {
  const result = await getPool().query(
    `SELECT
       (SELECT COUNT(*) FROM conversations WHERE channel_id = $1) AS conversations,
       (SELECT COUNT(*) FROM platform_integrations WHERE channel_id = $1) AS integrations`,
    [id]
  );
  return {
    conversations: Number(result.rows[0].conversations),
    integrations: Number(result.rows[0].integrations),
  };
}

async function deleteChannel(id) {
  const result = await getPool().query('DELETE FROM channels WHERE id = $1', [id]);
  return result.rowCount > 0;
}

module.exports = {
  createChannel,
  findChannelById,
  findChannelByMetaPhoneNumberId,
  findChannelByWabaId,
  findChannelByWebhookToken,
  listChannels,
  updateChannelStatus,
  updateChannelTriageEnabled,
  updateChannelWabaId,
  updateChannelHidden,
  updateChannelWelcomeMessage,
  countChannelDependents,
  deleteChannel,
};

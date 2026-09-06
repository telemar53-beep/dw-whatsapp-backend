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
    createdAt: row.created_at,
  };
}

async function createChannel({ type, name, phoneNumber, config }) {
  const result = await getPool().query(
    `INSERT INTO channels (type, name, phone_number, config)
     VALUES ($1, $2, $3, $4)
     RETURNING id, type, name, phone_number, config, status, triage_enabled, created_at`,
    [type, name, phoneNumber, JSON.stringify(config)]
  );
  return toChannel(result.rows[0]);
}

async function findChannelById(id) {
  const result = await getPool().query(
    'SELECT id, type, name, phone_number, config, status, triage_enabled, created_at FROM channels WHERE id = $1',
    [id]
  );
  if (result.rowCount === 0) return null;
  return toChannel(result.rows[0]);
}

async function findChannelByMetaPhoneNumberId(phoneNumberId) {
  const result = await getPool().query(
    `SELECT id, type, name, phone_number, config, status, triage_enabled, created_at FROM channels
     WHERE type = 'meta_cloud' AND config->>'phoneNumberId' = $1`,
    [phoneNumberId]
  );
  if (result.rowCount === 0) return null;
  return toChannel(result.rows[0]);
}

async function listChannels() {
  const result = await getPool().query(
    'SELECT id, type, name, phone_number, config, status, triage_enabled, created_at FROM channels ORDER BY created_at ASC'
  );
  return result.rows.map(toChannel);
}

async function updateChannelStatus(id, status) {
  const result = await getPool().query(
    `UPDATE channels SET status = $2 WHERE id = $1
     RETURNING id, type, name, phone_number, config, status, triage_enabled, created_at`,
    [id, status]
  );
  if (result.rowCount === 0) return null;
  return toChannel(result.rows[0]);
}

async function updateChannelTriageEnabled(id, triageEnabled) {
  const result = await getPool().query(
    `UPDATE channels SET triage_enabled = $2 WHERE id = $1
     RETURNING id, type, name, phone_number, config, status, triage_enabled, created_at`,
    [id, triageEnabled]
  );
  if (result.rowCount === 0) return null;
  return toChannel(result.rows[0]);
}

module.exports = {
  createChannel,
  findChannelById,
  findChannelByMetaPhoneNumberId,
  listChannels,
  updateChannelStatus,
  updateChannelTriageEnabled,
};

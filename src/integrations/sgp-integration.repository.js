const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { getPool } = require('../db/pool');

const SALT_ROUNDS = 10;

function toIntegration(row) {
  return {
    id: row.id,
    channelId: row.channel_id,
    enabled: row.enabled,
    hasApiKey: row.api_key_hash !== null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function getSgpIntegration() {
  const result = await getPool().query(
    `SELECT id, channel_id, enabled, api_key_hash, created_at, updated_at
     FROM platform_integrations WHERE platform = 'sgp'`
  );
  if (result.rowCount === 0) return null;
  return toIntegration(result.rows[0]);
}

async function saveSgpIntegrationChannel({ channelId, enabled }) {
  const result = await getPool().query(
    `INSERT INTO platform_integrations (platform, channel_id, enabled)
     VALUES ('sgp', $1, $2)
     ON CONFLICT (platform) DO UPDATE SET channel_id = EXCLUDED.channel_id, enabled = EXCLUDED.enabled, updated_at = now()
     RETURNING id, channel_id, enabled, api_key_hash, created_at, updated_at`,
    [channelId, enabled]
  );
  return toIntegration(result.rows[0]);
}

async function rotateSgpApiKey() {
  const apiKey = crypto.randomBytes(32).toString('hex');
  const apiKeyHash = await bcrypt.hash(apiKey, SALT_ROUNDS);
  const result = await getPool().query(
    `UPDATE platform_integrations SET api_key_hash = $1, updated_at = now() WHERE platform = 'sgp'
     RETURNING id, channel_id, enabled, api_key_hash, created_at, updated_at`,
    [apiKeyHash]
  );
  if (result.rowCount === 0) return null;
  return { apiKey, integration: toIntegration(result.rows[0]) };
}

async function verifySgpApiKey(candidateKey) {
  const result = await getPool().query(
    `SELECT channel_id, enabled, api_key_hash FROM platform_integrations WHERE platform = 'sgp'`
  );
  if (result.rowCount === 0) return { status: 'not_configured' };
  const row = result.rows[0];
  if (!row.enabled) return { status: 'disabled' };
  if (!row.api_key_hash) return { status: 'no_key' };
  const matches = await bcrypt.compare(candidateKey, row.api_key_hash);
  if (!matches) return { status: 'invalid' };
  return { status: 'ok', channelId: row.channel_id };
}

function toDispatch(row) {
  return {
    id: row.id,
    referenceId: row.reference_id,
    conversationId: row.conversation_id,
    messageId: row.message_id,
    createdAt: row.created_at,
  };
}

async function findSgpDispatchByReferenceId(referenceId) {
  const result = await getPool().query(
    'SELECT id, reference_id, conversation_id, message_id, created_at FROM sgp_dispatches WHERE reference_id = $1',
    [referenceId]
  );
  if (result.rowCount === 0) return null;
  return toDispatch(result.rows[0]);
}

async function createSgpDispatch({ referenceId, conversationId, messageId }) {
  const result = await getPool().query(
    `INSERT INTO sgp_dispatches (reference_id, conversation_id, message_id) VALUES ($1, $2, $3)
     RETURNING id, reference_id, conversation_id, message_id, created_at`,
    [referenceId, conversationId, messageId]
  );
  return toDispatch(result.rows[0]);
}

module.exports = {
  getSgpIntegration,
  saveSgpIntegrationChannel,
  rotateSgpApiKey,
  verifySgpApiKey,
  findSgpDispatchByReferenceId,
  createSgpDispatch,
};

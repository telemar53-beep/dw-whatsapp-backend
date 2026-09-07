const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { getPool } = require('../db/pool');

const SALT_ROUNDS = 10;

function toIntegration(row) {
  return {
    id: row.id,
    description: row.description,
    channelId: row.channel_id,
    mode: row.mode,
    defaultTemplateId: row.default_template_id,
    enabled: row.enabled,
    hasApiKey: row.api_key_hash !== null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function listSgpIntegrations() {
  const result = await getPool().query(
    `SELECT id, description, channel_id, mode, default_template_id, enabled, api_key_hash, created_at, updated_at
     FROM platform_integrations WHERE platform = 'sgp' ORDER BY created_at ASC`
  );
  return result.rows.map(toIntegration);
}

async function createSgpIntegration({ description, channelId, mode, defaultTemplateId, enabled }) {
  const result = await getPool().query(
    `INSERT INTO platform_integrations (platform, description, channel_id, mode, default_template_id, enabled)
     VALUES ('sgp', $1, $2, $3, $4, $5)
     RETURNING id, description, channel_id, mode, default_template_id, enabled, api_key_hash, created_at, updated_at`,
    [description, channelId, mode, defaultTemplateId || null, enabled]
  );
  return toIntegration(result.rows[0]);
}

async function updateSgpIntegration(id, { description, channelId, mode, defaultTemplateId, enabled }) {
  const result = await getPool().query(
    `UPDATE platform_integrations
     SET description = $2, channel_id = $3, mode = $4, default_template_id = $5, enabled = $6, updated_at = now()
     WHERE id = $1 AND platform = 'sgp'
     RETURNING id, description, channel_id, mode, default_template_id, enabled, api_key_hash, created_at, updated_at`,
    [id, description, channelId, mode, defaultTemplateId || null, enabled]
  );
  if (result.rowCount === 0) return null;
  return toIntegration(result.rows[0]);
}

async function rotateSgpApiKey(id) {
  const apiKey = crypto.randomBytes(32).toString('hex');
  const apiKeyHash = await bcrypt.hash(apiKey, SALT_ROUNDS);
  const result = await getPool().query(
    `UPDATE platform_integrations SET api_key_hash = $2, updated_at = now()
     WHERE id = $1 AND platform = 'sgp'
     RETURNING id, description, channel_id, mode, default_template_id, enabled, api_key_hash, created_at, updated_at`,
    [id, apiKeyHash]
  );
  if (result.rowCount === 0) return null;
  return { apiKey, integration: toIntegration(result.rows[0]) };
}

async function verifySgpApiKey(candidateKey) {
  const result = await getPool().query(
    `SELECT channel_id, mode, default_template_id, enabled, api_key_hash
     FROM platform_integrations WHERE platform = 'sgp'`
  );
  if (result.rowCount === 0) return { status: 'not_configured' };
  for (const row of result.rows) {
    if (!row.api_key_hash) continue;
    const matches = await bcrypt.compare(candidateKey, row.api_key_hash);
    if (matches) {
      if (!row.enabled) return { status: 'disabled' };
      return { status: 'ok', channelId: row.channel_id, mode: row.mode, defaultTemplateId: row.default_template_id };
    }
  }
  return { status: 'invalid' };
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
  listSgpIntegrations,
  createSgpIntegration,
  updateSgpIntegration,
  rotateSgpApiKey,
  verifySgpApiKey,
  findSgpDispatchByReferenceId,
  createSgpDispatch,
};

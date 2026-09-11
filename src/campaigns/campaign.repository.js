const { getPool } = require('../db/pool');

const COUNTER_COLUMNS = { sent: 'sent_count', failed: 'failed_count', skipped: 'skipped_count' };

function toCampaign(row) {
  return {
    id: row.id,
    name: row.name,
    channelId: row.channel_id,
    messageType: row.message_type,
    content: row.content,
    templateName: row.template_name,
    templateLanguage: row.template_language,
    templateVariables: row.template_variables,
    createdBy: row.created_by,
    totalRecipients: row.total_recipients,
    sentCount: row.sent_count,
    failedCount: row.failed_count,
    skippedCount: row.skipped_count,
    createdAt: row.created_at,
  };
}

function toRecipient(row) {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    rawPhoneNumber: row.raw_phone_number,
    phoneNumber: row.phone_number,
    displayName: row.display_name,
    status: row.status,
    errorMessage: row.error_message,
    contactId: row.contact_id,
    conversationId: row.conversation_id,
    createdAt: row.created_at,
    processedAt: row.processed_at,
  };
}

const CAMPAIGN_COLUMNS = `id, name, channel_id, message_type, content, template_name, template_language, template_variables, created_by, total_recipients, sent_count, failed_count, skipped_count, created_at`;
const RECIPIENT_COLUMNS = `id, campaign_id, raw_phone_number, phone_number, display_name, status, error_message, contact_id, conversation_id, created_at, processed_at`;

async function createCampaign({ name, channelId, messageType, content, templateName, templateLanguage, templateVariables, createdBy, totalRecipients }) {
  const result = await getPool().query(
    `INSERT INTO campaigns (name, channel_id, message_type, content, template_name, template_language, template_variables, created_by, total_recipients)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING ${CAMPAIGN_COLUMNS}`,
    [
      name || null,
      channelId,
      messageType,
      content,
      templateName || null,
      templateLanguage || null,
      templateVariables ? JSON.stringify(templateVariables) : null,
      createdBy,
      totalRecipients,
    ]
  );
  return toCampaign(result.rows[0]);
}

async function findCampaignById(id) {
  const result = await getPool().query(`SELECT ${CAMPAIGN_COLUMNS} FROM campaigns WHERE id = $1`, [id]);
  if (result.rowCount === 0) return null;
  return toCampaign(result.rows[0]);
}

async function listCampaigns() {
  const result = await getPool().query(`SELECT ${CAMPAIGN_COLUMNS} FROM campaigns ORDER BY created_at DESC`);
  return result.rows.map(toCampaign);
}

async function createCampaignRecipients(campaignId, recipients) {
  const values = [];
  const params = [];
  recipients.forEach((r, i) => {
    const base = i * 6;
    values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`);
    params.push(campaignId, r.rawPhoneNumber, r.phoneNumber, r.displayName || null, r.status || 'pending', r.errorMessage || null);
  });
  const result = await getPool().query(
    `INSERT INTO campaign_recipients (campaign_id, raw_phone_number, phone_number, display_name, status, error_message)
     VALUES ${values.join(', ')}
     RETURNING ${RECIPIENT_COLUMNS}`,
    params
  );
  return result.rows.map(toRecipient);
}

async function listCampaignRecipients(campaignId) {
  const result = await getPool().query(
    `SELECT ${RECIPIENT_COLUMNS} FROM campaign_recipients WHERE campaign_id = $1 ORDER BY created_at ASC`,
    [campaignId]
  );
  return result.rows.map(toRecipient);
}

async function updateCampaignRecipientStatus(id, { status, errorMessage, contactId, conversationId }) {
  const result = await getPool().query(
    `UPDATE campaign_recipients SET status = $2, error_message = $3, contact_id = $4, conversation_id = $5, processed_at = now()
     WHERE id = $1
     RETURNING ${RECIPIENT_COLUMNS}`,
    [id, status, errorMessage || null, contactId || null, conversationId || null]
  );
  if (result.rowCount === 0) return null;
  return toRecipient(result.rows[0]);
}

async function incrementCampaignCounter(campaignId, outcome, amount = 1) {
  const column = COUNTER_COLUMNS[outcome];
  await getPool().query(`UPDATE campaigns SET ${column} = ${column} + $2 WHERE id = $1`, [campaignId, amount]);
}

module.exports = {
  createCampaign,
  findCampaignById,
  listCampaigns,
  createCampaignRecipients,
  listCampaignRecipients,
  updateCampaignRecipientStatus,
  incrementCampaignCounter,
};

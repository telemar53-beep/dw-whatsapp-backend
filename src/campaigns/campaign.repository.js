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

// As mesmas colunas prefixadas, para as leituras que fazem JOIN com channels.
// Precisa ser uma constante separada: channels tambem tem id, name e
// created_at, entao a lista sem prefixo sairia ambigua. E CAMPAIGN_COLUMNS nao
// pode ganhar prefixo porque e o RETURNING do INSERT de createCampaign.
const CAMPAIGN_COLUMNS_JOINED = CAMPAIGN_COLUMNS.split(', ').map((column) => `c.${column}`).join(', ');

// O nome do canal sai do JOIN e e espalhado aqui, fora de toCampaign, para que
// o caminho de escrita (que nao tem o JOIN) continue exatamente como estava.
function toCampaignWithChannel(row) {
  return { ...toCampaign(row), channelName: row.channel_name };
}

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

// LEFT JOIN de proposito: channel_id e NOT NULL com FK, mas um INNER faria uma
// campanha sumir da lista se algo ficasse inconsistente, e some sem aviso e
// pior do que nome vazio.
const CAMPAIGN_FROM_JOINED = `FROM campaigns c LEFT JOIN channels ch ON ch.id = c.channel_id`;

// created_at nao e unico: duas campanhas criadas no mesmo instante empatam e a
// ordem passa a ser indefinida, o que quebraria a paginacao. O id desempata.
const CAMPAIGN_ORDER = `ORDER BY c.created_at DESC, c.id DESC`;

async function findCampaignById(id) {
  const result = await getPool().query(
    `SELECT ${CAMPAIGN_COLUMNS_JOINED}, ch.name AS channel_name ${CAMPAIGN_FROM_JOINED} WHERE c.id = $1`,
    [id]
  );
  if (result.rowCount === 0) return null;
  return toCampaignWithChannel(result.rows[0]);
}

async function listCampaigns() {
  const result = await getPool().query(
    `SELECT ${CAMPAIGN_COLUMNS_JOINED}, ch.name AS channel_name ${CAMPAIGN_FROM_JOINED} ${CAMPAIGN_ORDER}`
  );
  return result.rows.map(toCampaignWithChannel);
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

async function deleteCampaign(id) {
  await getPool().query('DELETE FROM campaigns WHERE id = $1', [id]);
}

module.exports = {
  createCampaign,
  findCampaignById,
  listCampaigns,
  createCampaignRecipients,
  listCampaignRecipients,
  updateCampaignRecipientStatus,
  incrementCampaignCounter,
  deleteCampaign,
};

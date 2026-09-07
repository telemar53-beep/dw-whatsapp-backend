const { findChannelById, findChannelByWabaId } = require('../channels/channel.repository');
const {
  listTemplates,
  listApprovedTemplatesByWabaId,
  findTemplateById,
  findTemplateByMetaTemplateId,
  createTemplateRecord,
  updateTemplateStatusByMetaTemplateId,
  deleteTemplateRecord,
} = require('./template.repository');
const { isValidTemplateName, extractVariableCount } = require('./template-validator');
const metaCloudAdapter = require('../whatsapp-adapters/meta-cloud.adapter');

const CATEGORIES = ['MARKETING', 'UTILITY'];
const KNOWN_STATUSES = new Set(['PENDING', 'APPROVED', 'REJECTED', 'PAUSED', 'DISABLED']);

class TemplateValidationError extends Error {}

async function createTemplate({ channelId, name, category, language, bodyText }) {
  if (!isValidTemplateName(name)) {
    throw new TemplateValidationError('Template name must contain only lowercase letters, numbers, and underscores');
  }
  if (!CATEGORIES.includes(category)) {
    throw new TemplateValidationError('category must be MARKETING or UTILITY');
  }
  if (!language) {
    throw new TemplateValidationError('language is required');
  }
  if (!bodyText) {
    throw new TemplateValidationError('bodyText is required');
  }
  const variableCount = extractVariableCount(bodyText);

  const channel = await findChannelById(channelId);
  if (!channel || channel.type !== 'meta_cloud') {
    throw new TemplateValidationError('channelId must reference a meta_cloud channel');
  }
  if (!channel.config.wabaId) {
    throw new TemplateValidationError('This channel has no WABA configured yet');
  }

  const { metaTemplateId } = await metaCloudAdapter.createMetaTemplate(channel, { name, category, language, bodyText });

  return createTemplateRecord({ wabaId: channel.config.wabaId, metaTemplateId, name, language, category, bodyText, variableCount });
}

async function listApprovedTemplatesForChannel(channelId) {
  const channel = await findChannelById(channelId);
  if (!channel || !channel.config.wabaId) return [];
  return listApprovedTemplatesByWabaId(channel.config.wabaId);
}

async function deleteTemplate(id) {
  const template = await findTemplateById(id);
  if (!template) return false;
  const channel = await findChannelByWabaId(template.wabaId);
  if (channel) {
    await metaCloudAdapter.deleteMetaTemplate(channel, { name: template.name, metaTemplateId: template.metaTemplateId });
  }
  return deleteTemplateRecord(id);
}

async function syncTemplatesForWaba(wabaId) {
  const channel = await findChannelByWabaId(wabaId);
  if (!channel) {
    throw new TemplateValidationError('No channel found for this WABA');
  }
  const metaTemplates = await metaCloudAdapter.listMetaTemplates(channel);
  for (const metaTemplate of metaTemplates) {
    if (!KNOWN_STATUSES.has(metaTemplate.status)) {
      console.warn(`Ignoring unknown template status "${metaTemplate.status}" for meta_template_id ${metaTemplate.id}`);
      continue;
    }
    await updateTemplateStatusByMetaTemplateId(String(metaTemplate.id), { status: metaTemplate.status, rejectionReason: null });
  }
  return listTemplates();
}

async function applyTemplateStatusUpdates(webhookBody) {
  const updates = metaCloudAdapter.parseTemplateStatusUpdates(webhookBody);
  for (const update of updates) {
    if (!KNOWN_STATUSES.has(update.event)) {
      console.warn(`Ignoring unknown template status event "${update.event}" for meta_template_id ${update.metaTemplateId}`);
      continue;
    }
    const existing = await findTemplateByMetaTemplateId(update.metaTemplateId);
    if (!existing) {
      console.warn(`Received status update for unknown template id ${update.metaTemplateId}`);
      continue;
    }
    await updateTemplateStatusByMetaTemplateId(update.metaTemplateId, { status: update.event, rejectionReason: update.reason });
  }
}

module.exports = {
  createTemplate,
  listApprovedTemplatesForChannel,
  deleteTemplate,
  syncTemplatesForWaba,
  applyTemplateStatusUpdates,
  TemplateValidationError,
};

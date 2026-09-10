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
const threeSixtyDialogAdapter = require('../whatsapp-adapters/three-sixty-dialog.adapter');
const { isOfficialChannelType } = require('../channels/channel-types');

const ADAPTERS_BY_CHANNEL_TYPE = {
  meta_cloud: metaCloudAdapter,
  '360dialog': threeSixtyDialogAdapter,
};

const CATEGORIES = ['MARKETING', 'UTILITY'];
const HEADER_TYPES = ['document', 'image', 'video'];
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
  let variableCount;
  try {
    variableCount = extractVariableCount(bodyText);
  } catch (err) {
    throw new TemplateValidationError(err.message);
  }

  const channel = await findChannelById(channelId);
  if (!channel || !isOfficialChannelType(channel.type)) {
    throw new TemplateValidationError('channelId must reference an official channel (meta_cloud or 360dialog)');
  }
  if (!channel.config.wabaId) {
    throw new TemplateValidationError('This channel has no WABA configured yet');
  }

  const { metaTemplateId } = await ADAPTERS_BY_CHANNEL_TYPE[channel.type].createMetaTemplate(channel, { name, category, language, bodyText });

  try {
    return await createTemplateRecord({ wabaId: channel.config.wabaId, metaTemplateId, name, language, category, bodyText, variableCount });
  } catch (err) {
    try {
      await ADAPTERS_BY_CHANNEL_TYPE[channel.type].deleteMetaTemplate(channel, { name, metaTemplateId });
    } catch (rollbackErr) {
      console.warn(`Failed to roll back orphaned Meta template ${metaTemplateId} after a local insert failure`, rollbackErr.message);
    }
    throw err;
  }
}

async function registerExistingTemplate({ channelId, name, language, headerType }) {
  if (!isValidTemplateName(name)) {
    throw new TemplateValidationError('Template name must contain only lowercase letters, numbers, and underscores');
  }
  if (!language) {
    throw new TemplateValidationError('language is required');
  }
  if (headerType && !HEADER_TYPES.includes(headerType)) {
    throw new TemplateValidationError('headerType must be document, image, or video');
  }

  const channel = await findChannelById(channelId);
  if (!channel || !isOfficialChannelType(channel.type)) {
    throw new TemplateValidationError('channelId must reference an official channel (meta_cloud or 360dialog)');
  }
  if (!channel.config.wabaId) {
    throw new TemplateValidationError('This channel has no WABA configured yet');
  }

  const metaTemplates = await ADAPTERS_BY_CHANNEL_TYPE[channel.type].listMetaTemplates(channel);
  const match = metaTemplates.find((t) => t.name === name && t.language === language);
  if (!match) {
    throw new TemplateValidationError('No template with this name and language was found for this WABA');
  }

  const bodyComponent = (match.components || []).find((c) => c.type === 'BODY');
  if (!bodyComponent || !bodyComponent.text) {
    throw new TemplateValidationError('The matched template has no body text to register');
  }

  let variableCount;
  try {
    variableCount = extractVariableCount(bodyComponent.text);
  } catch (err) {
    throw new TemplateValidationError(err.message);
  }

  const created = await createTemplateRecord({
    wabaId: channel.config.wabaId,
    metaTemplateId: String(match.id),
    name,
    language,
    category: match.category,
    bodyText: bodyComponent.text,
    variableCount,
    headerType: headerType || null,
  });
  // The row lands on the DB default 'PENDING'; adopt the real Meta status so an already-approved
  // template is immediately usable by the approved-template pickers and by POST /conversations/start.
  if (KNOWN_STATUSES.has(match.status)) {
    return updateTemplateStatusByMetaTemplateId(created.metaTemplateId, { status: match.status, rejectionReason: match.rejected_reason || null });
  }
  console.warn(`Ignoring unknown template status "${match.status}" for meta_template_id ${match.id}`);
  return created;
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
    try {
      await ADAPTERS_BY_CHANNEL_TYPE[channel.type].deleteMetaTemplate(channel, { name: template.name, metaTemplateId: template.metaTemplateId });
    } catch (err) {
      console.warn(`Failed to delete template ${template.metaTemplateId} from Meta; deleting local record anyway`, err.message);
    }
  }
  return deleteTemplateRecord(id);
}

async function syncTemplatesForWaba(wabaId) {
  const channel = await findChannelByWabaId(wabaId);
  if (!channel) {
    throw new TemplateValidationError('No channel found for this WABA');
  }
  const metaTemplates = await ADAPTERS_BY_CHANNEL_TYPE[channel.type].listMetaTemplates(channel);
  for (const metaTemplate of metaTemplates) {
    if (!KNOWN_STATUSES.has(metaTemplate.status)) {
      console.warn(`Ignoring unknown template status "${metaTemplate.status}" for meta_template_id ${metaTemplate.id}`);
      continue;
    }
    await updateTemplateStatusByMetaTemplateId(String(metaTemplate.id), { status: metaTemplate.status, rejectionReason: metaTemplate.rejected_reason || null });
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
  registerExistingTemplate,
  TemplateValidationError,
};

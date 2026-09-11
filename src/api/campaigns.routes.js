const express = require('express');
const { requireAuth } = require('../auth/auth.middleware');
const { findChannelById } = require('../channels/channel.repository');
const { findTemplateById } = require('../templates/template.repository');
const { substituteVariables } = require('../templates/template-validator');
const { isOfficialChannelType } = require('../channels/channel-types');
const {
  createCampaign,
  findCampaignById,
  listCampaigns,
  createCampaignRecipients,
  listCampaignRecipients,
  updateCampaignRecipientStatus,
  incrementCampaignCounter,
} = require('../campaigns/campaign.repository');
const { enqueueCampaignRecipient } = require('../queue/campaign-queue');

const router = express.Router();
router.use(requireAuth);

function parseRecipients(raw) {
  const lines = (raw || '').split('\n').map((line) => line.trim()).filter(Boolean);
  const seen = new Set();
  const parsed = [];
  for (const line of lines) {
    const [phonePart, ...nameParts] = line.split(',');
    const rawPhoneNumber = (phonePart || '').trim();
    const phoneNumber = rawPhoneNumber.replace(/\D/g, '');
    const displayName = nameParts.join(',').trim() || null;
    if (!phoneNumber) {
      parsed.push({ rawPhoneNumber, phoneNumber: '', displayName, status: 'failed', errorMessage: 'Número inválido' });
      continue;
    }
    if (seen.has(phoneNumber)) continue;
    seen.add(phoneNumber);
    parsed.push({ rawPhoneNumber, phoneNumber, displayName, status: 'pending' });
  }
  return parsed;
}

router.post('/', async (req, res) => {
  const { name, channelId, content, templateId, templateVariables, recipients } = req.body || {};
  if (!channelId) {
    return res.status(400).json({ error: 'channelId is required' });
  }

  let channel;
  try {
    channel = await findChannelById(channelId);
  } catch (err) {
    if (err.code === '22P02') {
      return res.status(404).json({ error: 'Channel not found' });
    }
    throw err;
  }
  if (!channel) {
    return res.status(404).json({ error: 'Channel not found' });
  }
  if (channel.type !== 'baileys' && !isOfficialChannelType(channel.type)) {
    return res.status(400).json({ error: 'Unsupported channel type' });
  }

  const parsedRecipients = parseRecipients(recipients);
  if (!parsedRecipients.some((r) => r.status === 'pending')) {
    return res.status(400).json({ error: 'No valid recipient found in the list' });
  }

  let messageType;
  let finalContent;
  let templateName = null;
  let templateLanguage = null;
  let finalTemplateVariables = null;

  if (channel.type === 'baileys') {
    if (!content) {
      return res.status(400).json({ error: 'content is required' });
    }
    messageType = 'text';
    finalContent = content;
  } else {
    if (!templateId) {
      return res.status(400).json({ error: 'templateId is required' });
    }
    const template = await findTemplateById(templateId);
    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }
    if (template.status !== 'APPROVED') {
      return res.status(400).json({ error: 'This template is not approved' });
    }
    if (template.wabaId !== channel.config.wabaId) {
      return res.status(400).json({ error: "This template does not belong to this channel's WABA" });
    }
    const variables = Array.isArray(templateVariables) ? templateVariables : [];
    if (variables.length !== template.variableCount) {
      return res.status(400).json({ error: `This template requires exactly ${template.variableCount} variable(s)` });
    }
    if (variables.some((v) => typeof v !== 'string' || !v.trim())) {
      return res.status(400).json({ error: 'Each template variable must be a non-empty string' });
    }
    messageType = 'template';
    finalContent = substituteVariables(template.bodyText, variables);
    templateName = template.name;
    templateLanguage = template.language;
    finalTemplateVariables = variables;
  }

  const campaign = await createCampaign({
    name,
    channelId: channel.id,
    messageType,
    content: finalContent,
    templateName,
    templateLanguage,
    templateVariables: finalTemplateVariables,
    createdBy: req.agent.agentId,
    totalRecipients: parsedRecipients.length,
  });

  const createdRecipients = await createCampaignRecipients(campaign.id, parsedRecipients);

  const preFailedCount = createdRecipients.filter((r) => r.status === 'failed').length;
  if (preFailedCount > 0) {
    await incrementCampaignCounter(campaign.id, 'failed', preFailedCount);
  }

  createdRecipients
    .filter((r) => r.status === 'pending')
    .forEach((r) => {
      enqueueCampaignRecipient({
        recipientId: r.id,
        campaignId: campaign.id,
        channelId: channel.id,
        phoneNumber: r.phoneNumber,
        displayName: r.displayName,
        content: finalContent,
        templateName,
        templateLanguage,
        templateVariables: finalTemplateVariables,
      }).catch(async (err) => {
        console.error(`Failed to enqueue campaign recipient ${r.id}`, err);
        try {
          await updateCampaignRecipientStatus(r.id, { status: 'failed', errorMessage: err.message });
          await incrementCampaignCounter(campaign.id, 'failed');
        } catch (recoveryErr) {
          console.error(`Failed to record enqueue failure for campaign recipient ${r.id}`, recoveryErr);
        }
      });
    });

  res.status(201).json(campaign);
});

router.get('/', async (req, res) => {
  const campaigns = await listCampaigns();
  res.json(campaigns);
});

router.get('/:id', async (req, res) => {
  const campaign = await findCampaignById(req.params.id);
  if (!campaign) {
    return res.status(404).json({ error: 'Campaign not found' });
  }
  const recipients = await listCampaignRecipients(campaign.id);
  res.json({ ...campaign, recipients });
});

module.exports = router;

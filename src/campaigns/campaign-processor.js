const { findChannelById } = require('../channels/channel.repository');
const { findOrCreateContactByPhoneNumber } = require('../conversations/contact.repository');
const { findOpenConversation, createConversation } = require('../conversations/conversation.repository');
const { enqueueOutboundMessage } = require('../queue/outbound-queue');
const baileysManager = require('../whatsapp-adapters/baileys.manager');
const { updateCampaignRecipientStatus, incrementCampaignCounter } = require('./campaign.repository');

async function markRecipient(recipientId, campaignId, outcome, extra = {}) {
  await updateCampaignRecipientStatus(recipientId, { status: outcome, ...extra });
  await incrementCampaignCounter(campaignId, outcome);
}

async function processCampaignRecipient({ recipientId, campaignId, channelId, phoneNumber, displayName, content, templateName, templateLanguage, templateVariables }) {
  const channel = await findChannelById(channelId);
  if (!channel) {
    return markRecipient(recipientId, campaignId, 'failed', { errorMessage: 'Canal não encontrado' });
  }

  try {
    let canonicalPhoneNumber = phoneNumber;
    if (channel.type === 'baileys') {
      canonicalPhoneNumber = await baileysManager.resolveWhatsAppJid(channel, phoneNumber);
      if (!canonicalPhoneNumber) {
        return markRecipient(recipientId, campaignId, 'failed', { errorMessage: 'Número não está no WhatsApp' });
      }
    }

    const contact = await findOrCreateContactByPhoneNumber(canonicalPhoneNumber, displayName || null);

    const existing = await findOpenConversation(contact.id, channel.id);
    if (existing) {
      return markRecipient(recipientId, campaignId, 'skipped', { errorMessage: 'Já existe conversa em andamento', contactId: contact.id });
    }

    const conversation = await createConversation(contact.id, channel.id);

    try {
      await enqueueOutboundMessage({
        conversationId: conversation.id,
        channelId: channel.id,
        content,
        templateName: templateName || undefined,
        templateLanguage: templateLanguage || undefined,
        templateVariables: templateVariables || undefined,
      });
    } catch (err) {
      return markRecipient(recipientId, campaignId, 'failed', { errorMessage: err.message, contactId: contact.id, conversationId: conversation.id });
    }

    return markRecipient(recipientId, campaignId, 'sent', { contactId: contact.id, conversationId: conversation.id });
  } catch (err) {
    return markRecipient(recipientId, campaignId, 'failed', { errorMessage: err.message });
  }
}

module.exports = { processCampaignRecipient };

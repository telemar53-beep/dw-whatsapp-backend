const express = require('express');
const { verifySgpApiKey, findSgpDispatchByReferenceId, createSgpDispatch } = require('../integrations/sgp-integration.repository');
const { parseSgpTemplatePayload, SgpTemplatePayloadError } = require('../integrations/sgp-template-payload-parser');
const { findChannelById } = require('../channels/channel.repository');
const { findTemplateByNameAndWaba } = require('../templates/template.repository');
const { findOrCreateContactByPhoneNumber } = require('../conversations/contact.repository');
const { findOpenConversation, createConversation, getConversationWithContact } = require('../conversations/conversation.repository');
const { enqueueOutboundMessage } = require('../queue/outbound-queue');
const { emitToAgent } = require('../realtime/socket-server');
const baileysManager = require('../whatsapp-adapters/baileys.manager');

const router = express.Router();
const UNIQUE_VIOLATION = '23505';

async function requireSgpApiKey(req, res, next) {
  const apiKey = typeof req.query.token === 'string' ? req.query.token : null;
  if (!apiKey) {
    return res.status(401).json({ error: 'Missing token' });
  }
  const verification = await verifySgpApiKey(apiKey);
  if (verification.status === 'not_configured') {
    return res.status(400).json({ error: 'SGP integration is not configured' });
  }
  if (verification.status === 'disabled') {
    return res.status(400).json({ error: 'SGP integration is not enabled' });
  }
  if (verification.status === 'invalid') {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  req.sgpChannelId = verification.channelId;
  req.sgpMode = verification.mode;
  next();
}

router.get('/messages', requireSgpApiKey, async (req, res) => {
  const { phoneNumber, content, referenceId } = req.query;
  if (typeof phoneNumber !== 'string' || !phoneNumber.trim()) {
    return res.status(400).json({ error: 'phoneNumber is required' });
  }
  if (typeof content !== 'string' || !content.trim()) {
    return res.status(400).json({ error: 'content is required' });
  }
  const hasReferenceId = typeof referenceId === 'string' && referenceId.trim().length > 0;

  if (hasReferenceId) {
    const existingDispatch = await findSgpDispatchByReferenceId(referenceId);
    if (existingDispatch) {
      return res.status(200).json({
        conversationId: existingDispatch.conversationId,
        messageId: existingDispatch.messageId,
        duplicate: true,
      });
    }
  }

  const channel = await findChannelById(req.sgpChannelId);
  if (!channel) {
    return res.status(400).json({ error: 'The configured channel no longer exists' });
  }

  let canonicalPhoneNumber;
  let outboundPayload;

  if (req.sgpMode === 'template') {
    const normalizedPhoneNumber = phoneNumber.replace(/\D/g, '');
    if (!normalizedPhoneNumber) {
      return res.status(400).json({ error: 'A valid phoneNumber is required' });
    }
    canonicalPhoneNumber = normalizedPhoneNumber;

    let payload;
    try {
      payload = parseSgpTemplatePayload(content);
    } catch (err) {
      if (err instanceof SgpTemplatePayloadError) {
        return res.status(400).json({ error: err.message });
      }
      throw err;
    }

    const template = await findTemplateByNameAndWaba(payload.templateName, channel.config.wabaId);
    if (!template) {
      return res.status(400).json({ error: `Template "${payload.templateName}" not found for this channel` });
    }
    if (payload.variables.length !== template.variableCount) {
      return res.status(400).json({ error: `Template "${template.name}" requires exactly ${template.variableCount} variable(s)` });
    }
    if ((payload.headerType || null) !== (template.headerType || null)) {
      return res.status(400).json({ error: `Template "${template.name}" header type mismatch` });
    }

    outboundPayload = {
      content: null,
      templateName: template.name,
      templateLanguage: template.language,
      templateVariables: payload.variables,
      headerType: payload.headerType,
      headerLink: payload.headerLink,
    };
  } else {
    if (channel.status !== 'connected') {
      return res.status(400).json({ error: 'The configured channel is not connected' });
    }
    const normalizedPhoneNumber = phoneNumber.replace(/\D/g, '');
    if (!normalizedPhoneNumber) {
      return res.status(400).json({ error: 'A valid phoneNumber is required' });
    }
    canonicalPhoneNumber = await baileysManager.resolveWhatsAppJid(channel, normalizedPhoneNumber);
    if (!canonicalPhoneNumber) {
      return res.status(400).json({ error: 'This phone number is not on WhatsApp' });
    }
    outboundPayload = { content };
  }

  const contact = await findOrCreateContactByPhoneNumber(canonicalPhoneNumber, null);

  let conversation = await findOpenConversation(contact.id, channel.id);
  if (!conversation) {
    try {
      conversation = await createConversation(contact.id, channel.id, null, 'silent');
    } catch (err) {
      if (err.code !== UNIQUE_VIOLATION) throw err;
      conversation = await findOpenConversation(contact.id, channel.id);
    }
  }

  const message = await enqueueOutboundMessage({ conversationId: conversation.id, channelId: channel.id, ...outboundPayload });

  if (conversation.assignedAgentId) {
    const conversationWithContact = await getConversationWithContact(conversation.id);
    emitToAgent(conversation.assignedAgentId, 'message:new', { conversation: conversationWithContact, message });
  }

  if (hasReferenceId) {
    try {
      await createSgpDispatch({ referenceId, conversationId: conversation.id, messageId: message.id });
    } catch (err) {
      if (err.code !== UNIQUE_VIOLATION) throw err;
    }
  }

  res.status(200).json({ conversationId: conversation.id, messageId: message.id });
});

module.exports = router;

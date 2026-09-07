const express = require('express');
const { verifySgpApiKey, findSgpDispatchByReferenceId, createSgpDispatch } = require('../integrations/sgp-integration.repository');
const { findChannelById } = require('../channels/channel.repository');
const { findOrCreateContactByPhoneNumber } = require('../conversations/contact.repository');
const { findOpenConversation, createConversation, getConversationWithContact } = require('../conversations/conversation.repository');
const { enqueueOutboundMessage } = require('../queue/outbound-queue');
const { emitToAgent } = require('../realtime/socket-server');
const baileysManager = require('../whatsapp-adapters/baileys.manager');

const router = express.Router();
const UNIQUE_VIOLATION = '23505';

async function requireSgpApiKey(req, res, next) {
  const header = req.headers.authorization;
  const apiKey = header && header.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
  if (!apiKey) {
    return res.status(401).json({ error: 'Missing authorization token' });
  }
  const verification = await verifySgpApiKey(apiKey);
  if (verification.status === 'not_configured') {
    return res.status(400).json({ error: 'SGP integration is not configured' });
  }
  if (verification.status === 'disabled') {
    return res.status(400).json({ error: 'SGP integration is not enabled' });
  }
  if (verification.status === 'no_key') {
    return res.status(400).json({ error: 'No API key has been generated for the SGP integration yet' });
  }
  if (verification.status === 'invalid') {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  req.sgpChannelId = verification.channelId;
  next();
}

router.post('/messages', requireSgpApiKey, async (req, res) => {
  const { phoneNumber, content, referenceId } = req.body || {};
  if (typeof phoneNumber !== 'string' || !phoneNumber.trim()) {
    return res.status(400).json({ error: 'phoneNumber is required' });
  }
  if (typeof content !== 'string' || !content.trim()) {
    return res.status(400).json({ error: 'content is required' });
  }
  if (typeof referenceId !== 'string' || !referenceId.trim()) {
    return res.status(400).json({ error: 'referenceId is required' });
  }

  const existingDispatch = await findSgpDispatchByReferenceId(referenceId);
  if (existingDispatch) {
    return res.status(200).json({
      conversationId: existingDispatch.conversationId,
      messageId: existingDispatch.messageId,
      duplicate: true,
    });
  }

  const channel = await findChannelById(req.sgpChannelId);
  if (!channel || channel.status !== 'connected') {
    return res.status(400).json({ error: 'The configured channel is not connected' });
  }

  const normalizedPhoneNumber = phoneNumber.replace(/\D/g, '');
  if (!normalizedPhoneNumber) {
    return res.status(400).json({ error: 'A valid phoneNumber is required' });
  }
  const canonicalPhoneNumber = await baileysManager.resolveWhatsAppJid(channel, normalizedPhoneNumber);
  if (!canonicalPhoneNumber) {
    return res.status(400).json({ error: 'This phone number is not on WhatsApp' });
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

  const message = await enqueueOutboundMessage({ conversationId: conversation.id, channelId: channel.id, content });

  if (conversation.assignedAgentId) {
    const conversationWithContact = await getConversationWithContact(conversation.id);
    emitToAgent(conversation.assignedAgentId, 'message:new', { conversation: conversationWithContact, message });
  }

  let dispatch;
  try {
    dispatch = await createSgpDispatch({ referenceId, conversationId: conversation.id, messageId: message.id });
  } catch (err) {
    if (err.code !== UNIQUE_VIOLATION) throw err;
    dispatch = await findSgpDispatchByReferenceId(referenceId);
  }

  res.status(202).json({ conversationId: dispatch.conversationId, messageId: dispatch.messageId });
});

module.exports = router;

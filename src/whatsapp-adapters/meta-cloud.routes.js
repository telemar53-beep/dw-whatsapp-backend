const express = require('express');
const { loadConfig } = require('../config/env');
const { verifyWebhookChallenge, verifySignature, parseInboundMessages } = require('./meta-cloud.adapter');
const { findChannelByMetaPhoneNumberId } = require('../channels/channel.repository');
const { ingestInboundMessage } = require('../conversations/inbound-message.service');
const { emitToAgent, broadcast } = require('../realtime/socket-server');

const router = express.Router();

router.get('/meta', (req, res) => {
  const config = loadConfig();
  const challenge = verifyWebhookChallenge(req.query, config.metaVerifyToken);
  if (challenge === null) {
    return res.sendStatus(403);
  }
  res.status(200).send(challenge);
});

router.post('/meta', async (req, res) => {
  const config = loadConfig();
  const signature = req.headers['x-hub-signature-256'];
  if (!req.rawBody || !verifySignature(req.rawBody, signature, config.metaAppSecret)) {
    return res.sendStatus(403);
  }

  const inboundMessages = parseInboundMessages(req.body);
  for (const inboundMessage of inboundMessages) {
    try {
      const channel = await findChannelByMetaPhoneNumberId(inboundMessage.metaPhoneNumberId);
      if (!channel) {
        continue;
      }
      const result = await ingestInboundMessage({
        channelId: channel.id,
        fromPhoneNumber: inboundMessage.fromPhoneNumber,
        contactDisplayName: inboundMessage.contactDisplayName,
        whatsappMessageId: inboundMessage.whatsappMessageId,
        content: inboundMessage.content,
      });
      if (result.message) {
        if (result.conversation.assignedAgentId) {
          emitToAgent(result.conversation.assignedAgentId, 'message:new', {
            conversation: result.conversation,
            message: result.message,
          });
        } else {
          broadcast('queue:new', {
            conversation: result.conversation,
            message: result.message,
          });
        }
      }
    } catch (err) {
      console.error('Failed to process inbound WhatsApp message', err);
    }
  }
  res.sendStatus(200);
});

module.exports = router;

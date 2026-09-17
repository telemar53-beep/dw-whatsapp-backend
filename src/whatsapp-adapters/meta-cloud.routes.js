const express = require('express');
const { loadConfig } = require('../config/env');
const { verifyWebhookChallenge, verifySignature, parseInboundMessages, downloadMetaMedia } = require('./meta-cloud.adapter');
const { findChannelByMetaPhoneNumberId } = require('../channels/channel.repository');
const { ingestInboundMessage } = require('../conversations/inbound-message.service');
const { applyTemplateStatusUpdates } = require('../templates/template.service');
const { applyMessageStatusUpdates } = require('../conversations/message-status.service');
const { saveInboundMedia, extensionForMimeType } = require('../media/media-storage');

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
    // Sem este aviso, um META_APP_SECRET errado derruba 100% das mensagens do
    // canal oficial em silencio: o sintoma visivel e so "o canal nao recebe".
    // O corpo nao entra no log — ele carrega a mensagem e o telefone do cliente.
    console.warn(
      'Webhook da Meta rejeitado: assinatura invalida. Confira se o META_APP_SECRET e a chave secreta do app da Meta.'
    );
    return res.sendStatus(403);
  }

  const inboundMessages = parseInboundMessages(req.body);
  for (const inboundMessage of inboundMessages) {
    try {
      const channel = await findChannelByMetaPhoneNumberId(inboundMessage.metaPhoneNumberId);
      if (!channel) {
        console.warn(
          `Webhook da Meta descartado: nenhum canal cadastrado com o Phone Number ID ${inboundMessage.metaPhoneNumberId}.`
        );
        continue;
      }
      if (channel.hidden) {
        console.warn(
          `Webhook da Meta descartado: o canal "${channel.name}" (Phone Number ID ${inboundMessage.metaPhoneNumberId}) esta oculto.`
        );
        continue;
      }
      let mediaPath;
      if (inboundMessage.mediaId) {
        const buffer = await downloadMetaMedia(inboundMessage.mediaId, channel.config.accessToken);
        ({ mediaPath } = await saveInboundMedia(buffer, inboundMessage.mediaMimeType));
      }
      await ingestInboundMessage({
        channelId: channel.id,
        fromPhoneNumber: inboundMessage.fromPhoneNumber,
        contactDisplayName: inboundMessage.contactDisplayName,
        whatsappMessageId: inboundMessage.whatsappMessageId,
        messageType: inboundMessage.messageType,
        content: inboundMessage.content,
        mediaPath,
        mediaMimeType: inboundMessage.mediaMimeType,
        mediaFilename: inboundMessage.mediaFilename,
        locationLatitude: inboundMessage.latitude,
        locationLongitude: inboundMessage.longitude,
        repliedToWhatsappMessageId: inboundMessage.repliedToWhatsappMessageId,
        sentAt: inboundMessage.sentAt,
      });
    } catch (err) {
      console.error('Failed to process inbound WhatsApp message', err);
    }
  }
  try {
    await applyTemplateStatusUpdates(req.body);
  } catch (err) {
    console.error('Failed to process template status update webhook', err);
  }
  try {
    await applyMessageStatusUpdates(req.body);
  } catch (err) {
    console.error('Failed to process message status update webhook', err);
  }
  res.sendStatus(200);
});

module.exports = router;

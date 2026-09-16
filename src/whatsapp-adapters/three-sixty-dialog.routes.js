const express = require('express');
const threeSixtyDialogAdapter = require('./three-sixty-dialog.adapter');
const { findChannelByWebhookToken } = require('../channels/channel.repository');
const { ingestInboundMessage } = require('../conversations/inbound-message.service');
const { applyTemplateStatusUpdates } = require('../templates/template.service');
const { applyMessageStatusUpdates } = require('../conversations/message-status.service');
const { saveMediaFile, extensionForMimeType } = require('../media/media-storage');
const { mensagemSegura } = require('../ai/safe-error-log');

const router = express.Router();

router.post('/360dialog/:webhookToken', async (req, res) => {
  const channel = await findChannelByWebhookToken(req.params.webhookToken);
  if (!channel || channel.hidden) {
    return res.sendStatus(404);
  }

  const inboundMessages = threeSixtyDialogAdapter.parseInboundMessages(req.body);
  for (const inboundMessage of inboundMessages) {
    try {
      let mediaPath;
      if (inboundMessage.mediaId) {
        const buffer = await threeSixtyDialogAdapter.downloadMedia(inboundMessage.mediaId, channel);
        mediaPath = await saveMediaFile(buffer, extensionForMimeType(inboundMessage.mediaMimeType));
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
      });
    } catch (err) {
      // Só a mensagem e o status HTTP: o erro cru do axios carrega os
      // cabeçalhos da requisição, com a D360-API-KEY dentro.
      const status = err && err.response && err.response.status;
      console.error(`Failed to process inbound 360dialog message: ${mensagemSegura(err)}${status ? ` status=${status}` : ''}`);
    }
  }
  try {
    await applyTemplateStatusUpdates(req.body);
  } catch (err) {
    console.error('Failed to process 360dialog template status update webhook', err);
  }
  try {
    await applyMessageStatusUpdates(req.body);
  } catch (err) {
    console.error('Failed to process 360dialog message status update webhook', err);
  }
  res.sendStatus(200);
});

module.exports = router;

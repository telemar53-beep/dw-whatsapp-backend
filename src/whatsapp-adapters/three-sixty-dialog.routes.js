const express = require('express');
const threeSixtyDialogAdapter = require('./three-sixty-dialog.adapter');
const { findChannelByWebhookToken } = require('../channels/channel.repository');
const { ingestInboundMessage } = require('../conversations/inbound-message.service');
const { applyTemplateStatusUpdates } = require('../templates/template.service');
const { applyMessageStatusUpdates } = require('../conversations/message-status.service');
const { saveMediaFile, extensionForMimeType } = require('../media/media-storage');

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
      });
    } catch (err) {
      console.error('Failed to process inbound 360dialog message', err);
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

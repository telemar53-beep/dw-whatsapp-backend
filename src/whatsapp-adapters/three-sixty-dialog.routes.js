const express = require('express');
const threeSixtyDialogAdapter = require('./three-sixty-dialog.adapter');
const { findChannelByWebhookToken } = require('../channels/channel.repository');
const { ingestInboundMessage } = require('../conversations/inbound-message.service');
const { applyTemplateStatusUpdates } = require('../templates/template.service');
const { applyMessageStatusUpdates } = require('../conversations/message-status.service');
const { saveInboundMedia, extensionForMimeType } = require('../media/media-storage');
const { mensagemSegura } = require('../ai/safe-error-log');

const router = express.Router();

router.post('/360dialog/:webhookToken', async (req, res) => {
  const channel = await findChannelByWebhookToken(req.params.webhookToken);
  // O 404 mudo daqui e o mesmo tipo de armadilha que o webhook da Meta tinha:
  // um token perdido ou um canal ocultado sem querer derrubam todas as
  // mensagens sem deixar rastro. O token nao entra no log — e ele que
  // autentica a chamada.
  if (!channel) {
    console.warn('Webhook 360dialog descartado: nenhum canal corresponde ao token recebido.');
    return res.sendStatus(404);
  }
  if (channel.hidden) {
    console.warn(`Webhook 360dialog descartado: o canal "${channel.name}" esta oculto.`);
    return res.sendStatus(404);
  }

  const inboundMessages = threeSixtyDialogAdapter.parseInboundMessages(req.body);
  for (const inboundMessage of inboundMessages) {
    try {
      let mediaPath;
      if (inboundMessage.mediaId) {
        const buffer = await threeSixtyDialogAdapter.downloadMedia(inboundMessage.mediaId, channel);
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
        sentAtRaw: inboundMessage.sentAtRaw,
        // O 360dialog reusa o parseInboundMessages da Meta, então a origem não
        // dá para deduzir do formato: quem sabe por qual webhook a mensagem
        // entrou é esta rota.
        timestampSource: '360dialog',
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

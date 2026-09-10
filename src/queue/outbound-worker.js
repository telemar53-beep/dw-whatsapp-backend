const { processOutboundQueue, enqueueOutboundMessage } = require('./outbound-queue');
const { findChannelById } = require('../channels/channel.repository');
const { getConversationWithContact } = require('../conversations/conversation.repository');
const { findMessageById, updateMessageStatus, recordMessageSent } = require('../conversations/message.repository');
const metaCloudAdapter = require('../whatsapp-adapters/meta-cloud.adapter');
const baileysManager = require('../whatsapp-adapters/baileys.manager');
const threeSixtyDialogAdapter = require('../whatsapp-adapters/three-sixty-dialog.adapter');
const { emitToAgent } = require('../realtime/socket-server');

const ADAPTERS_BY_CHANNEL_TYPE = {
  meta_cloud: metaCloudAdapter,
  baileys: baileysManager,
  '360dialog': threeSixtyDialogAdapter,
};

const AUDIO_DELIVERY_CHECK_DELAY_MS = 5000;

// Baileys can mark an audio message delivered even when WhatsApp never lets the recipient
// download it - the customer just sees a broken bubble with no signal back to us (see
// verifyMediaDelivery). A few seconds after sending, check whether the file is actually
// retrievable, and if it isn't, resend it automatically so the attendant doesn't have to
// notice a stuck customer and fix it by hand.
async function checkAudioDelivery({ channel, whatsappMessageId, conversation, mediaPath, mediaMimeType, mediaFilename, isVoiceNote }) {
  const result = await baileysManager.verifyMediaDelivery(channel, whatsappMessageId, conversation.contactPhoneNumber);
  if (result.verified !== false) {
    console.log(`Audio delivery check for ${whatsappMessageId}: verified=${result.verified} reason=${result.reason || 'n/a'}`);
    return;
  }
  console.warn(`Audio ${whatsappMessageId} failed delivery verification (${result.reason}); resending automatically`);
  const resent = await enqueueOutboundMessage({
    conversationId: conversation.id,
    channelId: channel.id,
    messageType: 'audio',
    mediaPath,
    mediaMimeType,
    mediaFilename,
    isVoiceNote,
  });
  if (conversation.assignedAgentId) {
    emitToAgent(conversation.assignedAgentId, 'message:new', { conversation, message: resent });
  }
}

function scheduleAudioDeliveryCheck(ctx) {
  setTimeout(() => {
    checkAudioDelivery(ctx).catch((err) => {
      console.error(`Audio delivery check crashed for ${ctx.whatsappMessageId}`, err);
    });
  }, AUDIO_DELIVERY_CHECK_DELAY_MS);
}

function startOutboundWorker() {
  processOutboundQueue(async ({ messageId, conversationId, channelId, content, messageType, mediaPath, mediaMimeType, mediaFilename, isVoiceNote, templateName, templateLanguage, templateVariables, headerType, headerLink, repliedToMessageId }) => {
    const existingMessage = await findMessageById(messageId);
    if (existingMessage && existingMessage.whatsappMessageId) return;
    const conversation = await getConversationWithContact(conversationId);
    const channel = await findChannelById(channelId);
    try {
      const adapter = ADAPTERS_BY_CHANNEL_TYPE[channel.type];

      let replyOptions;
      if (repliedToMessageId) {
        const original = await findMessageById(repliedToMessageId);
        if (original) {
          replyOptions = {
            repliedToWhatsappMessageId: original.whatsappMessageId,
            repliedToDirection: original.direction,
            repliedToContent: original.content,
          };
        }
      }

      const { whatsappMessageId } = templateName
        ? await adapter.sendTemplateMessage(channel, conversation.contactPhoneNumber, {
            name: templateName,
            language: templateLanguage,
            variables: templateVariables || [],
            headerType,
            headerLink,
          })
        : messageType && messageType !== 'text'
          ? await adapter.sendMediaMessage(channel, conversation.contactPhoneNumber, {
              messageType,
              mediaPath,
              mediaMimeType,
              mediaFilename,
              caption: content,
              ...(isVoiceNote ? { isVoiceNote: true } : {}),
              ...(replyOptions || {}),
            })
          : replyOptions
            ? await adapter.sendTextMessage(channel, conversation.contactPhoneNumber, content, replyOptions)
            : await adapter.sendTextMessage(channel, conversation.contactPhoneNumber, content);
      const message = await recordMessageSent(messageId, whatsappMessageId);
      if (conversation.assignedAgentId) {
        emitToAgent(conversation.assignedAgentId, 'message:updated', { conversationId, message });
      }
      if (channel.type === 'baileys' && messageType === 'audio' && whatsappMessageId) {
        scheduleAudioDeliveryCheck({ channel, whatsappMessageId, conversation, mediaPath, mediaMimeType, mediaFilename, isVoiceNote });
      }
    } catch (err) {
      const message = await updateMessageStatus(messageId, 'failed');
      if (conversation.assignedAgentId) {
        emitToAgent(conversation.assignedAgentId, 'message:updated', { conversationId, message });
      }
      throw err;
    }
  });
}

module.exports = { startOutboundWorker };

const { processOutboundQueue } = require('./outbound-queue');
const { findChannelById } = require('../channels/channel.repository');
const { getConversationWithContact } = require('../conversations/conversation.repository');
const { findMessageById, updateMessageStatus, recordMessageSent } = require('../conversations/message.repository');
const metaCloudAdapter = require('../whatsapp-adapters/meta-cloud.adapter');
const baileysManager = require('../whatsapp-adapters/baileys.manager');
const { emitToAgent } = require('../realtime/socket-server');

const ADAPTERS_BY_CHANNEL_TYPE = {
  meta_cloud: metaCloudAdapter,
  baileys: baileysManager,
};

function startOutboundWorker() {
  processOutboundQueue(async ({ messageId, conversationId, channelId, content, messageType, mediaPath, mediaMimeType, mediaFilename, templateName, templateLanguage, templateVariables, headerType, headerLink }) => {
    const existingMessage = await findMessageById(messageId);
    if (existingMessage && existingMessage.whatsappMessageId) return;
    const conversation = await getConversationWithContact(conversationId);
    const channel = await findChannelById(channelId);
    try {
      const adapter = ADAPTERS_BY_CHANNEL_TYPE[channel.type];
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
            })
          : await adapter.sendTextMessage(channel, conversation.contactPhoneNumber, content);
      const message = await recordMessageSent(messageId, whatsappMessageId);
      if (conversation.assignedAgentId) {
        emitToAgent(conversation.assignedAgentId, 'message:updated', { conversationId, message });
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

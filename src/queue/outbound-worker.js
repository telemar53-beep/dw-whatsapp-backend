const { processOutboundQueue } = require('./outbound-queue');
const { findChannelById } = require('../channels/channel.repository');
const { getConversationWithContact } = require('../conversations/conversation.repository');
const { updateMessageStatus, recordMessageSent } = require('../conversations/message.repository');
const metaCloudAdapter = require('../whatsapp-adapters/meta-cloud.adapter');
const baileysManager = require('../whatsapp-adapters/baileys.manager');
const { emitToAgent } = require('../realtime/socket-server');

const ADAPTERS_BY_CHANNEL_TYPE = {
  meta_cloud: metaCloudAdapter,
  baileys: baileysManager,
};

function startOutboundWorker() {
  processOutboundQueue(async ({ messageId, conversationId, channelId, content }) => {
    const conversation = await getConversationWithContact(conversationId);
    const channel = await findChannelById(channelId);
    const adapter = ADAPTERS_BY_CHANNEL_TYPE[channel.type];
    try {
      const { whatsappMessageId } = await adapter.sendTextMessage(channel, conversation.contactPhoneNumber, content);
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

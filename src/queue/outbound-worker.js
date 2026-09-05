const { processOutboundQueue } = require('./outbound-queue');
const { findChannelById } = require('../channels/channel.repository');
const { getConversationWithContact } = require('../conversations/conversation.repository');
const { updateMessageStatus, recordMessageSent } = require('../conversations/message.repository');
const { sendTextMessage } = require('../whatsapp-adapters/meta-cloud.adapter');
const { emitToAgent } = require('../realtime/socket-server');

function startOutboundWorker() {
  processOutboundQueue(async ({ messageId, conversationId, channelId, content }) => {
    const conversation = await getConversationWithContact(conversationId);
    const channel = await findChannelById(channelId);
    try {
      const { whatsappMessageId } = await sendTextMessage(channel, conversation.contactPhoneNumber, content);
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

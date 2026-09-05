const { processOutboundQueue } = require('./outbound-queue');
const { findChannelById } = require('../channels/channel.repository');
const { getConversationWithContact } = require('../conversations/conversation.repository');
const { updateMessageStatus, recordMessageSent } = require('../conversations/message.repository');
const { sendTextMessage } = require('../whatsapp-adapters/meta-cloud.adapter');

function startOutboundWorker() {
  processOutboundQueue(async ({ messageId, conversationId, channelId, content }) => {
    const conversation = await getConversationWithContact(conversationId);
    const channel = await findChannelById(channelId);
    try {
      const { whatsappMessageId } = await sendTextMessage(channel, conversation.contactPhoneNumber, content);
      await recordMessageSent(messageId, whatsappMessageId);
    } catch (err) {
      await updateMessageStatus(messageId, 'failed');
      throw err;
    }
  });
}

module.exports = { startOutboundWorker };

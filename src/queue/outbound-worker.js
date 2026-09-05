const { processOutboundQueue } = require('./outbound-queue');
const { findChannelById } = require('../channels/channel.repository');
const { getConversationWithContact } = require('../conversations/conversation.repository');
const { createMessage, updateMessageStatus, recordMessageSent } = require('../conversations/message.repository');
const { sendTextMessage } = require('../whatsapp-adapters/meta-cloud.adapter');

function startOutboundWorker() {
  processOutboundQueue(async ({ conversationId, channelId, content }) => {
    const conversation = await getConversationWithContact(conversationId);
    const channel = await findChannelById(channelId);
    const message = await createMessage({
      conversationId,
      direction: 'outbound',
      content,
      whatsappMessageId: null,
      status: 'sent',
    });
    try {
      const { whatsappMessageId } = await sendTextMessage(channel, conversation.contactPhoneNumber, content);
      await recordMessageSent(message.id, whatsappMessageId);
    } catch (err) {
      await updateMessageStatus(message.id, 'failed');
      throw err;
    }
  });
}

module.exports = { startOutboundWorker };

const { findOrCreateContactByPhoneNumber } = require('./contact.repository');
const { findOpenConversation, createConversation } = require('./conversation.repository');
const { createMessage } = require('./message.repository');

async function ingestInboundMessage({ channelId, fromPhoneNumber, contactDisplayName, whatsappMessageId, content }) {
  const contact = await findOrCreateContactByPhoneNumber(fromPhoneNumber, contactDisplayName);
  let conversation = await findOpenConversation(contact.id, channelId);
  if (!conversation) {
    conversation = await createConversation(contact.id, channelId);
  }
  const message = await createMessage({
    conversationId: conversation.id,
    direction: 'inbound',
    content,
    whatsappMessageId,
    status: 'received',
  });
  return { contact, conversation, message };
}

module.exports = { ingestInboundMessage };

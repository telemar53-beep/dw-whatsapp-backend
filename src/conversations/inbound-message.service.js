const { findOrCreateContactByPhoneNumber } = require('./contact.repository');
const { findOpenConversation, createConversation } = require('./conversation.repository');
const { createMessage } = require('./message.repository');

const UNIQUE_VIOLATION = '23505';

async function ingestInboundMessage({ channelId, fromPhoneNumber, contactDisplayName, whatsappMessageId, content }) {
  const contact = await findOrCreateContactByPhoneNumber(fromPhoneNumber, contactDisplayName);
  let conversation = await findOpenConversation(contact.id, channelId);
  if (!conversation) {
    try {
      conversation = await createConversation(contact.id, channelId);
    } catch (err) {
      if (err.code !== UNIQUE_VIOLATION) {
        throw err;
      }
      conversation = await findOpenConversation(contact.id, channelId);
    }
  }
  try {
    const message = await createMessage({
      conversationId: conversation.id,
      direction: 'inbound',
      content,
      whatsappMessageId,
      status: 'received',
    });
    return { contact, conversation, message };
  } catch (err) {
    if (err.code !== UNIQUE_VIOLATION) {
      throw err;
    }
    return { contact, conversation, message: null };
  }
}

module.exports = { ingestInboundMessage };

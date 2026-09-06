const { findOrCreateContactByPhoneNumber } = require('./contact.repository');
const { findOpenConversation, createConversation } = require('./conversation.repository');
const { createMessage } = require('./message.repository');
const { emitToAgent, broadcast } = require('../realtime/socket-server');

const UNIQUE_VIOLATION = '23505';

async function ingestInboundMessage({
  channelId,
  fromPhoneNumber,
  contactDisplayName,
  whatsappMessageId,
  content,
  messageType,
  mediaPath,
  mediaMimeType,
  mediaFilename,
  locationLatitude,
  locationLongitude,
}) {
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

  let message;
  try {
    message = await createMessage({
      conversationId: conversation.id,
      direction: 'inbound',
      content,
      whatsappMessageId,
      status: 'received',
      messageType,
      mediaPath,
      mediaMimeType,
      mediaFilename,
      locationLatitude,
      locationLongitude,
    });
  } catch (err) {
    if (err.code !== UNIQUE_VIOLATION) {
      throw err;
    }
    return { contact, conversation, message: null };
  }

  const conversationWithContact = {
    ...conversation,
    contactPhoneNumber: contact.phoneNumber,
    contactDisplayName: contact.displayName,
  };

  if (conversation.assignedAgentId) {
    emitToAgent(conversation.assignedAgentId, 'message:new', { conversation: conversationWithContact, message });
  } else {
    broadcast('queue:new', { conversation: conversationWithContact, message });
  }

  return { contact, conversation, message };
}

module.exports = { ingestInboundMessage };

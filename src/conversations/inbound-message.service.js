const { findOrCreateContactByPhoneNumber } = require('./contact.repository');
const { findOpenConversation, createConversation, getConversationWithContact, activateConversation } = require('./conversation.repository');
const { createMessage } = require('./message.repository');
const { emitToAgent, broadcast, broadcastToDashboard } = require('../realtime/socket-server');
const { shouldStartTriage, sendTriageQuestion, processTriageReply } = require('../triage/triage.service');
const { findChannelById } = require('../channels/channel.repository');
const { enqueueOutboundMessage } = require('../queue/outbound-queue');
const { findActiveCityNoticeByCityId, hasContactReceivedNotice, recordNoticeDelivery } = require('../city-notices/city-notice.repository');

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
  const { wasCreated, ...contact } = await findOrCreateContactByPhoneNumber(fromPhoneNumber, contactDisplayName);
  const contactJustCreated = Boolean(wasCreated);
  let conversation = await findOpenConversation(contact.id, channelId);
  if (conversation && conversation.status === 'silent') {
    conversation = await activateConversation(conversation.id);
  }
  let justCreated = false;
  if (!conversation) {
    const startTriage = await shouldStartTriage(channelId);
    try {
      conversation = await createConversation(contact.id, channelId, startTriage ? 'pending' : null);
      justCreated = true;
    } catch (err) {
      if (err.code !== UNIQUE_VIOLATION) throw err;
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
    if (err.code !== UNIQUE_VIOLATION) throw err;
    return { contact, conversation, message: null, contactJustCreated };
  }
  if (justCreated) {
    try {
      const channel = await findChannelById(channelId);
      if (channel && channel.welcomeMessage) {
        await enqueueOutboundMessage({ conversationId: conversation.id, channelId, content: channel.welcomeMessage });
      }
      if (conversation.triageState === 'pending') {
        await sendTriageQuestion(conversation.id, channelId);
      }
    } catch (err) {
      console.error(`Failed to send automatic messages for conversation ${conversation.id}`, err);
    }
  } else if (!justCreated && conversation.triageState === 'pending') {
    conversation = await processTriageReply(conversation, channelId, content);
  }
  try {
    const cityNotice = await findActiveCityNoticeByCityId(contact.cityId);
    if (cityNotice && !(await hasContactReceivedNotice(cityNotice.id, contact.id))) {
      await enqueueOutboundMessage({ conversationId: conversation.id, channelId, content: cityNotice.message });
      await recordNoticeDelivery(cityNotice.id, contact.id);
    }
  } catch (err) {
    console.error(`Failed to send city notice for conversation ${conversation.id}`, err);
  }
  const conversationWithContact = await getConversationWithContact(conversation.id);
  if (conversationWithContact.assignedAgentId) {
    emitToAgent(conversationWithContact.assignedAgentId, 'message:new', { conversation: conversationWithContact, message });
  } else {
    broadcast('queue:new', { conversation: conversationWithContact, message });
  }
  broadcastToDashboard('dashboard:conversation', { conversation: conversationWithContact });
  return { contact, conversation, message, contactJustCreated };
}

module.exports = { ingestInboundMessage };

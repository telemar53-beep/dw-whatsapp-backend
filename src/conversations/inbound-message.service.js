const { findOrCreateContactByPhoneNumber } = require('./contact.repository');
const { findOpenConversation, createConversation, getConversationWithContact, activateConversation, markBusinessHoursNoticeSent } = require('./conversation.repository');
const { createMessage } = require('./message.repository');
const { emitToAgent, broadcast, broadcastToDashboard } = require('../realtime/socket-server');
const { shouldStartTriage, sendTriageQuestion, processTriageReply } = require('../triage/triage.service');
const { findChannelById } = require('../channels/channel.repository');
const { enqueueOutboundMessage } = require('../queue/outbound-queue');
const { findActiveCityNoticeByCityId, recordNoticeDelivery } = require('../city-notices/city-notice.repository');
const { getBusinessHoursConfig } = require('../business-hours/business-hours.repository');
const { isOutsideBusinessHours } = require('../business-hours/business-hours.service');
const {
  shouldRunAi, scheduleAiReply, shouldTranscribe, markTranscriptionScheduled, enqueueTranscriptionJob,
} = require('../ai/ai.service');

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
  audioDurationSeconds,
}) {
  const { wasCreated, ...contact } = await findOrCreateContactByPhoneNumber(fromPhoneNumber, contactDisplayName);
  const contactJustCreated = Boolean(wasCreated);

  let businessHoursConfig = { enabled: false, startTime: '08:00', endTime: '18:00', message: '' };
  let outsideBusinessHours = false;
  try {
    businessHoursConfig = await getBusinessHoursConfig();
    outsideBusinessHours = businessHoursConfig.enabled && isOutsideBusinessHours(businessHoursConfig);
  } catch (err) {
    console.error('Failed to load business hours config', err);
  }

  let conversation = await findOpenConversation(contact.id, channelId);
  if (conversation && conversation.status === 'silent') {
    conversation = await activateConversation(conversation.id);
  }
  let justCreated = false;
  if (!conversation) {
    const startTriage = !outsideBusinessHours && (await shouldStartTriage(channelId));
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
    } catch (err) {
      console.error(`Failed to send welcome message for conversation ${conversation.id}`, err);
    }
  }

  try {
    const cityNotice = await findActiveCityNoticeByCityId(contact.cityId);
    if (cityNotice && (await recordNoticeDelivery(cityNotice.id, contact.id))) {
      await enqueueOutboundMessage({ conversationId: conversation.id, channelId, content: cityNotice.message });
    }
  } catch (err) {
    console.error(`Failed to send city notice for conversation ${conversation.id}`, err);
  }

  if (outsideBusinessHours && !conversation.businessHoursNoticeSentAt && !conversation.assignedAgentId) {
    try {
      await enqueueOutboundMessage({ conversationId: conversation.id, channelId, content: businessHoursConfig.message });
      conversation = await markBusinessHoursNoticeSent(conversation.id);
    } catch (err) {
      console.error(`Failed to send business hours notice for conversation ${conversation.id}`, err);
    }
  }

  if (justCreated) {
    try {
      if (conversation.triageState === 'pending') {
        await sendTriageQuestion(conversation.id, channelId);
      }
    } catch (err) {
      console.error(`Failed to start triage for conversation ${conversation.id}`, err);
    }
  } else if (!justCreated && conversation.triageState === 'pending') {
    conversation = await processTriageReply(conversation, channelId, content);
  }

  // Gate no tipo antes de tocar o banco: sem ele, shouldTranscribe (2 queries)
  // rodaria para toda mensagem de texto/figurinha/localização, mesmo com a
  // funcionalidade desligada — quebrando a garantia de "desligado é transparente".
  let audioTranscriptionScheduled = false;
  try {
    if (message.messageType === 'audio' && (await shouldTranscribe(channelId))) {
      audioTranscriptionScheduled = true;
      const updated = await markTranscriptionScheduled(message, audioDurationSeconds);
      if (updated) message = updated;
    }
  } catch (err) {
    console.error(`Failed to schedule transcription for conversation ${conversation.id}`, err);
  }

  try {
    if (await shouldRunAi(channelId)) {
      await scheduleAiReply(conversation, message);
    }
  } catch (err) {
    console.error(`Failed to schedule AI reply for conversation ${conversation.id}`, err);
  }

  const conversationWithContact = await getConversationWithContact(conversation.id);
  if (conversationWithContact.assignedAgentId) {
    emitToAgent(conversationWithContact.assignedAgentId, 'message:new', { conversation: conversationWithContact, message });
  } else {
    broadcast('queue:new', { conversation: conversationWithContact, message });
  }
  broadcastToDashboard('dashboard:conversation', { conversation: conversationWithContact });

  // Só depois do emit: um job pego pelo worker antes disso pode publicar
  // message:transcription antes de a tela saber que a mensagem existe.
  if (audioTranscriptionScheduled) {
    try {
      await enqueueTranscriptionJob(conversation, message);
    } catch (err) {
      console.error(`Failed to enqueue transcription for conversation ${conversation.id}`, err);
    }
  }

  return { contact, conversation, message, contactJustCreated };
}

module.exports = { ingestInboundMessage };

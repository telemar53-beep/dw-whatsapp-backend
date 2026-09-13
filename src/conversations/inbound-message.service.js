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
  shouldStartAiTriage, scheduleAiTriage,
} = require('../ai/ai.service');
const { getAiConfig } = require('../ai/ai-config.repository');
const { enqueueTriageTimeout } = require('../queue/ai-queue');
const { mensagemSegura } = require('../ai/safe-error-log');

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
  // Hoisted para fora do bloco `if (!conversation)`: reaproveitado mais abaixo
  // (triagemIa) para não chamar shouldStartAiTriage duas vezes quando a
  // conversa acabou de nascer.
  let aiTriage = false;
  if (!conversation) {
    // Triagem por IA tem prioridade sobre a triagem numérica: um canal nunca
    // roda as duas ao mesmo tempo (shouldStartAiTriage já confere aiEnabled +
    // aiTriageEnabled + shouldRunAi).
    aiTriage = await shouldStartAiTriage(channelId);
    const startTriage = !aiTriage && !outsideBusinessHours && (await shouldStartTriage(channelId));
    try {
      conversation = await createConversation(contact.id, channelId, aiTriage || startTriage ? 'pending' : null);
      justCreated = true;
    } catch (err) {
      if (err.code !== UNIQUE_VIOLATION) throw err;
      conversation = await findOpenConversation(contact.id, channelId);
    }
  }

  // I2 (fix round 1): fora do try/catch de createConversation de propósito.
  // Aquele catch só perdoa 23505 (corrida de criação) e relança qualquer
  // outro erro — um enqueueTriageTimeout (Redis) ou getAiConfig (Postgres)
  // que falhasse ali dentro faria o erro subir e a mensagem do cliente NUNCA
  // ser persistida (createMessage, mais abaixo, nem seria alcançado), mesmo a
  // conversa já tendo sido criada. Aqui, uma falha só loga — a conversa já
  // nasceu 'pending' e o pior caso é depender só da triagem por IA responder
  // no prazo normal, sem o job de segurança.
  if (justCreated && aiTriage) {
    try {
      const cfg = await getAiConfig();
      await enqueueTriageTimeout({ conversationId: conversation.id, delayMs: (cfg.triageTimeoutMinutes || 3) * 60000 });
    } catch (err) {
      console.error(`Failed to schedule triage timeout for conversation ${conversation.id}: ${mensagemSegura(err)}`);
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

  // Reaproveita `aiTriage` (computado no bloco de criação) quando a conversa
  // acabou de nascer, em vez de chamar shouldStartAiTriage de novo — mas essa
  // checagem também precisa valer numa conversa que já existia (triagem por
  // IA de uma conversa reaberta não passa pelo bloco `!conversation`), daí o
  // fallback para o `justCreated ? false : ...` não servir: só pulamos a
  // segunda chamada quando `justCreated` é true.
  const triagemIa = conversation.triageState === 'pending'
    && (justCreated ? aiTriage : await shouldStartAiTriage(channelId));
  if (justCreated) {
    try {
      if (conversation.triageState === 'pending' && !triagemIa) {
        await sendTriageQuestion(conversation.id, channelId);
      }
    } catch (err) {
      console.error(`Failed to start triage for conversation ${conversation.id}`, err);
    }
  } else if (conversation.triageState === 'pending' && !triagemIa) {
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
    if (triagemIa) {
      await scheduleAiTriage(conversation, message);
    } else if (await shouldRunAi(channelId)) {
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

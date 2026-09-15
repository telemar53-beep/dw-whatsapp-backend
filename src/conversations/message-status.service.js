const { parseStatusUpdates } = require('../whatsapp-adapters/meta-cloud.adapter');
const { advanceMessageStatus, markMessageFailedByWhatsappId } = require('./message.repository');
const { getConversationWithContact } = require('./conversation.repository');
const { emitToAgent } = require('../realtime/socket-server');

async function applyParsedMessageStatusUpdates(updates) {
  for (const update of updates) {
    // 'failed' grava o motivo em metadata.motivoFalha (para o chat mostrar sob
    // o balão); os demais status seguem o avanço de sempre, sem tocar metadata.
    const message = update.status === 'failed'
      ? await markMessageFailedByWhatsappId(update.whatsappMessageId, update.error || 'Falha reportada pelo WhatsApp')
      : await advanceMessageStatus(update.whatsappMessageId, update.status);
    if (!message) continue;
    const conversation = await getConversationWithContact(message.conversationId);
    if (conversation.assignedAgentId) {
      emitToAgent(conversation.assignedAgentId, 'message:updated', { conversationId: message.conversationId, message });
    }
  }
}

async function applyMessageStatusUpdates(webhookBody) {
  const updates = parseStatusUpdates(webhookBody);
  await applyParsedMessageStatusUpdates(updates);
}

module.exports = { applyMessageStatusUpdates, applyParsedMessageStatusUpdates };

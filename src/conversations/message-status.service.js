const { parseStatusUpdates } = require('../whatsapp-adapters/meta-cloud.adapter');
const { advanceMessageStatus } = require('./message.repository');
const { getConversationWithContact } = require('./conversation.repository');
const { emitToAgent } = require('../realtime/socket-server');

async function applyMessageStatusUpdates(webhookBody) {
  const updates = parseStatusUpdates(webhookBody);
  for (const update of updates) {
    const message = await advanceMessageStatus(update.whatsappMessageId, update.status);
    if (!message) continue;
    const conversation = await getConversationWithContact(message.conversationId);
    if (conversation.assignedAgentId) {
      emitToAgent(conversation.assignedAgentId, 'message:updated', { conversationId: message.conversationId, message });
    }
  }
}

module.exports = { applyMessageStatusUpdates };

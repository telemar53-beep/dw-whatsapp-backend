const { findChannelById } = require('../channels/channel.repository');
const { getAiConfig } = require('./ai-config.repository');
const { enqueueAiReply } = require('../queue/ai-queue');

async function shouldRunAi(channelId) {
  const channel = await findChannelById(channelId);
  if (!channel || !channel.aiEnabled) return false;
  const config = await getAiConfig();
  if (!config || config.mode === 'disabled') return false;
  if (!config.apiKey || !config.model) return false;
  return true;
}

async function scheduleAiReply(conversation, message) {
  // Áudio, imagem e documento não acionam a IA: ela não adivinha conteúdo.
  if (!message || message.messageType !== 'text' || !message.content) return;
  await enqueueAiReply({ conversationId: conversation.id, messageId: message.id });
}

module.exports = { shouldRunAi, scheduleAiReply };

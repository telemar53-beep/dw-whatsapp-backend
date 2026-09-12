const { findChannelById } = require('../channels/channel.repository');
const { getAiConfig } = require('./ai-config.repository');
const { enqueueAiReply } = require('../queue/ai-queue');
const { enqueueTranscription } = require('../queue/transcription-queue');
const { markTranscriptionPending } = require('../conversations/message.repository');

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

async function shouldTranscribe(channelId) {
  const channel = await findChannelById(channelId);
  if (!channel || !channel.aiEnabled) return false;
  const config = await getAiConfig();
  if (!config || !config.transcriptionEnabled) return false;
  if (!config.transcriptionModel) return false;
  return true;
}

async function scheduleTranscription(conversation, message, audioDurationSeconds) {
  if (!message || message.messageType !== 'audio') return;
  // Marca pending já aqui para a tela mostrar "Transcrevendo…" de imediato, em
  // vez de ficar sem sinal até o worker pegar o job. É também onde a duração
  // vinda do Baileys é persistida — ela não passa pelo INSERT de createMessage.
  await markTranscriptionPending(message.id, audioDurationSeconds != null ? audioDurationSeconds : null);
  await enqueueTranscription({ conversationId: conversation.id, messageId: message.id });
}

module.exports = { shouldRunAi, scheduleAiReply, shouldTranscribe, scheduleTranscription };

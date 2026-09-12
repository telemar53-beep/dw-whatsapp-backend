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

/**
 * Marca pending e devolve a linha atualizada, para o chamador poder usá-la no
 * message:new que está prestes a emitir — sem isso a tela só mostra
 * "Transcrevendo…" depois de um refresh. É também onde a duração vinda do
 * Baileys é persistida — ela não passa pelo INSERT de createMessage.
 *
 * NÃO enfileira: o enfileiramento é o passo separado enqueueTranscriptionJob,
 * que o chamador deve rodar só DEPOIS de emitir message:new/queue:new — senão
 * o worker pode publicar message:transcription antes de a tela sequer saber
 * que a mensagem existe, e o evento se perde.
 */
async function markTranscriptionScheduled(message, audioDurationSeconds) {
  if (!message || message.messageType !== 'audio') return null;
  return markTranscriptionPending(message.id, audioDurationSeconds != null ? audioDurationSeconds : null);
}

async function enqueueTranscriptionJob(conversation, message) {
  if (!message || message.messageType !== 'audio') return;
  await enqueueTranscription({ conversationId: conversation.id, messageId: message.id });
}

module.exports = {
  shouldRunAi, scheduleAiReply, shouldTranscribe, markTranscriptionScheduled, enqueueTranscriptionJob,
};

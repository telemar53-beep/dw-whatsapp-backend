const { processTranscriptionQueue } = require('./transcription-queue');
const { transcribeMessage } = require('../ai/transcription.service');
const { getAiConfig } = require('../ai/ai-config.repository');
const { shouldRunAi } = require('../ai/ai.service');
const { enqueueAiReply } = require('./ai-queue');
const { getConversationWithContact } = require('../conversations/conversation.repository');
const { findMessageById } = require('../conversations/message.repository');
const { emitToAgent, broadcast } = require('../realtime/socket-server');
const { mensagemSegura } = require('../ai/safe-error-log');

async function handleTranscriptionJob({ conversationId, messageId }) {
  const resultado = await transcribeMessage(messageId);

  // A tela é avisada nos dois casos: o atendente precisa ver tanto o texto
  // quanto o aviso de que não foi possível transcrever.
  const conversation = await getConversationWithContact(conversationId);
  const message = await findMessageById(messageId);
  const payload = {
    conversationId,
    messageId,
    transcription: message ? message.transcription : null,
    transcriptionStatus: message ? message.transcriptionStatus : null,
    transcriptionDetail: message ? message.transcriptionDetail : null,
  };
  if (conversation && conversation.assignedAgentId) {
    emitToAgent(conversation.assignedAgentId, 'message:transcription', payload);
  } else {
    broadcast('message:transcription', payload);
  }

  if (!resultado.ok) return;

  const config = await getAiConfig();
  if (!config || !config.transcriptionFeedAi) return;
  if (!conversation || !(await shouldRunAi(conversation.channelId))) return;

  await enqueueAiReply({ conversationId, messageId });
}

function startTranscriptionWorker() {
  processTranscriptionQueue(async (data) => {
    try {
      await handleTranscriptionJob(data);
    } catch (err) {
      console.error(`Transcription job failed for message ${data.messageId}: ${mensagemSegura(err)}`);
    }
  });
}

module.exports = { startTranscriptionWorker, handleTranscriptionJob };

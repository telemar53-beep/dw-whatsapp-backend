const { processTranscriptionQueue } = require('./transcription-queue');
const { transcribeMessage } = require('../ai/transcription.service');
const { getAiConfig } = require('../ai/ai-config.repository');
const { shouldRunAi } = require('../ai/ai.service');
const { enqueueAiReply } = require('./ai-queue');
const { getConversationWithContact } = require('../conversations/conversation.repository');
const { findMessageById, markTranscriptionFailed } = require('../conversations/message.repository');
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

/**
 * Rede de segurança para exceção FORA do transcription.service (DB, um
 * getAiConfig() null virando TypeError, markTranscriptionProcessing falhando
 * etc). Com attempts: 1 e removeOnFail: true, o job simplesmente some da fila
 * nesses casos — sem isto a mensagem fica presa em pending/processing pra
 * sempre e a tela mostra "Transcrevendo…" eternamente, sem nenhum evento.
 *
 * As duas ações abaixo vão cada uma no seu try/catch: uma segunda falha aqui
 * (ex.: o próprio banco fora do ar) não pode escapar e derrubar o worker.
 */
async function handleTranscriptionWorkerFailure(data, err) {
  console.error(`Transcription job failed for message ${data.messageId}: ${mensagemSegura(err)}`);

  let updated = null;
  try {
    updated = await markTranscriptionFailed(data.messageId, { status: 'failed', detail: 'erro interno', ms: null });
  } catch (markErr) {
    console.error(`Failed to mark transcription as failed for message ${data.messageId}: ${mensagemSegura(markErr)}`);
  }

  try {
    const conversation = await getConversationWithContact(data.conversationId);
    const payload = {
      conversationId: data.conversationId,
      messageId: data.messageId,
      transcription: updated ? updated.transcription : null,
      transcriptionStatus: updated ? updated.transcriptionStatus : 'failed',
      transcriptionDetail: updated ? updated.transcriptionDetail : 'erro interno',
    };
    if (conversation && conversation.assignedAgentId) {
      emitToAgent(conversation.assignedAgentId, 'message:transcription', payload);
    } else {
      broadcast('message:transcription', payload);
    }
  } catch (emitErr) {
    console.error(`Failed to notify transcription failure for message ${data.messageId}: ${mensagemSegura(emitErr)}`);
  }
}

function startTranscriptionWorker() {
  processTranscriptionQueue(async (data) => {
    try {
      await handleTranscriptionJob(data);
    } catch (err) {
      await handleTranscriptionWorkerFailure(data, err);
    }
  });
}

module.exports = { startTranscriptionWorker, handleTranscriptionJob, handleTranscriptionWorkerFailure };

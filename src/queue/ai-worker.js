const { processAiQueue } = require('./ai-queue');
const { runAiTurn } = require('../ai/ai-orchestrator');
const { createSuggestion } = require('../ai/ai-suggestion.repository');
const { getAiConfig } = require('../ai/ai-config.repository');
const { getConversationWithContact } = require('../conversations/conversation.repository');
const { findContactById } = require('../conversations/contact.repository');
const { findLatestInboundMessageId } = require('../conversations/message.repository');
const { emitToAgent } = require('../realtime/socket-server');
const { mensagemSegura } = require('../ai/safe-error-log');

async function handleAiJob({ conversationId, messageId }) {
  const conversation = await getConversationWithContact(conversationId);
  if (!conversation || conversation.status === 'closed' || conversation.status === 'silent') return;

  const config = await getAiConfig();
  if (!config || config.mode === 'disabled') return;

  // Assistente só faz sentido com atendente designado: é para ele que a sugestão vai.
  if (config.mode === 'assistant' && !conversation.assignedAgentId) return;
  // Automático para no instante em que um humano assume.
  if (config.mode === 'automatic' && conversation.assignedAgentId) return;

  // A mensagem mais nova ganha: se o cliente já escreveu de novo depois desta
  // mensagem, um job mais novo (com o histórico completo) já está agendado ou
  // vai ser — este aqui sai sem gastar uma chamada à OpenAI. Ver o comentário
  // em ai-queue.js sobre por que isto substituiu o debounce por jobId fixo.
  //
  // incluirAudioTranscrito segue config.transcriptionFeedAi: com a flag
  // desligada, um áudio transcrito nunca vai gerar job de IA (o worker de
  // transcrição não enfileira um pra ele) — se ele ainda contasse aqui como
  // "a mais nova", o job de um texto anterior se acharia ultrapassado e
  // sairia sem responder, sem log nenhum.
  const latestInboundMessageId = await findLatestInboundMessageId(conversationId, {
    incluirAudioTranscrito: config.transcriptionFeedAi,
  });
  if (latestInboundMessageId !== messageId) return;

  const contact = await findContactById(conversation.contactId);
  if (!contact) return;

  const { texto } = await runAiTurn({ conversation, contact });
  if (!texto) return;

  if (config.mode === 'assistant') {
    const suggestion = await createSuggestion({ conversationId, messageId: null, content: texto });
    emitToAgent(conversation.assignedAgentId, 'ai:suggestion', { conversationId, suggestion });
    return;
  }

  // Modo automático entra na Fase 2; por ora o job termina sem enviar nada.
}

function startAiWorker() {
  processAiQueue(async (data) => {
    try {
      await handleAiJob(data);
    } catch (err) {
      console.error(`AI job failed for conversation ${data.conversationId}: ${mensagemSegura(err)}`);
    }
  });
}

module.exports = { startAiWorker, handleAiJob };

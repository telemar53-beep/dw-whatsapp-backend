const { processAiQueue } = require('./ai-queue');
const { runAiTurn } = require('../ai/ai-orchestrator');
const { createSuggestion } = require('../ai/ai-suggestion.repository');
const { getAiConfig } = require('../ai/ai-config.repository');
const {
  getConversationWithContact, concludeAiTriage, incrementTriageAttempts, isPhoneContested,
} = require('../conversations/conversation.repository');
const { findContactById } = require('../conversations/contact.repository');
const { findLatestInboundMessageId, findMessageById } = require('../conversations/message.repository');
const { emitToAgent, broadcast, broadcastToDashboard } = require('../realtime/socket-server');
const { resolverIdentidade } = require('../ai/identity-resolver');
const { findChannelById } = require('../channels/channel.repository');
const { enqueueOutboundMessage } = require('../queue/outbound-queue');
const { mensagemSegura } = require('../ai/safe-error-log');
const { paraWhatsApp } = require('../ai/whatsapp-format');

async function handleAiJob(data) {
  if (data.tipo === 'triage-timeout') return handleTriageTimeout(data.conversationId);
  const { conversationId, messageId } = data;
  const conversation = await getConversationWithContact(conversationId);
  if (!conversation || conversation.status === 'closed' || conversation.status === 'silent') return;

  const config = await getAiConfig();
  if (!config || config.mode === 'disabled') return;

  // Triagem por IA: conversa ainda pendente e sem atendente. Ramo
  // completamente separado do assistente — não passa pelas checagens de modo
  // abaixo, que são do perfil assistente/automático.
  const emTriagem = conversation.status === 'waiting' && conversation.triageState === 'pending' && !conversation.assignedAgentId;
  if (emTriagem) return handleTriageTurn({ conversation, config, messageId });

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

  // Convertido aqui, e não no orquestrador: a auditoria (ai_interactions)
  // guarda o que o modelo escreveu; o cliente recebe o formato do WhatsApp.
  const turno = await runAiTurn({ conversation, contact });
  const texto = paraWhatsApp(turno.texto);
  if (!texto) return;

  if (config.mode === 'assistant') {
    // As ações executadas ficam gravadas NA sugestão: uma ferramenta sensível
    // (liberação em confiança) age no serviço do cliente no turno, antes de o
    // atendente ver o texto — ele precisa saber que aconteceu, e precisa
    // continuar sabendo depois de um F5, quando a tela relê pelo GET.
    const acoesExecutadas = (turno.toolsExecutadas || []).map((t) => t.nome);
    const suggestion = await createSuggestion({ conversationId, messageId: null, content: texto, acoesExecutadas });
    emitToAgent(conversation.assignedAgentId, 'ai:suggestion', { conversationId, suggestion });
    return;
  }

  // Modo automático entra na Fase 2; por ora o job termina sem enviar nada.
}

async function concluirEmCodigo(conversationId, summary) {
  const conversa = await concludeAiTriage(conversationId, {
    sectorId: null, reasonId: null, confidence: null, summary, identifiedBy: 'none', lowConfidence: true, resolvedByAi: false,
  });
  if (!conversa) return;
  const completa = await getConversationWithContact(conversationId);
  broadcast('queue:new', { conversation: completa, message: null });
  broadcastToDashboard('dashboard:conversation', { conversation: completa });
}

/**
 * Job de segurança agendado quando a conversa nasce em triagem por IA (ver
 * inbound-message.service.js): se a IA (ou o worker) ficar fora do ar, a
 * conversa não pode ficar 'pending' — invisível na fila — para sempre.
 * Idempotente: só age se a conversa ainda estiver pendente e em espera; um
 * turno que já concluiu, ou um atendente que já assumiu, tornam este job um
 * no-op silencioso.
 */
async function handleTriageTimeout(conversationId) {
  const c = await getConversationWithContact(conversationId);
  if (!c || c.triageState !== 'pending' || c.status !== 'waiting') return;
  await concluirEmCodigo(conversationId, 'Triagem não concluída: IA indisponível. Atender normalmente.');
}

async function handleTriageTurn({ conversation, config, messageId }) {
  const channel = await findChannelById(conversation.channelId);
  if (!channel || !channel.aiEnabled || !channel.aiTriageEnabled) {
    return concluirEmCodigo(conversation.id, 'Triagem por IA desligada no canal durante a triagem.');
  }
  // Na triagem qualquer tipo conta como "a mais nova": imagem e documento
  // viram placeholder no histórico e precisam de turno (ver message.repository.js).
  const latest = await findLatestInboundMessageId(conversation.id, { qualquerTipo: true });
  if (latest !== messageId) return;

  const contact = await findContactById(conversation.contactId);
  if (!contact) return;
  // ignorarTelefone: true depois de esquecer_identificacao (contestação do
  // nome) — sem isto o turno seguinte buscaria de novo pelo MESMO telefone no
  // SGP e cumprimentaria a mesma pessoa errada de novo.
  const ignorarTelefone = await isPhoneContested(conversation.id);
  const identidade = await resolverIdentidade({ contact, ignorarTelefone });
  const mensagem = await findMessageById(messageId);
  const origemMensagem = mensagem && mensagem.messageType === 'audio' ? 'áudio' : 'texto';
  const attempts = conversation.triageAttempts || 0;
  const forcarConclusao = attempts >= config.triageMaxQuestions;

  // O turno pode devolver identidade.dataNascimento e o CPF do cliente
  // (contexto.identidade em ai-orchestrator.js) — nunca vão a log nem são
  // persistidos aqui; o worker só olha turno.texto e turno.triagemConcluida.
  const turno = await runAiTurn({
    conversation, contact, perfil: 'triagem', identidade, origemMensagem,
    triagem: { threshold: config.triageConfidenceThreshold, maxQuestions: config.triageMaxQuestions, attempts, forcarConclusao },
  });

  // Nunca IA e humano ao mesmo tempo: relê antes de enviar. Se o próprio turno
  // concluiu a triagem, a conversa já está 'completed' e a frase final DEVE
  // sair; se foi outro (atendente assumiu, timeout), descarta.
  const agora = await getConversationWithContact(conversation.id);
  const concluiuAqui = Boolean(turno.triagemConcluida);
  if (!agora || agora.assignedAgentId || (agora.triageState !== 'pending' && !concluiuAqui)) return;

  const texto = paraWhatsApp(turno.texto);
  if (texto) {
    await enqueueOutboundMessage({ conversationId: conversation.id, channelId: conversation.channelId, content: texto, sentBy: 'ai' });
  }
  if (concluiuAqui) return;
  await incrementTriageAttempts(conversation.id);
  if (forcarConclusao) {
    await concluirEmCodigo(conversation.id, `Triagem inconclusiva após ${attempts} perguntas.`);
  }
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

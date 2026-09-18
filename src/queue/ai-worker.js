const { processAiQueue } = require('./ai-queue');
const { runAiTurn } = require('../ai/ai-orchestrator');
const { createSuggestion } = require('../ai/ai-suggestion.repository');
const { getAiConfig } = require('../ai/ai-config.repository');
const {
  getConversationWithContact, concludeAiTriage, incrementTriageAttempts, isPhoneContested,
  closeConversationByAi, getThirdPartyScope, setThirdPartyScope,
} = require('../conversations/conversation.repository');
const { escopoValido, paraContexto } = require('../ai/third-party-scope');
const { findContactById } = require('../conversations/contact.repository');
const { findLatestInboundMessageId, findMessageById, listRecentMessagesByConversation } = require('../conversations/message.repository');
const { emitToAgent, broadcast, broadcastToDashboard } = require('../realtime/socket-server');
const { resolverIdentidade } = require('../ai/identity-resolver');
const { findChannelById } = require('../channels/channel.repository');
const { enqueueOutboundMessage } = require('../queue/outbound-queue');
const { mensagemSegura } = require('../ai/safe-error-log');
const { paraWhatsApp } = require('../ai/whatsapp-format');
const { garantirSaudacao, corrigirPeriodoDaSaudacao, removerSaudacao } = require('../ai/saudacao');
const { motivoDeEncerramentoAtivo } = require('../ai/triage-close-reason');
const { isNightModeActive } = require('../ai/night-mode');
const { enviarAvisoDeCidadeSePreciso } = require('../city-notices/city-notice.service');
const { findActiveCityNoticeByCityId } = require('../city-notices/city-notice.repository');
const { findCityById } = require('../cities/city.repository');

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

  // A chave é separada do `mode` de propósito: desligar pelo modo levaria junto
  // a triagem e a transcrição de áudio, que continuam sendo desejadas.
  if (config.mode === 'assistant' && config.assistantSuggestionsEnabled) {
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
  // A IA já entregou o boleto/PIX e o cliente simplesmente não respondeu:
  // mandar para a fila alguém que já foi atendido só cria trabalho. Com motivo
  // configurado E ativo, encerra; sem isso, tudo segue como antes.
  const reasonId = c.aiTriageResolvedByAi ? await motivoDeEncerramentoAtivo() : null;
  if (reasonId) {
    const conversa = await closeConversationByAi(conversationId, {
      reasonId,
      summary: 'Resolvido pela IA (boleto/PIX entregue); cliente não respondeu e o atendimento foi encerrado sem atendente.',
    });
    if (!conversa) return;
    broadcastToDashboard('dashboard:conversation', {
      conversation: await getConversationWithContact(conversationId),
      closedAt: new Date().toISOString(),
    });
    return;
  }
  await concluirEmCodigo(conversationId, 'Triagem não concluída: IA indisponível. Atender normalmente.');
}

// Print 2026-09-16: "Ah" e "Pai!" em rajada → duas respostas idênticas. A
// checagem "ainda é a última mensagem?" só existia ANTES do turno; a mensagem
// que chega DURANTE o turno (segundos de OpenAI) gerava um segundo job e uma
// segunda resposta. Agora o worker reconfere DEPOIS do turno e descarta a
// resposta velha — o job da mensagem nova responde com o histórico inteiro.
// Exceção: turno que já fez algo com efeito (concluiu, encerrou, entregou,
// desbloqueou) precisa falar, senão o cliente não ouve o resultado — e o job
// seguinte, vendo a triagem concluída, sairia calado.
const FERRAMENTAS_COM_EFEITO = ['enviar_boleto', 'gerar_pix', 'desbloqueio_confianca', 'concluir_triagem', 'encerrar_atendimento'];

function turnoTeveEfeito(turno) {
  return Boolean(
    turno.triagemConcluida || turno.atendimentoEncerrado || turno.desbloqueioRealizado
    || (turno.toolsExecutadas || []).some((t) => FERRAMENTAS_COM_EFEITO.includes(t && t.nome))
  );
}

// Mesmo print: a segunda resposta era cópia da primeira. Comparação sem a
// saudação e sem caixa — "Bom dia! Como posso ajudar?" e "Como posso ajudar?"
// são a mesma resposta para o cliente.
function normalizarResposta(texto) {
  return removerSaudacao(String(texto || '')).trim().toLowerCase();
}

// Print 2026-09-17: a mesma pergunta de diagnóstico saiu TRÊS vezes seguidas,
// com esta guarda no ar. listRecentMessagesByConversation devolve em ordem
// CRONOLÓGICA (a mais antiga primeiro, por causa do .reverse() no
// repositório), e o find() pegava a PRIMEIRA resposta da IA da conversa — a
// saudação — em vez da última. Compara com as últimas respostas dela, não
// só com uma, para pegar também a repetição alternada.
const RESPOSTAS_COMPARADAS = 3;

async function repeteRespostaRecenteDaIa(conversationId, texto) {
  const recentes = (await listRecentMessagesByConversation(conversationId, 10)) || [];
  const daIa = recentes.filter((m) => m && m.direction === 'outbound' && m.sentBy === 'ai' && m.content);
  if (daIa.length === 0) return false;
  const alvo = normalizarResposta(texto);
  return daIa.slice(-RESPOSTAS_COMPARADAS).some((m) => normalizarResposta(m.content) === alvo);
}

async function handleTriageTurn({ conversation, config, messageId }) {
  const channel = await findChannelById(conversation.channelId);
  if (!channel || !channel.aiEnabled || !channel.aiTriageEnabled) {
    // I3 (fix round 1): NÃO conclui em código aqui. Um canal migrado do menu
    // numérico para a IA (ai_enabled ligado, ai_triage_enabled ainda
    // desligado) pode ter conversas 'pending' abertas de antes da migração;
    // a próxima mensagem cai neste ramo (emTriagem olha só triageState +
    // status, não a flag do canal), e concluir mataria o menu numérico com um
    // resumo de "IA desligada" — o cliente nunca mais veria a pergunta
    // numérica de novo. O job de timeout já é o dono do caso "triagem por IA
    // interrompida"; aqui só sai sem fazer nada, deixando o fluxo normal
    // (numérico, se houver) seguir na próxima mensagem.
    return;
  }
  // Na triagem, qualquer um dos tipos que realmente geram turno conta como "a
  // mais nova" — restrito a text/image/document/audio (fix round 1, I1):
  // sticker, vídeo e localização NUNCA são enfileirados por scheduleAiTriage,
  // então não podem contar aqui, ou o job de um texto anterior se acharia
  // ultrapassado e sairia sem responder.
  const latest = await findLatestInboundMessageId(conversation.id, { tiposTriagem: true });
  if (latest !== messageId) return;

  const contact = await findContactById(conversation.contactId);
  if (!contact) return;
  // ignorarTelefone: true depois de esquecer_identificacao (contestação do
  // nome) — sem isto o turno seguinte buscaria de novo pelo MESMO telefone no
  // SGP e cumprimentaria a mesma pessoa errada de novo.
  const ignorarTelefone = await isPhoneContested(conversation.id);
  const identidade = await resolverIdentidade({ contact, ignorarTelefone });

  // O escopo do boleto de terceiro sobrevive ao turno: o titular pode ter duas
  // faturas e o cliente precisa escolher uma. Expirado, morre aqui e a coluna é
  // limpa — nunca fica um resto autorizando um contrato alheio.
  let terceiro = null;
  try {
    const escopo = await getThirdPartyScope(conversation.id);
    if (escopoValido(escopo)) {
      terceiro = paraContexto(escopo);
    } else if (escopo) {
      await setThirdPartyScope(conversation.id, null);
    }
  } catch (err) {
    console.error(`Failed to load the third party scope for conversation ${conversation.id}: ${mensagemSegura(err)}`);
  }

  // A identificação pode ter acabado de descobrir a cidade do cliente no SGP:
  // quando a mensagem chegou (inbound-message.service.js), o contato ainda
  // estava sem cidade e o aviso não tinha como sair. Aqui ele sai.
  let avisoCidade = null;
  try {
    await enviarAvisoDeCidadeSePreciso({ contact, conversationId: conversation.id, channelId: conversation.channelId });
    // O aviso ENTREGUE ANTES também conta para o prompt: a falha regional
    // continua acontecendo, e é ela que explica a reclamação deste turno —
    // mesmo que a mensagem do aviso já tenha ido em outro atendimento.
    const avisoAtivo = contact.cityId ? await findActiveCityNoticeByCityId(contact.cityId) : null;
    if (avisoAtivo) {
      const cidade = await findCityById(contact.cityId);
      avisoCidade = { cidade: cidade ? cidade.name : null, mensagem: avisoAtivo.message };
    }
  } catch (err) {
    console.error(`Failed to send city notice for conversation ${conversation.id}: ${mensagemSegura(err)}`);
  }
  const mensagem = await findMessageById(messageId);
  const origemMensagem = mensagem && mensagem.messageType === 'audio' ? 'áudio' : 'texto';
  const attempts = conversation.triageAttempts || 0;
  // Modo noturno calculado POR TURNO (nunca por conversa): a conversa que
  // começou 19:55 vira noturna no turno das 20:10.
  const noturnoAtivo = isNightModeActive({ channel, config });
  const noturno = { ativo: noturnoAtivo, retornoAs: noturnoAtivo ? config.nightEndTime : null };
  // config vem do banco (ai_config) — uma config incompleta/corrompida não
  // pode virar `attempts >= undefined` (sempre false) nem contaminar o que o
  // modelo recebe como maxQuestions.
  // À noite o roteiro de conexão pede "uma etapa por vez": duas perguntas a
  // mais cabem sem transformar a triagem em atendimento completo.
  const maxQuestions = (Number.isInteger(config.triageMaxQuestions) ? config.triageMaxQuestions : 2) + (noturnoAtivo ? 2 : 0);
  const forcarConclusao = attempts >= maxQuestions;

  // O turno pode devolver o CPF do cliente (contexto.identidade em
  // ai-orchestrator.js) — nunca vai a log nem é persistido aqui; o worker só
  // olha turno.texto e turno.triagemConcluida.
  const turno = await runAiTurn({
    conversation, contact, perfil: 'triagem', identidade, origemMensagem, avisoCidade, terceiro,
    triagem: { threshold: config.triageConfidenceThreshold, maxQuestions, attempts, forcarConclusao, noturno },
  });

  // Nunca IA e humano ao mesmo tempo: relê antes de enviar. Se o próprio turno
  // concluiu a triagem, a conversa já está 'completed' e a frase final DEVE
  // sair; se foi outro (atendente assumiu, timeout, ou um admin fechou/
  // silenciou a conversa sem nem assumi-la — I4 fix round 1), descarta.
  const agora = await getConversationWithContact(conversation.id);
  const concluiuAqui = Boolean(turno.triagemConcluida);
  // O turno pode ter fechado a conversa ele mesmo (encerrar_atendimento): a
  // despedida ainda precisa sair, então 'closed' só descarta quando o
  // fechamento veio de FORA (atendente, admin, timeout).
  const encerrouAqui = Boolean(turno.atendimentoEncerrado);
  if (
    !agora
    || (agora.status === 'closed' && !encerrouAqui)
    || agora.status === 'silent'
    || agora.assignedAgentId
    || (agora.triageState !== 'pending' && !concluiuAqui && !encerrouAqui)
  ) return;

  // A PRIMEIRA resposta de cada atendimento começa com a saudação da hora e
  // o primeiro nome, mesmo que o modelo tenha esquecido (ele esqueceu, no
  // teste real, justamente quando entregou o PIX por ferramenta). attempts
  // === 0 identifica o primeiro turno: só depois de responder é que o worker
  // incrementa triage_attempts.
  const primeiroTurno = attempts === 0;
  // Reconfere DEPOIS do turno (ver turnoTeveEfeito): se chegou mensagem nova
  // enquanto a IA pensava, esta resposta morre aqui, sem contar pergunta.
  if (!turnoTeveEfeito(turno)) {
    const ultimaAgora = await findLatestInboundMessageId(conversation.id, { tiposTriagem: true });
    if (ultimaAgora !== messageId) return;
  }
  // Em qualquer turno, "Bom dia" às 14h vira "Boa tarde" (o modelo erra mesmo
  // sabendo a hora); no primeiro turno, além disso, a saudação é garantida —
  // e da segunda resposta em diante ela é REMOVIDA (print 2026-09-16).
  const textoDoModelo = corrigirPeriodoDaSaudacao(paraWhatsApp(turno.texto));
  // O nome pode ter sido descoberto DENTRO do turno (buscar_cliente com o CPF
  // que o cliente acabou de mandar): a identidade do fim do turno vem antes da
  // que foi resolvida no começo (print 2026-09-17, entrega sem nome nenhum).
  const nomeParaSaudar = (turno.identidade && turno.identidade.primeiroNome)
    || (identidade && identidade.primeiroNome) || null;
  const texto = primeiroTurno ? garantirSaudacao(textoDoModelo, nomeParaSaudar) : removerSaudacao(textoDoModelo);
  // Nunca a mesma resposta duas vezes seguidas (sem efeito por trás): melhor
  // o silêncio de um "Ah"/"Pai!" do que a IA parecendo travada.
  if (texto && !turnoTeveEfeito(turno) && await repeteRespostaRecenteDaIa(conversation.id, texto)) {
    console.warn(`AI reply repeated a recent AI message in conversation ${conversation.id}; not sent`);
    return;
  }
  if (texto) {
    await enqueueOutboundMessage({ conversationId: conversation.id, channelId: conversation.channelId, content: texto, sentBy: 'ai' });
  } else if (noturnoAtivo && turno.desbloqueioRealizado && !concluiuAqui && !encerrouAqui) {
    // O turno estourou o tempo (TURNO_MAX_MS) DEPOIS de a liberação acontecer
    // no SGP e ANTES de o modelo escrever a resposta: a internet do cliente
    // voltou e ele não recebeu uma palavra. A frase de sucesso é a do dono, sai
    // por código, e o atendimento vai para a fila da manhã com o que falta —
    // conferir o pagamento. (O guard de releitura acima já garante que a
    // conversa continua em triagem, sem atendente e sem ter sido fechada.)
    const nome = (turno.identidade && turno.identidade.primeiroNome)
      || (identidade && identidade.primeiroNome) || 'cliente';
    await enqueueOutboundMessage({
      conversationId: conversation.id, channelId: conversation.channelId, sentBy: 'ai',
      content: `Prontinho, ${nome}! O desbloqueio em confiança foi realizado. Seu pagamento ainda será conferido por um dos meus colegas no horário comercial, a partir das ${noturno.retornoAs}. Já deixei seu atendimento na fila com o comprovante para acompanhamento. Você consegue testar se a internet voltou?`,
    });
    await concluirEmCodigo(conversation.id, 'Modo noturno: desbloqueio em confiança realizado; o turno da IA estourou o tempo antes da resposta final. Conferir pagamento e dar baixa.');
    return;
  }
  if (concluiuAqui || encerrouAqui) return;
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

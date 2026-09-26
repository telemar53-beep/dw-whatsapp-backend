const { processAiQueue, enqueueTriageTimeout } = require('./ai-queue');
const { runAiTurn } = require('../ai/ai-orchestrator');
const { createSuggestion } = require('../ai/ai-suggestion.repository');
const { getAiConfig } = require('../ai/ai-config.repository');
const {
  getConversationWithContact, concludeAiTriage, incrementTriageAttempts, isPhoneContested,
  closeConversationByAi, getThirdPartyScope, setThirdPartyScope, getTriageReactivation,
} = require('../conversations/conversation.repository');
const { setorDeReativacao } = require('../sectors/reactivation-sector');
const { descreverReativacao } = require('../ai/situacao-financeira');
const { escopoValido, paraContexto } = require('../ai/third-party-scope');
const { localizacaoDoTerceiro } = require('../ai/documento-pendente');
const { resolverAlvoDoTurno } = require('../ai/financial-target');
const { findContactById } = require('../conversations/contact.repository');
const { findLatestInboundMessageId, findMessageById, listRecentMessagesByConversation, findLastMessageCreatedAt } = require('../conversations/message.repository');
const { emitToAgent, broadcast, broadcastToDashboard } = require('../realtime/socket-server');
const { resolverIdentidade } = require('../ai/identity-resolver');
const { findChannelById } = require('../channels/channel.repository');
const { enqueueOutboundMessage } = require('../queue/outbound-queue');
const { mensagemSegura } = require('../ai/safe-error-log');
const { paraWhatsApp } = require('../ai/whatsapp-format');
const { garantirSaudacao, corrigirPeriodoDaSaudacao, removerSaudacao } = require('../ai/saudacao');
const { motivoDeEncerramentoAtivo } = require('../ai/triage-close-reason');
const { isNightModeActive } = require('../ai/night-mode');
const { enviarAvisoDeCidadeSePreciso, selecionarAvisoDoContato } = require('../city-notices/city-notice.service');
const { findNoticeDeliverySentAt } = require('../city-notices/city-notice.repository');
const { findCityById } = require('../cities/city.repository');

// Timeout da triagem (caso ER, 25/09/2026). O padrão é o mesmo do agendamento no nascimento da
// conversa (inbound-message.service.js); o mínimo técnico evita um reagendamento em loop
// apertado quando faltam milissegundos para o prazo.
const TIMEOUT_PADRAO_MS = 3 * 60000;
const REAGENDAMENTO_MINIMO_MS = 5000;

// Quando o modelo não escreve nada mas propôs uma ação, a sugestão não pode
// ficar vazia: a atendente precisa ler o que foi proposto e por que não
// aconteceu. Texto de sistema, nunca enviado ao cliente sem ela mandar.
function textoDeAcaoProposta(acoes) {
  return `A assistente tentou executar ${acoes.join(', ')} e a ação NÃO foi executada: neste atendimento quem confirma é você. Confira o pedido do cliente e decida.`;
}

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

  // Ações que a IA quis fazer e o gate barrou por exigirem a atendente. Elas
  // são o item MAIS importante da sugestão: é o que ela precisa decidir.
  const acoesPropostas = (turno.toolsRecusadas || [])
    .filter((t) => t && t.motivo === 'action_requires_human_approval')
    .map((t) => t.nome);

  // Sem texto E sem nada a mostrar, não há sugestão a criar — como antes.
  // COM ação proposta, sair aqui faria a tentativa desaparecer em silêncio, que
  // é metade do defeito de 22/09/2026: a outra metade era ela ter acontecido.
  if (!texto && acoesPropostas.length === 0) return;

  // A chave é separada do `mode` de propósito: desligar pelo modo levaria junto
  // a triagem e a transcrição de áudio, que continuam sendo desejadas.
  if (config.mode === 'assistant' && config.assistantSuggestionsEnabled) {
    // As ações ficam gravadas NA sugestão para o atendente continuar vendo
    // depois de um F5, quando a tela relê pelo GET. Em DUAS listas: o card
    // rotula cada nome de `acoesExecutadas` com uma frase no passado
    // ("Liberação em confiança executada no SGP"), então pôr ali o que foi
    // apenas proposto faria a tela afirmar justamente o que o gate impediu.
    const acoesExecutadas = (turno.toolsExecutadas || []).map((t) => t.nome);
    const conteudo = texto || textoDeAcaoProposta(acoesPropostas);
    const suggestion = await createSuggestion({
      conversationId, messageId: null, content: conteudo, acoesExecutadas, acoesPropostas,
    });
    emitToAgent(conversation.assignedAgentId, 'ai:suggestion', { conversationId, suggestion });
    return;
  }

  if (!texto) return;

  // Modo automático entra na Fase 2; por ora o job termina sem enviar nada.
}

async function concluirEmCodigo(conversationId, summary) {
  // Regra financeira 0/1/2+ (25/09/2026): a conversa marcada para a reativação vai para o setor
  // dela, com o motivo no topo do resumo — também no timeout e no limite de perguntas. Sem o setor
  // cadastrado (ou com falha na leitura), a fila geral de sempre; nunca "resolvida".
  let sectorId = null;
  let resumo = summary;
  try {
    const reativacao = await getTriageReactivation(conversationId);
    if (reativacao) {
      const setor = await setorDeReativacao();
      sectorId = setor ? setor.id : null;
      resumo = `Encaminhamento para reativação: ${descreverReativacao(reativacao)}.\n${summary}`;
    }
  } catch (err) {
    console.error(`Reativação não lida na conclusão em código da conversa ${conversationId}: ${mensagemSegura(err)}`);
  }
  const conversa = await concludeAiTriage(conversationId, {
    sectorId, reasonId: null, confidence: null, summary: resumo, identifiedBy: 'none', lowConfidence: true, resolvedByAi: false,
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

  // Caso ER (25/09/2026): este job nasce UMA vez, com a conversa, e não sabe o que aconteceu
  // depois — disparava T0 + prazo mesmo com cliente e IA conversando (produção: cliente
  // 13:13:18, IA 13:13:30, encerrada 13:13:35 como "cliente não respondeu"). Regra: um timeout
  // antigo nunca fecha nem move uma conversa com atividade mais recente. Relê a última
  // mensagem (qualquer direção); se ainda não passou um prazo inteiro desde ela, reagenda para
  // "última + prazo" e sai. Na dúvida (leitura falhou), preserva a conversa.
  let prazoMs = TIMEOUT_PADRAO_MS;
  try {
    const cfg = await getAiConfig();
    prazoMs = ((cfg && cfg.triageTimeoutMinutes) || 3) * 60000;
    const ultima = await findLastMessageCreatedAt(conversationId);
    const restante = ultima ? new Date(ultima).getTime() + prazoMs - Date.now() : 0;
    if (restante > 0) {
      // Mínimo técnico contra loop apertado; teto de um prazo contra horário no futuro
      // (o horário da entrada vem do provedor).
      await reagendarTimeoutDaTriagem(conversationId, Math.min(Math.max(restante, REAGENDAMENTO_MINIMO_MS), prazoMs));
      return;
    }
  } catch (err) {
    console.error(`Failed to read last activity for triage timeout of conversation ${conversationId}: ${mensagemSegura(err)}`);
    await reagendarTimeoutDaTriagem(conversationId, prazoMs);
    return;
  }

  // A IA já entregou o boleto/PIX e o cliente simplesmente não respondeu:
  // mandar para a fila alguém que já foi atendido só cria trabalho. Com motivo
  // configurado E ativo, encerra; sem isso, tudo segue como antes.
  // Regra financeira 0/1/2+: marcada para a reativação, nunca fecha como resolvida — nem com o PIX
  // entregue (2+ à noite, ou a entrega de outro contrato). Na dúvida (leitura falhou), também não.
  let podeFecharComoResolvida = Boolean(c.aiTriageResolvedByAi);
  if (podeFecharComoResolvida) {
    try {
      if (await getTriageReactivation(conversationId)) podeFecharComoResolvida = false;
    } catch (err) {
      console.error(`Reativação não lida no timeout da conversa ${conversationId}: ${mensagemSegura(err)}`);
      podeFecharComoResolvida = false;
    }
  }
  const reasonId = podeFecharComoResolvida ? await motivoDeEncerramentoAtivo() : null;
  if (reasonId) {
    const conversa = await closeConversationByAi(conversationId, {
      reasonId,
      summary: 'Resolvido pela IA (boleto/PIX entregue); cliente não respondeu e o atendimento foi encerrado sem atendente.',
    });
    if (!conversa) return;
    // A conversa em triagem está na fila de todo atendente (aba Automação): sem o
    // queue:removed, o item encerrado ficava lá até recarregar a página (caso ER).
    broadcast('queue:removed', { conversationId });
    broadcastToDashboard('dashboard:conversation', {
      conversation: await getConversationWithContact(conversationId),
      closedAt: new Date().toISOString(),
    });
    return;
  }
  await concluirEmCodigo(conversationId, 'Triagem não concluída: IA indisponível. Atender normalmente.');
}

// Reagendamento do timeout da triagem. Sem jobId fixo (ver ai-queue.js: o Bull ignora em
// silêncio um add com id já existente); o job atual já está executando e só cria o próximo.
// Se falhar, registra e NÃO age: na dúvida, a conversa é preservada.
async function reagendarTimeoutDaTriagem(conversationId, delayMs) {
  try {
    await enqueueTriageTimeout({ conversationId, delayMs });
    return true;
  } catch (err) {
    console.error(`Failed to reschedule triage timeout for conversation ${conversationId}: ${mensagemSegura(err)}`);
    return false;
  }
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

// Um aviso por turno (25/09/2026): o aviso saiu para o cliente NESTE turno se o worker acabou de
// mandá-lo, ou se a entrada desta mesma mensagem mandou — a entrega é registrada logo depois da
// mensagem. A margem cobre a diferença entre o horário do provedor (created_at da mensagem) e o do
// banco (sent_at). Falha na leitura = sem a marca: a resposta segura completa continua valendo.
const MARGEM_DO_AVISO_NA_ENTRADA_MS = 60 * 1000;

async function avisoSaiuNesteTurno({ avisoEnviadoAgora, aviso, contact, mensagem }) {
  if (avisoEnviadoAgora && avisoEnviadoAgora.id === aviso.id) return true;
  if (!mensagem || !mensagem.createdAt) return false;
  try {
    const enviadoEm = await findNoticeDeliverySentAt(aviso.id, contact.id);
    if (!enviadoEm) return false;
    return new Date(enviadoEm).getTime() >= new Date(mensagem.createdAt).getTime() - MARGEM_DO_AVISO_NA_ENTRADA_MS;
  } catch (err) {
    console.error(`Failed to read the city notice delivery for contact ${contact.id}: ${mensagemSegura(err)}`);
    return false;
  }
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
  let escopoDoTerceiro = null;
  try {
    const escopo = await getThirdPartyScope(conversation.id);
    if (escopoValido(escopo)) {
      terceiro = paraContexto(escopo);
      escopoDoTerceiro = escopo;
    } else if (escopo) {
      await setThirdPartyScope(conversation.id, null);
    }
  } catch (err) {
    console.error(`Failed to load the third party scope for conversation ${conversation.id}: ${mensagemSegura(err)}`);
  }

  // A identificação pode ter acabado de descobrir a cidade do cliente no SGP:
  // quando a mensagem chegou (inbound-message.service.js), o contato ainda
  // estava sem cidade e o aviso não tinha como sair. Aqui ele sai.
  // A mensagem do turno vem antes do aviso: é por ela que se sabe se o aviso saiu na entrada
  // desta mesma mensagem (um aviso por turno, logo abaixo).
  const mensagem = await findMessageById(messageId);
  let avisoCidade = null;
  try {
    const avisoEnviadoAgora = await enviarAvisoDeCidadeSePreciso({ contact, conversationId: conversation.id, channelId: conversation.channelId });
    // O aviso ENTREGUE ANTES também conta para o prompt: a falha regional
    // continua acontecendo, e é ela que explica a reclamação deste turno —
    // mesmo que a mensagem do aviso já tenha ido em outro atendimento.
    //
    // A escolha vem da MESMA função que o envio usou, e não de uma consulta
    // própria: se cada lado decidisse por conta, o cliente podia receber o
    // aviso do povoado e a IA raciocinar com o do município.
    const escolha = await selecionarAvisoDoContato(contact);
    if (escolha) {
      const lugar = await findCityById(escolha.lugarId);
      avisoCidade = { cidade: lugar ? lugar.name : null, mensagem: escolha.aviso.message };
      if (await avisoSaiuNesteTurno({ avisoEnviadoAgora, aviso: escolha.aviso, contact, mensagem })) {
        avisoCidade.enviadoNesteTurno = true;
      }
    }
  } catch (err) {
    console.error(`Failed to send city notice for conversation ${conversation.id}: ${mensagemSegura(err)}`);
  }
  const origemMensagem = mensagem && mensagem.messageType === 'audio' ? 'áudio' : 'texto';

  // Alvo financeiro do turno (caso Fulana/Beltrana, decisão do dono 25/09/2026): o pedido de
  // TERCEIRO é grudento — entregar, não ter fatura ou não achar o CPF não o encerram. Só a
  // intenção EXPLÍCITA na mensagem do cliente muda o alvo (financial-target.js, sem OpenAI):
  // a própria cobrança volta ao titular sem pedir CPF (ele já está identificado); os dois lados
  // travam a cobrança até ele esclarecer. A identidade de quem fala nunca muda aqui.
  const textoDoCliente = mensagem ? (mensagem.messageType === 'audio' ? mensagem.transcription : mensagem.content) : null;
  const alvoDoTurno = resolverAlvoDoTurno({ terceiro, texto: textoDoCliente });
  const alvoAmbiguo = alvoDoTurno.alvoAmbiguo;
  if (alvoDoTurno.voltarAoTitular) {
    try {
      await setThirdPartyScope(conversation.id, null);
      terceiro = null;
    } catch (err) {
      // Segue no terceiro, o lado seguro: nada de quem fala sai neste turno.
      console.error(`Failed to switch the financial target back to the contact for conversation ${conversation.id}: ${mensagemSegura(err)}`);
    }
  }
  // Documento pendente (25/09/2026): quando o terceiro foi LOCALIZADO — fato do sistema, lido do
  // escopo que buscar_cliente gravou antes de devolver. Não depende de a resposta daquele turno ter
  // sido enviada (descartada por repetição, vazia ou barrada por outra guarda, o fato continua aqui).
  const terceiroLocalizadoEm = terceiro ? localizacaoDoTerceiro(escopoDoTerceiro) : null;
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
  // Regra financeira 0/1/2+ (ajuste de 25/09/2026): a marca de reativação da conversa (fato gravado
  // pelo gate) vai ao prompt deste turno — a regra dos 90 dias não pode mandar para o financeiro o
  // que o gate mandou para a reativação. Falha na leitura: o turno segue sem ela, e as ferramentas
  // continuam lendo do banco.
  let reativacao = null;
  try {
    reativacao = await getTriageReactivation(conversation.id);
  } catch (err) {
    console.error(`Reativação não lida para o turno da conversa ${conversation.id}: ${mensagemSegura(err)}`);
  }

  // O turno pode devolver o CPF do cliente (contexto.identidade em
  // ai-orchestrator.js) — nunca vai a log nem é persistido aqui; o worker só
  // olha turno.texto e turno.triagemConcluida.
  const turno = await runAiTurn({
    // messageId é a mensagem inbound deste turno — já garantida como a mais
    // recente logo acima (findLatestInboundMessageId). A idempotência de
    // enviar_boleto/gerar_pix usa esse id para separar "o cliente pediu o
    // reenvio agora" de "o modelo chamou a ferramenta duas vezes na mesma
    // mensagem": um id por mensagem do cliente, o mesmo em todas as tool calls
    // dela.
    conversation, contact, perfil: 'triagem', identidade, origemMensagem, avisoCidade, terceiro, alvoAmbiguo, messageId,
    terceiroLocalizadoEm, reativacao: reativacao || null,
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
    // Documento pendente (25/09/2026): a resposta que pede o CPF/CNPJ sai marcada com DE QUEM é o
    // documento pedido — é por essa marca que o próximo turno sabe que o pedido já foi feito. (A
    // CONFIRMAÇÃO do terceiro não viaja aqui: é fato do sistema, lido do escopo persistido.)
    await enqueueOutboundMessage({
      conversationId: conversation.id, channelId: conversation.channelId, content: texto, sentBy: 'ai',
      ...(turno.pedidoDeDocumento ? { metadata: { pedidoDeDocumento: turno.pedidoDeDocumento } } : {}),
    });
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

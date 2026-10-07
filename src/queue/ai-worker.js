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
const {
  escopoValido, paraContexto, montarEscopo, comPendenciaDeAlvo, criadoEm, duvidaSemAutorizacao, CONTEXTO_SEM_AUTORIZACAO, MINUTOS_DE_VIDA,
  esperadoDoEscopo,
} = require('../ai/third-party-scope');
const { localizacaoDoTerceiro } = require('../ai/documento-pendente');
const { resolverAlvoDasMensagens, AMBIGUIDADE, documentosValidos } = require('../ai/financial-target');
const { getCompanyConfig } = require('../company/company-config.repository');
const { findContactById } = require('../conversations/contact.repository');
const {
  findLatestInboundMessageId, findMessageById, listRecentMessagesByConversation, findLastMessageCreatedAt, listarFalasSemAlvoConfirmado,
  marcarFalasComAlvoProcessado,
} = require('../conversations/message.repository');
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

// Segunda revisão da F2: acima disto, as falas não confirmadas não são reaplicadas — a cobrança do turno trava.
const PAGINA_DE_FALAS_SEM_ALVO = 200;
const TETO_DE_FALAS_SEM_ALVO = 10000;

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
  // faturas e o cliente precisa escolher uma. Expirado sem pendência, morre aqui e a
  // coluna é limpa — nunca fica um resto autorizando um contrato alheio.
  let terceiro = null;
  let escopoDoTerceiro = null;
  // Revisão da F2 (30/09/2026): falha de LEITURA não prova que não havia terceiro nem dúvida gravada — o
  // turno acontece, mas a cobrança dele trava (logo abaixo, no alvo do turno).
  let escopoIlegivel = false;
  let escopo = null;
  // Persistência do alvo (03/10/2026): os estados que este turno pode encontrar no banco, como as gravações
  // condicionais os exigem (third-party-scope.js, esperadoDoEscopo). Normalmente um só: o lido, ou o último
  // gravado com confirmação. Uma gravação que lançou erro pode ter sido efetivada (resposta perdida): o estado
  // que ela tentou entra na lista. Toda gravação do escopo neste turno — a do worker e a das ferramentas — só
  // tem efeito se o banco ainda estiver num deles. `estadoMudou`: outro processamento gravou depois da leitura;
  // o que o turno leu está atrasado, e a cobrança dele trava.
  let esperados = [];
  let estadoMudou = false;
  try {
    escopo = await getThirdPartyScope(conversation.id);
    esperados = [esperadoDoEscopo(escopo)];
  } catch (err) {
    escopoIlegivel = true;
    console.error(`Failed to load the third party scope for conversation ${conversation.id}: ${mensagemSegura(err)}`);
  }
  try {
    if (escopoValido(escopo)) {
      terceiro = paraContexto(escopo);
      escopoDoTerceiro = escopo;
    } else if (duvidaSemAutorizacao(escopo)) {
      // Terceira revisão da F2 (30/09/2026): expiração encerra a autorização, não resolve a dúvida. O escopo
      // vencido com dúvida — ou pendente por documento não localizado — fica na coluna, sem prazo novo, e o turno
      // parte da dúvida sem autorização (nenhum contrato). A afirmação da própria cobrança limpa a coluna (logo
      // abaixo); o documento grava outro.
      terceiro = { ...CONTEXTO_SEM_AUTORIZACAO, contratos: [] };
    } else if (escopo) {
      if ((await setThirdPartyScope(conversation.id, null, { esperados, aceitaNulo: true })) === true) {
        esperados = [esperadoDoEscopo(null)];
      } else {
        estadoMudou = true;
      }
    }
  } catch (err) {
    // Vencido sem dúvida vale como coluna vazia: a falha só adia a limpeza. O banco pode ter ficado vazio
    // (resposta perdida): os dois estados passam a ser esperados.
    esperados = [...esperados, esperadoDoEscopo(null)];
    console.error(`Failed to clear the expired third party scope for conversation ${conversation.id}: ${mensagemSegura(err)}`);
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
  // Segunda revisão da F2 (30/09/2026) — a tabela de transições das seções 12.1 e 13.1 do relatório da F2. O
  // turno parte do escopo gravado e REAPLICA, em ordem, as falas do cliente ainda não confirmadas. É registro
  // durável — as mensagens já estão no banco antes do job —, sem estado em memória: reiniciar não perde nada.
  // Terceira revisão: a confirmação é a marca de cada entrada aplicada (message.repository.js). Se a transição
  // não é gravada (ou o estado não pôde ser lido), nenhuma cobrança sai neste turno e nada é marcado: o próximo
  // turno reaplica as mesmas falas. A resposta da IA não confirma nada. Falha de gravação dentro da consulta do
  // documento (30/09/2026): a marca vem DEPOIS do turno, porque a ferramenta também pode ter uma transição a
  // gravar (logo depois de runAiTurn).
  let alvoAmbiguo = false;
  let contratoEscolhido = null;
  let empresa = null;
  try {
    const cartao = await getCompanyConfig();
    empresa = (cartao && cartao.name) || null;
  } catch (err) {
    // Sem o nome da empresa, ele só deixa de ser complemento conhecido ("o boleto da DW" trava).
    console.error(`Failed to read the company name for the financial target of conversation ${conversation.id}: ${mensagemSegura(err)}`);
  }
  let falas = null;
  let documentos = [];
  // As entradas que o turno aplicou, para marcar depois dele; null = não marcar (a transição não foi gravada).
  let entradasDoTurno = null;
  // As entradas deste turno: as lidas e a do job. A do job já marcada (reprocessamento) não é reaplicada:
  // o efeito dela já está gravado, e um escopo gravado depois dela (documento) não pode ser desfeito por ela.
  const entradaJaProcessada = Boolean(mensagem && mensagem.metadata && mensagem.metadata.alvoProcessado === true);
  let aMarcar = [];
  if (!escopoIlegivel) {
    try {
      const desde = new Date(Math.max(Date.now() - MINUTOS_DE_VIDA * 60 * 1000, (criadoEm(escopoDoTerceiro) || new Date(0)).getTime()));
      // Segurança final da F2 (03/10/2026): todas as entradas não confirmadas, em páginas, na ordem do banco. Antes,
      // mais de 50 travavam a cobrança até o fim da triagem (nada era marcado nunca); agora nenhuma é descartada e
      // todas são reaplicadas. O teto só existe contra um volume patológico, e acima dele a cobrança trava.
      const lidas = [];
      const jaLidas = new Set();
      for (let cursor = null; ;) {
        const pagina = (await listarFalasSemAlvoConfirmado(conversation.id, { desde, limite: PAGINA_DE_FALAS_SEM_ALVO, depoisDe: cursor })) || [];
        // O cursor tem a precisão do JavaScript (milissegundos): na virada de página a última entrada pode voltar —
        // nunca uma é pulada. A repetida não é reaplicada de novo.
        for (const m of pagina) if (m && !jaLidas.has(m.id)) { jaLidas.add(m.id); lidas.push(m); }
        if (pagina.length < PAGINA_DE_FALAS_SEM_ALVO) break;
        if (lidas.length >= TETO_DE_FALAS_SEM_ALVO) throw new Error('unconfirmed_messages_over_limit');
        const ultima = pagina[pagina.length - 1];
        cursor = { createdAt: ultima.createdAt, id: ultima.id };
      }
      // A ordem é a do banco (created_at, id), com a entrada do job no lugar dela: uma entrada mais nova pode
      // ter chegado entre a checagem "é a mais recente?" e esta leitura. Fora da lista (anterior ao limite), a
      // do job vai por último.
      const validas = lidas.filter(Boolean);
      const jobNaLista = validas.some((m) => m.id === messageId);
      aMarcar = [...validas.map((m) => m.id), ...(jobNaLista || entradaJaProcessada ? [] : [messageId])];
      // Persistência do alvo (03/10/2026): CPF/CNPJ numa entrada ANTERIOR à do job ainda não confirmada — ver
      // resolverAlvoDasMensagens. O documento de quem fala vem da memória do contato ou da identidade do turno;
      // nada disso vai a log.
      const proprio = String((contact && contact.sgpDocument) || (identidade && identidade.client && identidade.client.document) || '').replace(/\D/g, '');
      const documentosDaEntrada = (texto) => {
        const achados = documentosValidos(texto);
        if (achados.length === 0) return null;
        const semZeros = (d) => d.replace(/^0+/, '');
        return { algum: true, deOutro: Boolean(proprio) && achados.some((d) => semZeros(d) !== semZeros(proprio)) };
      };
      const lidasComTexto = [];
      const documentosLidos = [];
      for (const m of validas) {
        if (m.id !== messageId && m.metadata && m.metadata.autorrespostaProvavel === true) continue;
        const texto = (m.id === messageId ? textoDoCliente : (m.messageType === 'audio' ? m.transcription : m.content)) || '';
        // Entrada sem texto (imagem, áudio sem transcrição) entra vazia: não muda o alvo, mas desfaz a escolha de contrato
        // pela rua de uma fala anterior (pedido por endereço, 06/10/2026).
        lidasComTexto.push(texto);
        documentosLidos.push(m.id === messageId || !texto ? null : documentosDaEntrada(texto));
      }
      if (!jobNaLista && !entradaJaProcessada) {
        lidasComTexto.push(textoDoCliente || '');
        documentosLidos.push(null);
      }
      falas = lidasComTexto;
      documentos = documentosLidos;
    } catch (err) {
      console.error(`Failed to read the unconfirmed customer messages for conversation ${conversation.id}: ${mensagemSegura(err)}`);
    }
  }
  if (falas === null) {
    // Escopo ou falas não lidos: o estado pode estar atrasado. Nada é gravado nem marcado sobre o que não foi lido.
    alvoAmbiguo = AMBIGUIDADE.ESCOPO_NAO_LIDO;
  } else if (estadoMudou) {
    // Outro processamento gravou o escopo depois da leitura: o que o turno leu está atrasado. Nada é gravado nem
    // marcado sobre ele, e a cobrança do turno trava; o turno seguinte lê o estado novo e reaplica as entradas.
    alvoAmbiguo = AMBIGUIDADE.TRANSICAO_NAO_GRAVADA;
  } else {
    // Pedido por endereço (06/10/2026): os endereços dos contratos JÁ CONFIRMADOS de quem fala (a identidade do turno).
    const enderecos = ((identidade && identidade.contracts) || []).filter((c) => c && c.address).map((c) => ({ id: c.id, address: c.address }));
    const alvo = resolverAlvoDasMensagens({ terceiro, textos: falas, empresa, documentos, enderecos });
    ({ alvoAmbiguo } = alvo);
    contratoEscolhido = alvo.contratoEscolhido || null;
    let gravado = true;
    if (alvo.gravar) {
      let novo = null;
      if (alvo.gravar === 'criar') novo = comPendenciaDeAlvo(montarEscopo(null, [], new Date(), { pendente: true }), alvo.terceiro.alvoPendente);
      else if (alvo.gravar === 'pendencia') novo = comPendenciaDeAlvo(escopoDoTerceiro, alvo.terceiro.alvoPendente || null);
      try {
        // Persistência do alvo (03/10/2026): só grava se o banco ainda estiver no estado que o turno leu. A volta
        // ao titular aceita a coluna já vazia (o efeito pedido já vale).
        if ((await setThirdPartyScope(conversation.id, novo, { esperados, aceitaNulo: novo === null })) === true) {
          escopoDoTerceiro = novo;
          terceiro = novo ? paraContexto(novo) : null;
          esperados = [esperadoDoEscopo(novo)];
        } else {
          console.error(`The financial target of conversation ${conversation.id} changed after it was read; the transition was not stored`);
          estadoMudou = true;
          alvoAmbiguo = AMBIGUIDADE.TRANSICAO_NAO_GRAVADA;
          gravado = false;
        }
      } catch (err) {
        // Transição não gravada não pode parecer concluída: nem o estado anterior (a pessoa de antes), nem o
        // novo valem para cobrança neste turno. Ela pode ter sido efetivada (resposta perdida): os dois estados
        // passam a ser esperados.
        console.error(`Failed to store the financial target transition for conversation ${conversation.id}: ${mensagemSegura(err)}`);
        alvoAmbiguo = AMBIGUIDADE.TRANSICAO_NAO_GRAVADA;
        gravado = false;
        esperados = [...esperados, esperadoDoEscopo(novo)];
      }
    }
    if (gravado) entradasDoTurno = aMarcar;
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
    conversation, contact, perfil: 'triagem', identidade, origemMensagem, avisoCidade, terceiro, alvoAmbiguo, contratoEscolhido, messageId,
    terceiroLocalizadoEm, reativacao: reativacao || null, esperadosDoAlvo: esperados,
    triagem: { threshold: config.triageConfidenceThreshold, maxQuestions, attempts, forcarConclusao, noturno },
  });

  // Falha de gravação dentro da consulta do documento (30/09/2026): buscar_cliente não conseguiu gravar o pendente
  // antes de consultar, e avisou. O worker grava o mesmo pendente sem contrato; se também falhar, as entradas do
  // turno não são marcadas como concluídas. Depois, a marca das entradas — antes de qualquer descarte da resposta.
  // Persistência do alvo (03/10/2026): as duas recuperações gravam com a mesma condição das ferramentas — o banco
  // ainda num dos estados que o turno conhece (`turno.esperadosDoAlvo`: o último confirmado e as gravações que
  // lançaram erro). Se outro processamento gravou depois, nada é escrito e as entradas não são marcadas.
  const esperadosDepoisDoTurno = (turno && Array.isArray(turno.esperadosDoAlvo)) ? turno.esperadosDoAlvo : esperados;
  // A identificação pelo próprio documento, com terceiro no contexto, não terminou: nada a gravar, e as entradas não
  // são marcadas — o documento delas segura o terceiro anterior no turno seguinte (achado 3a da revisão).
  if (turno && turno.consultaPropriaPendente) entradasDoTurno = null;
  // A reserva de uma entrega encontrou o alvo mudado por outro processamento: o estado deste turno estava atrasado.
  if (turno && turno.alvoMudouNaEntrega) entradasDoTurno = null;
  if (turno && turno.alvoTerceiroNaoGravado) {
    try {
      if ((await setThirdPartyScope(conversation.id, montarEscopo(null, [], new Date(), { pendente: true }), { esperados: esperadosDepoisDoTurno })) !== true) {
        console.error(`The financial target of conversation ${conversation.id} changed during the turn; the pending third party request was not stored`);
        entradasDoTurno = null;
      }
    } catch (err) {
      console.error(`Failed to store the pending third party request after the turn for conversation ${conversation.id}: ${mensagemSegura(err)}`);
      entradasDoTurno = null;
    }
  } else if (turno && turno.voltaAoTitularNaoGravada) {
    // Bloqueador 2: buscar_cliente identificou quem fala pelo próprio documento e não conseguiu gravar a volta ao
    // titular. A cobrança do turno já travou na ferramenta; aqui a volta é gravada de novo. Se também falhar, as
    // entradas ficam sem a marca, e o documento delas segura o terceiro anterior no turno seguinte
    // (resolverAlvoDasMensagens).
    try {
      if ((await setThirdPartyScope(conversation.id, null, { esperados: esperadosDepoisDoTurno, aceitaNulo: true })) !== true) {
        console.error(`The financial target of conversation ${conversation.id} changed during the turn; the return to the account holder was not stored`);
        entradasDoTurno = null;
      }
    } catch (err) {
      console.error(`Failed to store the return to the account holder after the turn for conversation ${conversation.id}: ${mensagemSegura(err)}`);
      entradasDoTurno = null;
    }
  }
  if (entradasDoTurno && entradasDoTurno.length > 0) {
    try {
      await marcarFalasComAlvoProcessado(entradasDoTurno);
    } catch (err) {
      // Sem a marca, as mesmas entradas voltam no próximo turno; reaplicá-las sobre o estado que elas mesmas
      // gravaram dá o mesmo estado.
      console.error(`Failed to mark the customer messages applied to the financial target for conversation ${conversation.id}: ${mensagemSegura(err)}`);
    }
  }

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
  // Fechamento limitado (04/10/2026; avaliação real r4 E11 #5): a liberação em confiança confirmada NESTE turno e a
  // conclusão da triagem no mesmo turno — a instrução da conclusão prevaleceu e a mensagem final omitiu a liberação. Nesse
  // caso a mensagem sai pelos fatos: a ação confirmada no turno e a fila relida acima (em espera, triagem concluída, sem
  // atendente; posse humana, encerramento ou silenciamento já saíram em silêncio). Nenhuma ação nova: sem liberar de novo,
  // sem concluir de novo.
  const setorDaFila = turno.triagemConcluida && turno.triagemConcluida.setor;
  const liberouEConcluiuNoTurno = Boolean(noturnoAtivo && turno.desbloqueioNoTurno && concluiuAqui && !encerrouAqui && setorDaFila);
  const nomeDaLiberacao = (turno.identidade && turno.identidade.primeiroNome) || (identidade && identidade.primeiroNome) || 'cliente';
  const textoDoTurno = liberouEConcluiuNoTurno
    ? `Prontinho, ${nomeDaLiberacao}! O desbloqueio em confiança foi realizado. Seu atendimento ficou registrado para o setor ${setorDaFila} e nossa equipe dá continuidade a partir das ${noturno.retornoAs}.`
    : turno.texto;
  const textoDoModelo = corrigirPeriodoDaSaudacao(paraWhatsApp(textoDoTurno));
  // Revisão da entrega 1: a marca da oferta foi calculada sobre o texto do modelo; a mensagem composta pelos fatos não a leva.
  const ofertaDaMensagem = textoDoTurno === turno.texto ? turno.ofertaDoBoleto : null;
  const meiosDaMensagem = Array.isArray(turno.meiosDaFatura) && turno.meiosDaFatura.length > 0 ? turno.meiosDaFatura : null;
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
      // Comportamento da IA (05/10/2026): a oferta do boleto também viaja na metadata (o próximo turno sabe que foi feita).
      // Comportamento da IA (06/10/2026; A6/A7): o estado dos meios que a 2ª via comprovou é fato da fatura, não da redação —
      // viaja mesmo quando a mensagem é composta pelos fatos.
      ...((turno.pedidoDeDocumento || ofertaDaMensagem || meiosDaMensagem) ? { metadata: {
        ...(turno.pedidoDeDocumento ? { pedidoDeDocumento: turno.pedidoDeDocumento } : {}),
        ...(ofertaDaMensagem ? { ofertaDoBoleto: ofertaDaMensagem } : {}),
        ...(meiosDaMensagem ? { meiosDaFatura: meiosDaMensagem } : {}),
      } } : {}),
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
    // Conclusão do atendimento (04/10/2026): sem "com o comprovante" — o worker não sabe se houve comprovante, e a
    // liberação em confiança não o exige (mesma correção da instrução de desbloqueio_confianca).
    await enqueueOutboundMessage({
      conversationId: conversation.id, channelId: conversation.channelId, sentBy: 'ai',
      content: `Prontinho, ${nome}! O desbloqueio em confiança foi realizado. Seu pagamento ainda será conferido por um dos meus colegas no horário comercial, a partir das ${noturno.retornoAs}. Já deixei seu atendimento na fila para acompanhamento. Você consegue testar se a internet voltou?`,
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

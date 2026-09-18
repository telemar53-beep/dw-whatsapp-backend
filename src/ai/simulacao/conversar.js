// O encadeador de turnos da simulação.
//
// FIDELIDADE: quem conduz o turno é o `runAiTurn` de PRODUÇÃO. Nada aqui
// reimplementa orquestração, laço de ferramentas, toolChoice, teto de
// ferramentas, teto de tempo, guardas de anúncio/entrega/liberação ou a guarda
// de idioma — é o mesmo código, então é idêntico por construção. Este módulo
// só faz o que o worker faz em volta dele: acumula o histórico, resolve a
// identidade entre turnos, conta as perguntas e guarda o escopo de terceiro.
//
// O QUE ESTE MÓDULO *NÃO* REPRODUZ DO WORKER (e por que não): o pós-processo
// de texto (`paraWhatsApp`, `garantirSaudacao`, `removerSaudacao`,
// `corrigirPeriodoDaSaudacao`) e o descarte da resposta quando chega mensagem
// nova. São camadas do `ai-worker.js` aplicadas DEPOIS do turno, e os
// invariantes desta entrega julgam o comportamento do turno, não a cosmética
// da saudação. Fica registrado aqui para quem ler a transcrição não achar que
// a falta da saudação garantida é defeito da IA.
//
// A CHAVE DA OPENAI vem só de process.env.OPENAI_API_KEY, em tempo de
// execução. Ela não é escrita em arquivo, não é impressa, não é mascarada e
// não aparece na transcrição.

const fs = require('fs');
const path = require('path');

const { runAiTurn } = require('../ai-orchestrator');
const { getAiConfig, isToolEnabled } = require('../ai-config.repository');
const { recordAiInteraction } = require('../ai-interaction.repository');
const { listRecentMessagesByConversation, findLatestInboundImage } = require('../../conversations/message.repository');
const {
  getConversationWithContact, concludeAiTriage, closeConversationByAi, markTriageResolvedByAi,
  setThirdPartyScope, getThirdPartyScope, markPhoneContested, setConversationSector, setSuggestedReason,
} = require('../../conversations/conversation.repository');
const { setContactSgpLink } = require('../../conversations/contact.repository');
const { listActiveReasons, findReasonById } = require('../../reasons/reason.repository');
const { listSectors } = require('../../sectors/sector.repository');
const { getCompanyConfig } = require('../../company/company-config.repository');
const { hasRecentTrustUnlockByContact, recordTrustUnlock, listTrustUnlocksByContract } = require('../trust-unlock.repository');
const { saveMediaFile, getMediaFilePath } = require('../../media/media-storage');
const { enqueueOutboundMessage } = require('../../queue/outbound-queue');
const { broadcast, broadcastToDashboard } = require('../../realtime/socket-server');
const { enviarPix, enviarBoleto } = require('../../payments/payment-sender');
const { preencherCidadePeloSgp } = require('../../cities/contact-city.service');
const { enviarAvisoDeCidadeSePreciso } = require('../../city-notices/city-notice.service');
const { motivoDeEncerramentoAtivo } = require('../triage-close-reason');
const { claimReceipt, releaseReceipt, findReceiptUsage } = require('../receipt-usage.repository');

const { IDENTIDADES, prepararSgpFalso, SETORES, MOTIVOS } = require('./sgp-falso');

const RAIZ = path.join(__dirname, '..', '..', '..');
const SAIDA = path.join(RAIZ, 'output', 'simulacao');

/**
 * A pasta de configuração. SIMULACAO_LOCAL aponta para outro lugar; existe para
 * o teste de fumaça do harness rodar com uma config fabricada, sem depender de
 * `.local/`, que é do dono e não está versionada. Lida a cada chamada (e não
 * uma vez no carregamento) para não depender da ordem dos requires.
 */
function pastaLocal() {
  return process.env.SIMULACAO_LOCAL || path.join(RAIZ, '.local');
}

// Mesmo teto do orquestrador: o histórico que o mock devolve é a janela que a
// produção lê do banco.
const HISTORICO_MAX = 20;

// ---------------------------------------------------------------------------
// Config do painel
// ---------------------------------------------------------------------------

function lerLocal(arquivo) {
  const caminho = path.join(pastaLocal(), arquivo);
  if (!fs.existsSync(caminho)) {
    throw new Error(`Falta ${path.join('.local', arquivo)}. Veja docs/simulacao/README.md para saber o que copiar do painel.`);
  }
  return fs.readFileSync(caminho, 'utf8');
}

/**
 * A config do painel de produção, sem nenhum segredo: a chave vem do ambiente.
 * Se algum campo faltar, falha aqui e não no meio da conversa — um
 * maxToolsPerInteraction `undefined` viraria teto zero e a simulação
 * reprovaria por defeito de configuração, não de comportamento.
 */
function configDoPainel() {
  const bruto = JSON.parse(lerLocal('ia-config.json'));
  const obrigatorios = ['model', 'maxToolsPerInteraction', 'triageMaxQuestions', 'triageConfidenceThreshold'];
  const faltando = obrigatorios.filter((c) => bruto[c] === undefined || bruto[c] === null);
  if (faltando.length > 0) {
    throw new Error(`.local/ia-config.json sem os campos: ${faltando.join(', ')}. Compare com docs/simulacao/ia-config.exemplo.json.`);
  }
  if (bruto.apiKey) {
    // Ordem do dono desde o início do projeto: a chave nunca em arquivo. O
    // valor não é lido, não é usado e não é impresso — só recusado.
    throw new Error('.local/ia-config.json não pode conter apiKey: a chave vem só de OPENAI_API_KEY, no ambiente.');
  }
  if (bruto.triageResolvedReasonId && !MOTIVOS.some((m) => m.id === bruto.triageResolvedReasonId && m.active)) {
    throw new Error('triageResolvedReasonId não existe (ou está inativo) no catálogo de motivos da simulação.');
  }
  return {
    id: 1,
    mode: bruto.mode || 'triage',
    model: bruto.model,
    maxToolsPerInteraction: bruto.maxToolsPerInteraction,
    triageMaxQuestions: bruto.triageMaxQuestions,
    triageConfidenceThreshold: Number(bruto.triageConfidenceThreshold),
    triageTimeoutMinutes: bruto.triageTimeoutMinutes || 10,
    triageResolvedReasonId: bruto.triageResolvedReasonId || null,
    triageReadReceiptsDaytime: Boolean(bruto.triageReadReceiptsDaytime),
    nightStartTime: bruto.nightStartTime || null,
    nightEndTime: bruto.nightEndTime || null,
    assistantSuggestionsEnabled: false,
    transcriptionEnabled: false,
    systemPrompt: lerLocal('prompt-sistema.txt'),
    triageExtraInstructions: lerLocal('instrucoes-operacao.txt'),
    // Só aqui, e só em memória. Nunca gravada, nunca impressa.
    apiKey: process.env.OPENAI_API_KEY,
    empresa: bruto.empresa || 'Provedor de Teste',
  };
}

// ---------------------------------------------------------------------------
// O mundo em volta do turno (tudo o que em produção é banco, fila ou rede)
// ---------------------------------------------------------------------------

function exigirMock(fn, nome, caminho) {
  if (!fn || typeof fn !== 'function' || !fn.mockImplementation) {
    throw new Error(`${nome} não está mockado. O arquivo de teste precisa de jest.mock('${caminho}').`);
  }
}

/**
 * Programa os repositórios, a fila, o socket e os serviços auxiliares. A
 * conversa é um objeto VIVO: concluir_triagem e encerrar_atendimento mudam o
 * estado dela, e a releitura que as ferramentas fazem (saiuDaTriagem) precisa
 * enxergar essa mudança — é assim que a produção se comporta, e é o que faz o
 * turno seguinte recusar a entrega depois de a conversa sair da triagem.
 */
function prepararMundo({ config, conversa, contact, historico }) {
  exigirMock(getAiConfig, 'getAiConfig', './ai-config.repository');
  exigirMock(recordAiInteraction, 'recordAiInteraction', './ai-interaction.repository');
  exigirMock(listRecentMessagesByConversation, 'listRecentMessagesByConversation', '../conversations/message.repository');
  exigirMock(getConversationWithContact, 'getConversationWithContact', '../conversations/conversation.repository');
  exigirMock(enqueueOutboundMessage, 'enqueueOutboundMessage', '../queue/outbound-queue');

  getAiConfig.mockResolvedValue(config);
  isToolEnabled.mockResolvedValue(true);
  recordAiInteraction.mockResolvedValue({ id: 'sim' });

  listRecentMessagesByConversation.mockImplementation(async () => historico.slice(-HISTORICO_MAX));
  findLatestInboundImage.mockResolvedValue(null);

  listSectors.mockResolvedValue(SETORES);
  listActiveReasons.mockResolvedValue(MOTIVOS.filter((m) => m.active !== false));
  findReasonById.mockImplementation(async (id) => MOTIVOS.find((m) => m.id === id) || null);
  motivoDeEncerramentoAtivo.mockImplementation(async () => {
    if (!config.triageResolvedReasonId) return null;
    const motivo = MOTIVOS.find((m) => m.id === config.triageResolvedReasonId);
    return motivo && motivo.active !== false ? motivo.id : null;
  });

  getCompanyConfig.mockResolvedValue({ id: 'cfg-sim', name: config.empresa, acceptedPayeeNames: [] });

  getConversationWithContact.mockImplementation(async () => ({ ...conversa, contactSgpDocument: contact.sgpDocument }));
  concludeAiTriage.mockImplementation(async (id, dados) => {
    if (conversa.triageState !== 'pending') return null;
    conversa.triageState = 'completed';
    conversa.sectorId = dados.sectorId;
    conversa.aiTriageSummary = dados.summary;
    conversa.aiTriageConfidence = dados.confidence;
    conversa.aiTriageLowConfidence = dados.lowConfidence;
    conversa.aiTriageResolvedByAi = conversa.aiTriageResolvedByAi || Boolean(dados.resolvedByAi);
    return { ...conversa };
  });
  closeConversationByAi.mockImplementation(async (id, dados) => {
    conversa.status = 'closed';
    conversa.triageState = 'completed';
    conversa.aiTriageResolvedByAi = true;
    conversa.aiTriageSummary = dados.summary;
    return { ...conversa };
  });
  markTriageResolvedByAi.mockImplementation(async () => {
    if (conversa.triageState !== 'pending') return false;
    conversa.aiTriageResolvedByAi = true;
    return true;
  });
  setConversationSector.mockImplementation(async (id, sectorId) => {
    conversa.sectorId = sectorId;
    return { ...conversa };
  });
  setSuggestedReason.mockImplementation(async (id, reasonId) => {
    conversa.suggestedReasonId = reasonId;
    return { ...conversa };
  });
  markPhoneContested.mockResolvedValue(undefined);
  setThirdPartyScope.mockImplementation(async (id, escopo) => {
    conversa.aiTriageThirdParty = escopo || null;
  });
  getThirdPartyScope.mockImplementation(async () => conversa.aiTriageThirdParty || null);

  setContactSgpLink.mockResolvedValue(undefined);
  preencherCidadePeloSgp.mockResolvedValue(undefined);
  enviarAvisoDeCidadeSePreciso.mockResolvedValue(undefined);

  saveMediaFile.mockResolvedValue('simulacao/boleto-de-teste.pdf');
  getMediaFilePath.mockReturnValue('simulacao/boleto-de-teste.pdf');
  enqueueOutboundMessage.mockResolvedValue({ id: 'out-sim' });
  enviarPix.mockResolvedValue({ id: 'pix-sim' });
  enviarBoleto.mockResolvedValue({ id: 'boleto-sim' });
  broadcast.mockReturnValue(undefined);
  broadcastToDashboard.mockReturnValue(undefined);

  hasRecentTrustUnlockByContact.mockResolvedValue(false);
  recordTrustUnlock.mockResolvedValue({ id: 'unlock-sim' });
  listTrustUnlocksByContract.mockResolvedValue([]);

  claimReceipt.mockResolvedValue({ ok: true });
  releaseReceipt.mockResolvedValue(undefined);
  findReceiptUsage.mockResolvedValue(null);
}

// ---------------------------------------------------------------------------
// Mensagens do roteiro
// ---------------------------------------------------------------------------

/**
 * Uma mensagem do roteiro é texto, ou { audio: 'o que o cliente falou' }.
 * O áudio entra no histórico do jeito que o orquestrador espera
 * (ai-orchestrator.js: messageType 'audio' + transcriptionStatus 'completed'
 * faz a transcrição virar a fala do cliente) — é assim que a confirmação 1 do
 * dono é exercitada de verdade, e não simulada com um texto qualquer.
 */
function empurrarDoCliente(historico, mensagem) {
  if (typeof mensagem === 'string') {
    historico.push({ direction: 'inbound', content: mensagem, messageType: 'text' });
    return { texto: mensagem, audio: false };
  }
  if (mensagem && typeof mensagem.audio === 'string') {
    historico.push({
      direction: 'inbound', content: null, messageType: 'audio',
      transcriptionStatus: 'completed', transcription: mensagem.audio,
    });
    return { texto: mensagem.audio, audio: true };
  }
  throw new TypeError('Mensagem do roteiro precisa ser texto ou { audio: "..." }');
}

/** Fotografia do estado que o dono pediu no relatório, antes e depois do turno. */
function retrato({ identidade, terceiro, attempts }) {
  return {
    identidade: identidade
      ? { nivel: identidade.nivel, origem: identidade.origem, primeiroNome: identidade.primeiroNome, contestado: Boolean(identidade.contestado) }
      : null,
    contratos: ((identidade && identidade.contracts) || []).map((c) => c.id),
    terceiro: terceiro ? { nome: terceiro.nome, contratos: terceiro.contratos.map((c) => c.id) } : null,
    attempts,
  };
}

// ---------------------------------------------------------------------------
// A conversa
// ---------------------------------------------------------------------------

/**
 * Roda o roteiro turno a turno pelo runAiTurn REAL.
 *
 * `anterior` encadeia roteiros: o seguinte continua a MESMA conversa, com o
 * mesmo histórico, a mesma identidade, o mesmo escopo de terceiro e a mesma
 * contagem de perguntas. Sem isso ele testaria um estado que nunca existe.
 *
 * A conversa PARA quando a triagem conclui ou o atendimento é encerrado: em
 * produção o worker não roda mais nenhum turno de triagem depois disso, e
 * continuar mandando mensagem aqui testaria um caminho que não existe. O que
 * sobrou fica em `mensagensNaoEnviadas`, e a transcrição diz por quê.
 */
async function conversar(roteiro, anterior = null) {
  // A chave primeiro: é a falta mais provável, e a mensagem precisa ser sobre
  // ela. O nome da variável é tudo o que esta mensagem diz — nunca o valor.
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('Defina OPENAI_API_KEY no ambiente para rodar a simulação real.');
  }
  const config = configDoPainel();

  if (!anterior && !roteiro.identidade) {
    throw new Error(`O roteiro ${roteiro.numero} não declara identidade nem continuaDe.`);
  }
  const historico = anterior ? anterior.historico : [];
  // prepararSgpFalso roda SEMPRE, inclusive no roteiro encadeado: ele é quem
  // programa os mocks do sgp-client, e o jest pode tê-los limpado entre os
  // testes. O que o encadeamento preserva é o contato (as ferramentas
  // escrevem nele) e a identidade inicial, não a programação dos mocks.
  const base = prepararSgpFalso(anterior ? anterior.sgp.perfil : IDENTIDADES[roteiro.identidade]);
  const perfil = base.perfil;
  const contact = anterior ? anterior.sgp.contact : base.contact;
  const identidadeInicial = anterior ? anterior.sgp.identidade : base.identidade;

  const conversationId = anterior ? anterior.conversationId : `sim-${roteiro.numero}`;
  const conversa = anterior ? anterior.conversa : {
    id: conversationId,
    contactId: contact.id,
    channelId: 'ch-simulacao',
    status: 'waiting',
    assignedAgentId: null,
    sectorId: null,
    triageState: 'pending',
    triageAttempts: 0,
    aiTriageResolvedByAi: false,
    aiTriageThirdParty: null,
  };

  prepararMundo({ config, conversa, contact, historico });

  // Os limiares saem do painel, nunca de número escrito aqui: o harness existe
  // para reproduzir a produção, e maxQuestions muda o momento em que a
  // conclusão é forçada. O acréscimo noturno é o mesmo do worker
  // (ai-worker.js): à noite o roteiro pede uma etapa por vez.
  const noturnoAtivo = Boolean(roteiro.noturno);
  const noturno = { ativo: noturnoAtivo, retornoAs: noturnoAtivo ? (config.nightEndTime || '08:00') : null };
  const maxQuestions = config.triageMaxQuestions + (noturnoAtivo ? 2 : 0);

  const turnos = [];
  let identidade = anterior ? anterior.identidade : identidadeInicial;
  let terceiro = anterior ? anterior.terceiro : null;
  let attempts = anterior ? anterior.attempts : 0;
  let parou = null;
  const mensagensNaoEnviadas = [];

  for (const mensagem of roteiro.mensagens) {
    if (parou) {
      mensagensNaoEnviadas.push(typeof mensagem === 'string' ? mensagem : `[áudio] ${mensagem.audio}`);
      continue;
    }
    const doCliente = empurrarDoCliente(historico, mensagem);
    const antes = retrato({ identidade, terceiro, attempts });
    const jaGravadas = recordAiInteraction.mock.calls.length;

    const turno = await runAiTurn({
      conversation: { id: conversationId, channelId: conversa.channelId },
      contact,
      perfil: 'triagem',
      identidade,
      terceiro,
      origemMensagem: doCliente.audio ? 'áudio' : 'texto',
      avisoCidade: null,
      triagem: {
        threshold: config.triageConfidenceThreshold,
        maxQuestions,
        attempts,
        forcarConclusao: attempts >= maxQuestions,
        noturno,
      },
    });

    // Os ARGUMENTOS das ferramentas não voltam no retorno do turno — só os
    // nomes do que executou. A auditoria os recebe (toolsRequested), então é
    // dela que eles saem: é o mesmo dado que o painel grava em produção, com o
    // CPF já mascarado pelo orquestrador.
    const auditoria = recordAiInteraction.mock.calls[jaGravadas];
    const toolsSolicitadas = (auditoria && auditoria[0] && auditoria[0].toolsRequested) || [];
    const toolsRecusadas = (auditoria && auditoria[0] && auditoria[0].toolsRefused) || [];

    if (turno.texto) historico.push({ direction: 'outbound', content: turno.texto, messageType: 'text' });

    // Atribuição direta, NÃO `|| terceiro`: null é limpeza do escopo, e um `||`
    // ressuscitaria uma autorização que a ferramenta acabou de derrubar.
    terceiro = turno.terceiro;
    // A identidade pode ter mudado DENTRO do turno (buscar_cliente com o CPF
    // que o cliente acabou de mandar, ou esquecer_identificacao). Em produção
    // quem devolve isso no turno seguinte é resolverIdentidade, lendo o
    // contato já gravado; aqui a identidade do fim do turno é exatamente esse
    // valor.
    if (turno.identidade) identidade = turno.identidade;
    attempts += 1;

    turnos.push({
      numero: turnos.length + 1,
      cliente: doCliente.texto,
      audio: doCliente.audio,
      texto: turno.texto,
      toolsExecutadas: turno.toolsExecutadas || [],
      toolsSolicitadas,
      toolsRecusadas,
      triagemConcluida: turno.triagemConcluida || null,
      atendimentoEncerrado: Boolean(turno.atendimentoEncerrado),
      desbloqueioRealizado: Boolean(turno.desbloqueioRealizado),
      erro: turno.erro || null,
      antes,
      depois: retrato({ identidade, terceiro, attempts }),
    });

    if (turno.triagemConcluida) parou = `a triagem concluiu para ${turno.triagemConcluida.setor}`;
    else if (turno.atendimentoEncerrado) parou = 'a IA encerrou o atendimento';
  }

  return {
    roteiro, turnos, historico, identidade, terceiro, attempts, conversa,
    sgp: { identidade: identidadeInicial, contact, perfil },
    conversationId,
    config,
    parou,
    mensagensNaoEnviadas,
    continuaNaTriagem: conversa.triageState === 'pending' && conversa.status !== 'closed',
    resumoDoAtendente: conversa.aiTriageSummary || null,
  };
}

// ---------------------------------------------------------------------------
// Transcrição
// ---------------------------------------------------------------------------

function estadoEmUmaLinha(e) {
  if (!e) return '—';
  const id = e.identidade ? `${e.identidade.nivel}/${e.identidade.origem}${e.identidade.primeiroNome ? ` (${e.identidade.primeiroNome})` : ''}` : 'sem identidade';
  const terceiro = e.terceiro ? `terceiro ${e.terceiro.nome || 'sem nome'} [${e.terceiro.contratos.join(', ')}]` : 'sem terceiro';
  return `identidade ${id} · contratos [${e.contratos.join(', ')}] · ${terceiro} · perguntas ${e.attempts}`;
}

/**
 * Grava a conversa turno a turno em output/simulacao/. Nada de segredo entra
 * aqui: nem a chave, nem o CPF cru (o que vai é o argumento já mascarado pela
 * auditoria). A pasta está no .gitignore.
 */
async function salvarTranscricao(resultado, turnos) {
  const roteiro = resultado.roteiro;
  fs.mkdirSync(SAIDA, { recursive: true });
  const linhas = [
    `# ${roteiro.numero} — ${roteiro.nome}`,
    '',
    `Identidade inicial: \`${roteiro.identidade || `(continua do ${roteiro.continuaDe})`}\`` + (roteiro.noturno ? ' · modo noturno' : ''),
    `Modelo: \`${resultado.config.model}\` · limite de perguntas: ${resultado.config.triageMaxQuestions} · limiar de confiança: ${resultado.config.triageConfidenceThreshold}`,
    '',
    '---',
    '',
  ];
  for (const t of turnos) {
    linhas.push(`### Turno ${t.numero}${t.audio ? ' (áudio)' : ''}`, '');
    linhas.push(`**Cliente:** ${t.cliente}`, '');
    linhas.push(`**IA:** ${t.texto || '(sem resposta)'}`, '');
    const executadas = (t.toolsExecutadas || []).map((f) => f.nome).join(', ');
    const solicitadas = (t.toolsSolicitadas || []).map((f) => `${f.nome}(${JSON.stringify(f.args || {})})`).join(', ');
    const recusadas = (t.toolsRecusadas || []).map((f) => `${f.nome}: ${f.motivo}`).join(', ');
    linhas.push(`_Pediu: ${solicitadas || 'nada'}_`, '');
    linhas.push(`_Executou: ${executadas || 'nada'}${recusadas ? ` · recusadas: ${recusadas}` : ''}${t.erro ? ` · erro: ${t.erro}` : ''}_`, '');
    linhas.push(`_Antes: ${estadoEmUmaLinha(t.antes)}_`, '');
    linhas.push(`_Depois: ${estadoEmUmaLinha(t.depois)}_`, '', '---', '');
  }
  if (resultado.parou) {
    linhas.push(`> A conversa parou porque ${resultado.parou}.`, '');
    if (resultado.mensagensNaoEnviadas.length > 0) {
      linhas.push('> Mensagens do roteiro que não chegaram a ser enviadas (em produção o worker também não as atenderia na triagem):', '');
      for (const m of resultado.mensagensNaoEnviadas) linhas.push(`> - ${m}`);
      linhas.push('');
    }
  }
  if (resultado.resumoDoAtendente) {
    linhas.push('## Resumo entregue ao atendente', '', '```', resultado.resumoDoAtendente, '```', '');
  }
  linhas.push('## Para revisão humana', '');
  for (const pergunta of roteiro.revisaoHumana || []) linhas.push(`- [ ] ${pergunta}`);
  linhas.push('');
  const arquivo = `${String(roteiro.numero).padStart(2, '0')}-${roteiro.nome.replace(/[^\p{L}\p{N}]+/gu, '-')}.md`;
  fs.writeFileSync(path.join(SAIDA, arquivo), linhas.join('\n'), 'utf8');
  return path.join(SAIDA, arquivo);
}

module.exports = { conversar, salvarTranscricao, configDoPainel, SAIDA, pastaLocal };
